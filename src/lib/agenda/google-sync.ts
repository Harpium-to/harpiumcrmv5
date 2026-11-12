// ============================================================
// Sends the agenda to Google Agenda (G1 of docs/plano-google-agenda.md).
//
// The database decides what has to go (migration 069 marks every
// event whose agenda writes to Google, and keeps a list of what must
// be removed); this runs the calls:
//
//   1. removals of events whose row is gone (google_event_deletions);
//   2. the events claimed by claim_google_event_sync(): create / update
//      at the agenda's Google calendar, delete from where they were if
//      cancelled or moved;
//   3. each result back through finish_google_event_sync().
//
// Runs right after a booking (the screen's nudge, the AI agents, the
// public link, approvals) and on every tick of /api/automations/cron,
// which is the safety net. Never throws: nothing here may hold up a
// booking or the scheduler.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingFunction, isMissingTable } from '@/lib/auth/account-context'
import { getGoogleAccessToken } from '@/lib/google/connections'
import { deleteGoogleEvent, GoogleApiError, putGoogleEvent } from '@/lib/google/calendar-api'
import { GoogleAuthError, type GoogleOAuthConfig } from '@/lib/google/oauth'

import { buildGoogleEvent, planGoogleSync, type ClaimedGoogleSync } from './google-event'

export interface GoogleSyncDeps {
  /** The app's Google credentials; null when the server has none. */
  config: () => Pick<GoogleOAuthConfig, 'clientId' | 'clientSecret'> | null
  token: (
    db: SupabaseClient,
    connectionId: string,
    config: Pick<GoogleOAuthConfig, 'clientId' | 'clientSecret'>,
  ) => Promise<string>
  put: typeof putGoogleEvent
  remove: typeof deleteGoogleEvent
  now: () => Date
}

const defaultDeps: GoogleSyncDeps = {
  config: () => {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
    return clientId && clientSecret ? { clientId, clientSecret } : null
  },
  token: (db, connectionId, config) => getGoogleAccessToken(db, connectionId, config),
  put: putGoogleEvent,
  remove: deleteGoogleEvent,
  now: () => new Date(),
}

export interface GoogleSyncOptions {
  /** Only this event (right after booking it). */
  eventId?: string | null
  limit?: number
  /** The CRM's public address, for the link to the contact's record. */
  crmUrl?: string | null
}

export interface GoogleSyncCounts {
  sent: number
  removed: number
  failed: number
}

/** A failure, in words for the agenda screen, and whether to retry on its own. */
export function describeGoogleFailure(error: unknown): { message: string; retry: boolean } {
  if (error instanceof GoogleAuthError) {
    return error.revoked
      ? { message: 'A conta Google desta agenda precisa ser conectada de novo.', retry: false }
      : { message: 'Não consegui falar com o Google agora. Tento de novo sozinho.', retry: true }
  }
  if (error instanceof GoogleApiError) {
    if (error.retryable) {
      return { message: 'O Google está ocupado agora. Tento de novo sozinho.', retry: true }
    }
    if (error.status === 401) {
      return { message: 'O Google recusou o acesso. Tento de novo sozinho.', retry: true }
    }
    if (error.status === 403) {
      return {
        message: 'O Google não deixou gravar nesta agenda. Confira se ela ainda é da conta conectada.',
        retry: false,
      }
    }
    if (error.status === 404) {
      return {
        message: 'A agenda do Google escolhida não existe mais. Escolha outra na engrenagem da Agenda.',
        retry: false,
      }
    }
    return { message: 'O Google recusou os dados deste agendamento.', retry: false }
  }
  return { message: 'Erro inesperado ao enviar para o Google. Tento de novo sozinho.', retry: true }
}

const BLOCKED_MESSAGE = 'A conta Google desta agenda precisa ser conectada de novo.'

/** Access tokens for this run, one request per connection at most. */
function tokenCache(
  db: SupabaseClient,
  config: Pick<GoogleOAuthConfig, 'clientId' | 'clientSecret'>,
  deps: GoogleSyncDeps,
) {
  const cache = new Map<string, Promise<string>>()
  return (connectionId: string) => {
    let pending = cache.get(connectionId)
    if (!pending) {
      pending = deps.token(db, connectionId, config)
      // Keep the rejection too: a revoked connection is not retried
      // once per event in the same run.
      pending.catch(() => {})
      cache.set(connectionId, pending)
    }
    return pending
  }
}

async function finish(
  db: SupabaseClient,
  row: ClaimedGoogleSync,
  remote: { eventId: string; calendarId: string; connectionId: string } | null,
  failure: { message: string; retry: boolean } | null,
): Promise<void> {
  const { error } = await db.rpc('finish_google_event_sync', {
    p_event_id: row.event_id,
    p_claimed_at: row.claimed_at,
    p_google_event_id: remote?.eventId ?? null,
    p_google_calendar_id: remote?.calendarId ?? null,
    p_connection_id: remote?.connectionId ?? null,
    p_error: failure?.message ?? null,
    p_retry: failure?.retry ?? true,
  })
  if (error) console.error('[google sync] finish failed:', error)
}

/** Send one claimed event. Never throws. */
async function syncOne(
  db: SupabaseClient,
  row: ClaimedGoogleSync,
  token: (connectionId: string) => Promise<string>,
  deps: GoogleSyncDeps,
  crmUrl: string | null,
): Promise<'sent' | 'removed' | 'failed'> {
  const plan = planGoogleSync(row)
  // Where the event is in Google as far as we know, updated as we go.
  let remote =
    row.google_event_id && row.google_calendar_id && row.google_connection_id
      ? {
          eventId: row.google_event_id,
          calendarId: row.google_calendar_id,
          connectionId: row.google_connection_id,
        }
      : null

  try {
    if (plan.remove) {
      try {
        await deps.remove(await token(plan.remove.connectionId), plan.remove.calendarId, plan.remove.eventId)
      } catch (error) {
        // The old account is gone or lost its access: the copy cannot
        // be removed by us any more. Forget it rather than block the
        // event forever. Anything that may pass is retried.
        if (!(error instanceof GoogleAuthError && error.revoked)) throw error
        console.warn('[google sync] could not remove an old copy, access lost:', row.event_id)
      }
      remote = null
    }

    if (plan.put) {
      if (plan.blocked) {
        await finish(db, row, remote, { message: BLOCKED_MESSAGE, retry: false })
        return 'failed'
      }
      const accessToken = await token(plan.put.connectionId)
      await deps.put(
        accessToken,
        plan.put.calendarId,
        plan.put.eventId,
        buildGoogleEvent(row, crmUrl),
        { exists: plan.put.exists },
      )
      remote = {
        eventId: plan.put.eventId,
        calendarId: plan.put.calendarId,
        connectionId: plan.put.connectionId,
      }
      await finish(db, row, remote, null)
      return 'sent'
    }

    await finish(db, row, null, null)
    return 'removed'
  } catch (error) {
    const failure = describeGoogleFailure(error)
    if (failure.retry) console.warn('[google sync] will retry', row.event_id, error)
    else console.error('[google sync] failed', row.event_id, error)
    await finish(db, row, remote, failure)
    return 'failed'
  }
}

interface DeletionRow {
  id: string
  connection_id: string
  google_calendar_id: string
  google_event_id: string
  attempts: number
}

/** Remove from Google what was deleted in the CRM. Never throws. */
async function processDeletions(
  db: SupabaseClient,
  token: (connectionId: string) => Promise<string>,
  deps: GoogleSyncDeps,
): Promise<{ removed: number; failed: number } | null> {
  const now = deps.now()
  const { data, error } = await db
    .from('google_event_deletions')
    .select('id, connection_id, google_calendar_id, google_event_id, attempts')
    .lte('next_at', now.toISOString())
    .order('created_at', { ascending: true })
    .limit(50)
  if (error) {
    if (!isMissingTable(error)) console.error('[google sync] deletions read failed:', error)
    return null
  }
  const counts = { removed: 0, failed: 0 }
  for (const row of (data ?? []) as DeletionRow[]) {
    try {
      await deps.remove(await token(row.connection_id), row.google_calendar_id, row.google_event_id)
      await db.from('google_event_deletions').delete().eq('id', row.id)
      counts.removed += 1
    } catch (err) {
      const { message, retry } = describeGoogleFailure(err)
      // Five tries, or one that will never work: give up on that copy.
      if (!retry || row.attempts + 1 >= 5) {
        await db.from('google_event_deletions').delete().eq('id', row.id)
      } else {
        const wait = 2 ** Math.min(row.attempts + 1, 6) * 60_000
        await db
          .from('google_event_deletions')
          .update({
            attempts: row.attempts + 1,
            last_error: message,
            next_at: new Date(now.getTime() + wait).toISOString(),
          })
          .eq('id', row.id)
      }
      counts.failed += 1
    }
  }
  return counts
}

/**
 * Send to Google what is waiting. Returns null when there is nothing
 * to do here: Google not configured on this server, or migration 069
 * not applied yet.
 */
export async function processGoogleCalendarSync(
  db: SupabaseClient,
  options: GoogleSyncOptions = {},
  deps: GoogleSyncDeps = defaultDeps,
): Promise<GoogleSyncCounts | null> {
  try {
    const config = deps.config()
    // Without credentials nothing is claimed, so nothing is marked as
    // failed: it all goes once the server is set up.
    if (!config) return null
    const token = tokenCache(db, config, deps)
    const counts: GoogleSyncCounts = { sent: 0, removed: 0, failed: 0 }

    if (!options.eventId) {
      const deletions = await processDeletions(db, token, deps)
      if (deletions === null) return null
      counts.removed += deletions.removed
      counts.failed += deletions.failed
    }

    const { data, error } = await db.rpc('claim_google_event_sync', {
      p_limit: options.limit ?? 50,
      p_event_id: options.eventId ?? null,
    })
    if (error) {
      if (!isMissingFunction(error)) console.error('[google sync] claim failed:', error)
      return null
    }
    const crmUrl =
      (
        options.crmUrl ??
        process.env.NEXT_PUBLIC_SITE_URL ??
        process.env.NEXT_PUBLIC_APP_URL ??
        ''
      )
        .trim()
        .replace(/\/+$/, '') || null
    for (const row of (data ?? []) as ClaimedGoogleSync[]) {
      counts[await syncOne(db, row, token, deps, crmUrl)] += 1
    }
    return counts
  } catch (error) {
    console.error('[google sync] threw:', error)
    return null
  }
}

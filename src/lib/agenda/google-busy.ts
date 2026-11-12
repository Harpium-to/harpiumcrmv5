// ============================================================
// What is busy in the professional's Google Agenda (Fase G2 of
// docs/plano-google-agenda.md, migration 071).
//
// For every agenda of the CRM with "Mostrar os compromissos do Google"
// on, the Google calendars it reads are listed for a window (yesterday
// to 90 days ahead) and stored as busy times — start and end only,
// never the title (decision 3). The screen shows them as "Ocupado
// (Google)"; the free slots of the screen, the AI agents and the public
// link leave them out.
//
// A plain re-read of the window instead of Google's sync tokens: one
// call per calendar, no state to lose, and a calendar is re-read at most
// once per `maxAgeMs`. Reads happen on the scheduler's tick, when the
// Agenda screen opens, and right before the AI or the public link books
// (so a slot taken in Google a minute ago is not offered).
//
// The same read finds the CRM's own events in Google: one moved or
// deleted there gets a notice (decision 4, note_google_remote_changes).
//
// Never throws.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { getGoogleAccessToken } from '@/lib/google/connections'
import { listGoogleEvents, type GoogleListedEvent } from '@/lib/google/calendar-api'
import { GoogleAuthError, type GoogleOAuthConfig } from '@/lib/google/oauth'

import type { Interval } from './slots'
import { safeTimeZone, zonedToUtc } from './time'

/** How far ahead Google is read: longer than the public link (30) and the AI (10). */
export const GOOGLE_READ_DAYS = 90

export interface BusyRow {
  google_event_id: string
  starts_at: string
  ends_at: string
  all_day: boolean
}

export interface OwnEventInGoogle {
  google_event_id: string
  starts_at: string
  ends_at: string
}

/** When an event starts or ends, as an instant; all-day ones on the calendar's own clock. */
function instant(point: GoogleListedEvent['start'], timeZone: string): string | null {
  if (point.dateTime) {
    const date = new Date(point.dateTime)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (point.date && /^\d{4}-\d{2}-\d{2}$/.test(point.date)) {
    return zonedToUtc(point.date, 0, timeZone).toISOString()
  }
  return null
}

/**
 * Sort a calendar's events into what blocks the agenda and what the CRM
 * itself put there. Left out: cancelled events, events marked
 * "Disponível" (all-day ones are, by default — birthdays, holidays) and
 * invitations the person declined.
 */
export function readGoogleEvents(
  events: GoogleListedEvent[],
  timeZone: string,
): { busy: BusyRow[]; own: OwnEventInGoogle[] } {
  const zone = safeTimeZone(timeZone)
  const busy: BusyRow[] = []
  const own: OwnEventInGoogle[] = []
  for (const event of events) {
    if (event.status === 'cancelled') continue
    const starts = instant(event.start, zone)
    const ends = instant(event.end, zone)
    if (!starts || !ends || ends <= starts) continue
    if (event.harpiumEventId) {
      own.push({ google_event_id: event.id, starts_at: starts, ends_at: ends })
      continue
    }
    if (event.transparency === 'transparent' || event.declined) continue
    busy.push({
      google_event_id: event.id,
      starts_at: starts,
      ends_at: ends,
      all_day: !event.start.dateTime,
    })
  }
  return { busy, own }
}

/** The window read from Google: yesterday to GOOGLE_READ_DAYS ahead. */
export function googleReadWindow(now: Date): { timeMin: Date; timeMax: Date } {
  return {
    timeMin: new Date(now.getTime() - 86_400_000),
    timeMax: new Date(now.getTime() + GOOGLE_READ_DAYS * 86_400_000),
  }
}

export interface GoogleBusyDeps {
  config: () => Pick<GoogleOAuthConfig, 'clientId' | 'clientSecret'> | null
  token: (
    db: SupabaseClient,
    connectionId: string,
    config: Pick<GoogleOAuthConfig, 'clientId' | 'clientSecret'>,
  ) => Promise<string>
  list: typeof listGoogleEvents
  now: () => Date
}

const defaultDeps: GoogleBusyDeps = {
  config: () => {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
    return clientId && clientSecret ? { clientId, clientSecret } : null
  },
  token: (db, connectionId, config) => getGoogleAccessToken(db, connectionId, config),
  list: listGoogleEvents,
  now: () => new Date(),
}

export interface GoogleBusyOptions {
  /** Only the Google calendars these agendas read. */
  calendarIds?: string[]
  /** Only this CRM's agendas. */
  accountId?: string
  /** A calendar read more recently than this is left alone. Default 60 s. */
  maxAgeMs?: number
}

interface AgendaRow {
  id: string
  account_id: string
  timezone: string
  google_connection_id: string
  google_calendar_id: string | null
  google_busy_calendar_ids: string[] | null
}

interface Target {
  accountId: string
  connectionId: string
  googleCalendarId: string
  timezone: string
}

/**
 * Re-read from Google the calendars the matching agendas show. Returns
 * null when there is nothing to do here (no Google credentials on this
 * server, or migration 071 not applied).
 */
export async function refreshGoogleBusy(
  db: SupabaseClient,
  options: GoogleBusyOptions = {},
  deps: GoogleBusyDeps = defaultDeps,
): Promise<{ read: number; failed: number; notices: number } | null> {
  try {
    const config = deps.config()
    if (!config) return null

    let query = db
      .from('calendars')
      .select('id, account_id, timezone, google_connection_id, google_calendar_id, google_busy_calendar_ids')
      .not('google_connection_id', 'is', null)
      .eq('google_show_busy', true)
      .eq('is_active', true)
    if (options.accountId) query = query.eq('account_id', options.accountId)
    if (options.calendarIds) {
      if (options.calendarIds.length === 0) return { read: 0, failed: 0, notices: 0 }
      query = query.in('id', options.calendarIds)
    }
    const { data: agendas, error } = await query
    if (error) return null

    // One read per Google calendar, however many agendas show it.
    const targets = new Map<string, Target>()
    for (const agenda of (agendas ?? []) as AgendaRow[]) {
      const ids =
        agenda.google_busy_calendar_ids && agenda.google_busy_calendar_ids.length > 0
          ? agenda.google_busy_calendar_ids
          : agenda.google_calendar_id
            ? [agenda.google_calendar_id]
            : []
      for (const googleCalendarId of ids) {
        const key = `${agenda.google_connection_id}|${googleCalendarId}`
        if (!targets.has(key)) {
          targets.set(key, {
            accountId: agenda.account_id,
            connectionId: agenda.google_connection_id,
            googleCalendarId,
            timezone: agenda.timezone,
          })
        }
      }
    }
    if (targets.size === 0) return { read: 0, failed: 0, notices: 0 }

    const now = deps.now()
    const maxAge = options.maxAgeMs ?? 60_000
    const { data: reads } = await db
      .from('google_calendar_reads')
      .select('connection_id, google_calendar_id, read_at')
      .in('connection_id', [...new Set([...targets.values()].map((t) => t.connectionId))])
    const fresh = new Set(
      ((reads ?? []) as { connection_id: string; google_calendar_id: string; read_at: string }[])
        .filter((r) => now.getTime() - new Date(r.read_at).getTime() < maxAge)
        .map((r) => `${r.connection_id}|${r.google_calendar_id}`),
    )

    const tokens = new Map<string, Promise<string>>()
    const tokenFor = (connectionId: string) => {
      let pending = tokens.get(connectionId)
      if (!pending) {
        pending = deps.token(db, connectionId, config)
        pending.catch(() => {})
        tokens.set(connectionId, pending)
      }
      return pending
    }

    const window = googleReadWindow(now)
    const counts = { read: 0, failed: 0, notices: 0 }
    for (const [key, target] of targets) {
      if (fresh.has(key)) continue
      try {
        const token = await tokenFor(target.connectionId)
        const page = await deps.list(token, target.googleCalendarId, window)
        const { busy, own } = readGoogleEvents(page.events, page.timeZone ?? target.timezone)
        const { error: replaceError } = await db.rpc('replace_google_busy', {
          p_account_id: target.accountId,
          p_connection_id: target.connectionId,
          p_calendar_id: target.googleCalendarId,
          p_rows: busy,
        })
        if (replaceError) throw replaceError
        counts.read += 1
        // Only a complete read can say an event is gone from Google.
        if (page.complete) {
          const { data: notices } = await db.rpc('note_google_remote_changes', {
            p_connection_id: target.connectionId,
            p_calendar_id: target.googleCalendarId,
            p_own: own,
            p_from: window.timeMin.toISOString(),
            p_to: window.timeMax.toISOString(),
          })
          counts.notices += typeof notices === 'number' ? notices : 0
        }
      } catch (err) {
        counts.failed += 1
        const reason =
          err instanceof GoogleAuthError && err.revoked
            ? 'A conta Google precisa ser conectada de novo.'
            : 'Não consegui ler o Google agora.'
        await db.from('google_calendar_reads').upsert(
          {
            connection_id: target.connectionId,
            google_calendar_id: target.googleCalendarId,
            // Spaced like a read, so a broken calendar is not hammered.
            read_at: now.toISOString(),
            last_error: reason,
          },
          { onConflict: 'connection_id,google_calendar_id' },
        )
        if (!(err instanceof GoogleAuthError && err.revoked)) {
          console.warn('[google busy] read failed:', target.googleCalendarId, err)
        }
      }
    }
    return counts
  } catch (error) {
    console.error('[google busy] threw:', error)
    return null
  }
}

/**
 * The Google busy times of these agendas touching [from, to), from the
 * calendar_google_busy view (071). Empty on any failure — before 071,
 * or with Google never connected, the agenda is simply what the CRM
 * has.
 */
export async function googleBusyByCalendar(
  db: SupabaseClient,
  calendarIds: string[],
  from: Date,
  to: Date,
): Promise<Map<string, Interval[]>> {
  const out = new Map<string, Interval[]>()
  if (calendarIds.length === 0) return out
  try {
    const { data, error } = await db
      .from('calendar_google_busy')
      .select('calendar_id, starts_at, ends_at')
      .in('calendar_id', calendarIds)
      .lt('starts_at', to.toISOString())
      .gt('ends_at', from.toISOString())
    if (error) return out
    for (const row of (data ?? []) as { calendar_id: string; starts_at: string; ends_at: string }[]) {
      const list = out.get(row.calendar_id) ?? []
      list.push({ start: new Date(row.starts_at), end: new Date(row.ends_at) })
      out.set(row.calendar_id, list)
    }
  } catch {
    // Not there yet, or a client without the view: nothing from Google.
  }
  return out
}

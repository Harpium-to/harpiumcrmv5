import type { SupabaseClient } from '@supabase/supabase-js'

import { requestSmbAppDataSync } from './meta-api'

// ============================================================
// Coexistence (W3): the number stays on the WhatsApp Business app on
// the client's phone and is ALSO connected to the CRM.
//
// Right after connecting we ask Meta, once, for what is already on
// the phone: the contact names and the last months of chats. Both
// arrive later through the webhook (see coexistence-webhook.ts). Meta
// accepts each request only once and only within 24 hours of the
// number joining coexistence, so the request time is stored and a
// type that was already accepted is never asked for again.
// ============================================================

export type SyncOutcome = 'requested' | 'already_requested' | 'failed'

export interface CoexistenceSyncResult {
  contacts: SyncOutcome
  history: SyncOutcome
  /** Meta's message for the first type that failed. */
  error: string | null
}

interface SyncRow {
  contacts_sync_requested_at: string | null
  history_sync_requested_at: string | null
  history_sync_status: string | null
}

/**
 * Ask Meta for the phone's contacts, then its chat history — in that
 * order, as Meta recommends, so imported chats find their names.
 * Never throws: the connection is already saved, and a failed request
 * is recorded on the row for the status screen (with a retry button).
 */
export async function requestCoexistenceSync(args: {
  /** Service-role client (also used from the retry route). */
  db: SupabaseClient
  accountId: string
  phoneNumberId: string
  accessToken: string
}): Promise<CoexistenceSyncResult> {
  const { db, accountId, phoneNumberId, accessToken } = args
  const result: CoexistenceSyncResult = {
    contacts: 'already_requested',
    history: 'already_requested',
    error: null,
  }

  const { data, error } = await db
    .from('whatsapp_config')
    .select('contacts_sync_requested_at, history_sync_requested_at, history_sync_status')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data) {
    console.error('[coexistence] sync state read failed:', error)
    return { contacts: 'failed', history: 'failed', error: 'Falha ao ler a configuração' }
  }
  const row = data as SyncRow

  if (!row.contacts_sync_requested_at) {
    try {
      await requestSmbAppDataSync({ phoneNumberId, accessToken, syncType: 'smb_app_state_sync' })
      result.contacts = 'requested'
      await update(db, accountId, { contacts_sync_requested_at: new Date().toISOString() })
    } catch (err) {
      result.contacts = 'failed'
      result.error = errorMessage(err)
      console.warn('[coexistence] contacts sync request failed:', result.error)
    }
  }

  // A failed history request (say, Meta was down) may be retried; an
  // accepted one may not — Meta would refuse it anyway.
  const historyAccepted =
    row.history_sync_requested_at != null && row.history_sync_status !== 'failed'
  if (!historyAccepted) {
    const now = new Date().toISOString()
    try {
      await requestSmbAppDataSync({ phoneNumberId, accessToken, syncType: 'history' })
      result.history = 'requested'
      await update(db, accountId, {
        history_sync_status: 'requested',
        history_sync_progress: 0,
        history_sync_requested_at: now,
        history_sync_finished_at: null,
        history_sync_error: null,
      })
    } catch (err) {
      const message = errorMessage(err)
      result.history = 'failed'
      result.error = result.error ?? message
      console.warn('[coexistence] history sync request failed:', message)
      await update(db, accountId, {
        history_sync_status: 'failed',
        history_sync_requested_at: row.history_sync_requested_at ?? now,
        history_sync_error: message,
      })
    }
  }

  return result
}

async function update(db: SupabaseClient, accountId: string, patch: Record<string, unknown>) {
  const { error } = await db.from('whatsapp_config').update(patch).eq('account_id', accountId)
  if (error) console.error('[coexistence] sync state write failed:', error)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Erro desconhecido na API da Meta'
}

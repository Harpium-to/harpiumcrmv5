import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// The Google Agenda link of a client CRM, as the agency console shows
// it (G3 of docs/plano-google-agenda.md).
//
// Which agendas write to Google, whether that still works, and how many
// upcoming appointments did not make it there — operational, shown at
// every consent level. The Google account's e-mail is personal: only
// with at least read access, the same line the WhatsApp card draws.
// ============================================================

export interface GoogleAgendaRow {
  name: string
  /** 'connected', 'needs_reconnect', or 'none' (this agenda does not write to Google). */
  state: 'connected' | 'needs_reconnect' | 'none'
  /** The Google account; null without consent or when not linked. */
  email: string | null
  /** Shows (and blocks) what is in Google (071). */
  showsGoogle: boolean
  /** Upcoming appointments whose last send to Google failed. */
  failed: number
}

export interface GoogleAgendaDetail {
  agendas: GoogleAgendaRow[]
  /** False before migration 069: the card is not shown. */
  available: boolean
}

export async function loadGoogleAgendaDetail(
  admin: SupabaseClient,
  accountId: string,
  opts: { personal: boolean },
): Promise<GoogleAgendaDetail> {
  const [calendars, connections, failures] = await Promise.all([
    admin
      .from('calendars')
      .select('id, name, google_connection_id, google_show_busy')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
    admin.from('google_connections').select('id, email, status').eq('account_id', accountId),
    admin
      .from('calendar_events')
      .select('calendar_id')
      .eq('account_id', accountId)
      .eq('google_sync_state', 'error')
      .gt('ends_at', new Date().toISOString())
      .limit(500),
  ])
  if (calendars.error || connections.error) return { agendas: [], available: false }

  const byConnection = new Map(
    ((connections.data ?? []) as { id: string; email: string; status: string }[]).map((c) => [c.id, c]),
  )
  const failedBy = new Map<string, number>()
  for (const row of (failures.data ?? []) as { calendar_id: string }[]) {
    failedBy.set(row.calendar_id, (failedBy.get(row.calendar_id) ?? 0) + 1)
  }

  const agendas = (
    (calendars.data ?? []) as {
      id: string
      name: string
      google_connection_id: string | null
      google_show_busy?: boolean | null
    }[]
  ).map((c): GoogleAgendaRow => {
    const connection = c.google_connection_id ? byConnection.get(c.google_connection_id) : undefined
    return {
      name: c.name,
      state: !connection ? 'none' : connection.status === 'connected' ? 'connected' : 'needs_reconnect',
      email: connection && opts.personal ? connection.email : null,
      showsGoogle: !!connection && c.google_show_busy !== false,
      failed: failedBy.get(c.id) ?? 0,
    }
  })
  return { agendas, available: true }
}

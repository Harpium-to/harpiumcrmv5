import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingTable } from '@/lib/leads/mappings'

// ============================================================
// The automatic brake of prospecting sends (docs/plano-extrator-leads.md).
//
// Before the scheduler sends anything, every prospecting send still
// going is looked at; it stops by itself, with the reason written on
// it, when:
//   - the last 3 messages failed (the number is probably disconnected);
//   - more than 10% of what was processed failed (at least 10 processed);
//   - 30 went out and nobody answered (the text is not working, and
//     people who do not answer are the ones who report the number).
// What is still waiting is cancelled, like the "Parar" button does.
// ============================================================

export const BRAKE_FAIL_STREAK = 3
export const BRAKE_FAIL_RATE = 0.1
export const BRAKE_FAIL_MIN = 10
export const BRAKE_SILENCE = 30

export interface BrakeRow {
  status: string
  processed_at: string | null
  replied_at: string | null
}

/** Why this send must stop, or null. Pure. */
export function brakeReason(rows: BrakeRow[]): string | null {
  const processed = rows
    .filter((r) => r.status === 'sent' || r.status === 'failed')
    .sort((a, b) => (a.processed_at ?? '').localeCompare(b.processed_at ?? ''))
  const failed = processed.filter((r) => r.status === 'failed').length
  const sent = processed.length - failed
  const last = processed.slice(-BRAKE_FAIL_STREAK)
  if (last.length === BRAKE_FAIL_STREAK && last.every((r) => r.status === 'failed')) {
    return 'Parou sozinho: as últimas mensagens falharam. Confira se o WhatsApp continua conectado.'
  }
  if (processed.length >= BRAKE_FAIL_MIN && failed / processed.length > BRAKE_FAIL_RATE) {
    return 'Parou sozinho: mais de 10% das mensagens falharam. Confira a conexão e a lista.'
  }
  if (sent >= BRAKE_SILENCE && !rows.some((r) => r.replied_at)) {
    return `Parou sozinho: ${BRAKE_SILENCE} mensagens saíram e ninguém respondeu. Revise os textos antes de continuar.`
  }
  return null
}

/**
 * Stop the prospecting sends that tripped the brake. Returns how many
 * stopped, or null when it could not run. Never throws.
 */
export async function applyProspectingBrakes(admin: SupabaseClient): Promise<number | null> {
  try {
    const { data: bulks, error } = await admin
      .from('bulk_sends')
      .select('id, account_id')
      .eq('mode', 'prospeccao')
      .is('stopped_at', null)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) {
      if (!isMissingTable(error) && !/column .*mode/i.test(error.message)) {
        console.error('[prospect brake] read failed:', error.message)
      }
      return null
    }
    let stopped = 0
    for (const bulk of (bulks ?? []) as { id: string; account_id: string }[]) {
      const { data: rows } = await admin
        .from('scheduled_messages')
        .select('status, processed_at, replied_at')
        .eq('bulk_send_id', bulk.id)
      const all = (rows ?? []) as BrakeRow[]
      // Nothing left to send: there is nothing to stop.
      if (!all.some((r) => r.status === 'scheduled')) continue
      const reason = brakeReason(all)
      if (!reason) continue
      const now = new Date().toISOString()
      await admin
        .from('scheduled_messages')
        .update({ status: 'cancelled', outcome: reason, processed_at: now })
        .eq('bulk_send_id', bulk.id)
        .eq('status', 'scheduled')
      await admin
        .from('bulk_sends')
        .update({ stopped_at: now, stopped_reason: reason })
        .eq('id', bulk.id)
        .is('stopped_at', null)
      stopped += 1
    }
    return stopped
  } catch (err) {
    console.error('[prospect brake] threw:', err)
    return null
  }
}

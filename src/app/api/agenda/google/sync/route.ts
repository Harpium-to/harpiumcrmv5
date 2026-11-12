// ============================================================
// POST /api/agenda/google/sync  { eventId? }
//
// The Agenda screen calls this right after saving or deleting, so the
// change reaches Google at once instead of at the scheduler's next run
// (which stays the safety net). Agents and above.
//
// It decides nothing: whether an event has to go, and where, is the
// database's (069). With an eventId, only that event; without, the
// removals of deleted events and a small batch of whatever waits.
// ============================================================

import { NextResponse } from 'next/server'

import { processGoogleCalendarSync } from '@/lib/agenda/google-sync'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { UUID } from '@/lib/google/oauth-flow'

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')
    const { origin } = new URL(request.url)
    const body = (await request.json().catch(() => null)) as { eventId?: unknown } | null
    const eventId = typeof body?.eventId === 'string' ? body.eventId : null
    if (eventId !== null && !UUID.test(eventId)) {
      return NextResponse.json({ error: "'eventId' inválido" }, { status: 400 })
    }

    if (eventId) {
      // Under RLS: only an event of the caller's active CRM is found.
      const { data } = await ctx.supabase
        .from('calendar_events')
        .select('id')
        .eq('id', eventId)
        .eq('account_id', ctx.accountId)
        .maybeSingle()
      if (!data) return NextResponse.json({ error: 'Agendamento não encontrado' }, { status: 404 })
    }

    const result = await processGoogleCalendarSync(supabaseAdmin(), {
      eventId,
      limit: eventId ? 1 : 10,
      crmUrl: origin,
    })
    return NextResponse.json({ result })
  } catch (err) {
    return toErrorResponse(err)
  }
}

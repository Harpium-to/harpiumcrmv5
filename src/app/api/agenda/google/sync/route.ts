// ============================================================
// POST /api/agenda/google/sync  { eventId? }
//
// The Agenda screen calls this right after saving or deleting, so the
// change reaches Google at once instead of at the scheduler's next run
// (which stays the safety net). Agents and above.
//
// It decides nothing: whether an event has to go, and where, is the
// database's (069). With an eventId, only that event; without, the
// removals of deleted events, a small batch of whatever waits, and a
// fresh read of what this CRM's agendas show from Google (071) — what
// the screen asks for when it opens.
// ============================================================

import { NextResponse } from 'next/server'

import { refreshGoogleBusy } from '@/lib/agenda/google-busy'
import { processGoogleCalendarSync } from '@/lib/agenda/google-sync'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { UUID } from '@/lib/google/oauth-flow'
import { crmOrigin } from '@/lib/google/origin'

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')
    const origin = crmOrigin(request)
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

    const admin = supabaseAdmin()
    const result = await processGoogleCalendarSync(admin, {
      eventId,
      limit: eventId ? 1 : 10,
      crmUrl: origin,
    })
    // Without an event (the Agenda screen opening, or a delete): also
    // bring this CRM's Google busy times up to date (071).
    const busy = eventId ? null : await refreshGoogleBusy(admin, { accountId: ctx.accountId })
    return NextResponse.json({ result, busy })
  } catch (err) {
    return toErrorResponse(err)
  }
}

// ============================================================
// POST /api/agenda/google/link
//   { calendarId, connectionId: string | null, googleCalendarId?: string }
//
// Points an agenda of the CRM at one calendar of a connected Google
// account — or, with connectionId null, stops it writing to Google
// (its upcoming events are then removed from there). Admins only.
// The Google calendar must be one the account owns: the list is read
// again here rather than trusting the form.
//
// Changing where an agenda writes re-queues its upcoming events
// (trigger in 069); the first batch goes right after the answer.
// ============================================================

import { after, NextResponse } from 'next/server'

import { processGoogleCalendarSync } from '@/lib/agenda/google-sync'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { listOwnedCalendars } from '@/lib/google/calendar-api'
import { getGoogleAccessToken } from '@/lib/google/connections'
import { GoogleAuthError, googleOAuthConfig } from '@/lib/google/oauth'
import { UUID } from '@/lib/google/oauth-flow'

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const { origin } = new URL(request.url)
    const body = (await request.json().catch(() => null)) as {
      calendarId?: unknown
      connectionId?: unknown
      googleCalendarId?: unknown
    } | null

    const calendarId = typeof body?.calendarId === 'string' ? body.calendarId : ''
    if (!UUID.test(calendarId)) {
      return NextResponse.json({ error: "'calendarId' inválido" }, { status: 400 })
    }
    const { data: calendar } = await ctx.supabase
      .from('calendars')
      .select('id')
      .eq('id', calendarId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!calendar) return NextResponse.json({ error: 'Agenda não encontrada' }, { status: 404 })

    const admin = supabaseAdmin()

    // Stop writing to Google.
    if (body?.connectionId === null) {
      const { error } = await ctx.supabase
        .from('calendars')
        .update({ google_connection_id: null })
        .eq('id', calendarId)
        .eq('account_id', ctx.accountId)
      if (error) throw error
      after(() => processGoogleCalendarSync(admin, { crmUrl: origin }))
      return NextResponse.json({ ok: true })
    }

    const connectionId = typeof body?.connectionId === 'string' ? body.connectionId : ''
    const googleCalendarId = typeof body?.googleCalendarId === 'string' ? body.googleCalendarId : ''
    if (!UUID.test(connectionId) || !googleCalendarId) {
      return NextResponse.json({ error: 'Escolha a conta e a agenda do Google.' }, { status: 400 })
    }
    const { data: connection } = await ctx.supabase
      .from('google_connections')
      .select('id')
      .eq('id', connectionId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!connection) return NextResponse.json({ error: 'Conta Google não encontrada' }, { status: 404 })

    const config = googleOAuthConfig(origin)
    if (!config) {
      return NextResponse.json({ error: 'O Google não está configurado neste servidor.' }, { status: 503 })
    }

    let name: string
    try {
      const token = await getGoogleAccessToken(admin, connectionId, config)
      const owned = await listOwnedCalendars(token)
      const chosen = owned.find((c) => c.id === googleCalendarId)
      if (!chosen) {
        return NextResponse.json(
          { error: 'Essa agenda não é da conta Google conectada.' },
          { status: 400 },
        )
      }
      name = chosen.name
    } catch (error) {
      if (error instanceof GoogleAuthError && error.revoked) {
        return NextResponse.json(
          { error: 'Esta conta Google precisa ser conectada de novo.', reconnect: true },
          { status: 409 },
        )
      }
      console.error('[agenda google] link failed:', error)
      return NextResponse.json({ error: 'Não consegui falar com o Google agora.' }, { status: 502 })
    }

    const { error } = await ctx.supabase
      .from('calendars')
      .update({
        google_connection_id: connectionId,
        google_calendar_id: googleCalendarId,
        google_calendar_name: name,
        google_busy_calendar_ids: [googleCalendarId],
      })
      .eq('id', calendarId)
      .eq('account_id', ctx.accountId)
    if (error) throw error

    after(() => processGoogleCalendarSync(admin, { crmUrl: origin }))
    return NextResponse.json({ ok: true, googleCalendarName: name })
  } catch (err) {
    return toErrorResponse(err)
  }
}

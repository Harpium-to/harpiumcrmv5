// ============================================================
// GET /api/agenda/google/calendars?connection=<id>
//
// The calendars a connected Google account owns, for the agenda form's
// "grava em" choice (G1). Admins only, and only a connection of their
// own CRM. A connection whose access dropped answers 409 so the form
// can offer "Conectar de novo".
// ============================================================

import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { listOwnedCalendars } from '@/lib/google/calendar-api'
import { getGoogleAccessToken } from '@/lib/google/connections'
import { GoogleAuthError, googleOAuthConfig } from '@/lib/google/oauth'
import { UUID } from '@/lib/google/oauth-flow'
import { crmOrigin } from '@/lib/google/origin'

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const { searchParams } = new URL(request.url)
    const origin = crmOrigin(request)
    const connectionId = searchParams.get('connection') ?? ''
    if (!UUID.test(connectionId)) {
      return NextResponse.json({ error: "'connection' inválido" }, { status: 400 })
    }

    // Under RLS: only a connection of the caller's active CRM is found.
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

    try {
      const token = await getGoogleAccessToken(supabaseAdmin(), connectionId, config)
      return NextResponse.json({ calendars: await listOwnedCalendars(token) })
    } catch (error) {
      if (error instanceof GoogleAuthError && error.revoked) {
        return NextResponse.json(
          { error: 'Esta conta Google precisa ser conectada de novo.', reconnect: true },
          { status: 409 },
        )
      }
      console.error('[agenda google] calendar list failed:', error)
      return NextResponse.json({ error: 'Não consegui ler as agendas do Google agora.' }, { status: 502 })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}

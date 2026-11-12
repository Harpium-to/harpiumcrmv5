// ============================================================
// POST /api/agenda/google/connect-link  { calendarId }
//
// "Enviar link para o profissional conectar" (G3, migration 071).
// Admins only. Creates an unguessable link, good for 7 days and one
// connection, that a professional who is not on the CRM opens to
// connect their own Google account to this agenda
// (/conectar-google/<token>).
// ============================================================

import { randomBytes } from 'node:crypto'

import { NextResponse } from 'next/server'

import { isMissingTable } from '@/lib/auth/account-context'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { UUID } from '@/lib/google/oauth-flow'
import { crmOrigin } from '@/lib/google/origin'

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await request.json().catch(() => null)) as { calendarId?: unknown } | null
    const calendarId = typeof body?.calendarId === 'string' ? body.calendarId : ''
    if (!UUID.test(calendarId)) {
      return NextResponse.json({ error: "'calendarId' inválido" }, { status: 400 })
    }
    // Under RLS: only an agenda of the caller's active CRM is found.
    const { data: calendar } = await ctx.supabase
      .from('calendars')
      .select('id')
      .eq('id', calendarId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!calendar) return NextResponse.json({ error: 'Agenda não encontrada' }, { status: 404 })

    const token = randomBytes(32).toString('hex')
    const { error } = await supabaseAdmin().from('google_connect_links').insert({
      token,
      account_id: ctx.accountId,
      calendar_id: calendarId,
      created_by: ctx.userId,
    })
    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json(
          { error: 'Esta opção ainda não foi ativada neste CRM (falta a atualização do banco).' },
          { status: 503 },
        )
      }
      throw error
    }
    return NextResponse.json({ url: `${crmOrigin(request)}/conectar-google/${token}` })
  } catch (err) {
    return toErrorResponse(err)
  }
}

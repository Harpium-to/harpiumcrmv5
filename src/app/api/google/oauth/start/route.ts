// ============================================================
// GET /api/google/oauth/start?calendar=<agenda id>
//
// "Conectar com o Google" on an agenda (G1). Admins only. Records the
// request (CRM, agenda, person) under a random single-use state, ties
// that state to this browser with an httpOnly cookie, and sends the
// person to Google. The callback checks both: a sign-in someone else
// started cannot land in this CRM, nor this one in theirs.
// ============================================================

import { randomBytes } from 'node:crypto'

import { NextResponse } from 'next/server'

import { isMissingTable } from '@/lib/auth/account-context'
import { requireRole } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { buildGoogleAuthUrl, googleOAuthConfig } from '@/lib/google/oauth'
import {
  agendaReturnUrl,
  GOOGLE_STATE_COOKIE,
  GOOGLE_STATE_MAX_AGE,
  UUID,
} from '@/lib/google/oauth-flow'

export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url)
  const raw = searchParams.get('calendar')
  const calendarId = raw && UUID.test(raw) ? raw : null

  let ctx
  try {
    ctx = await requireRole('admin')
  } catch {
    return NextResponse.redirect(agendaReturnUrl(origin, 'sem-permissao', calendarId))
  }

  const config = googleOAuthConfig(origin)
  if (!config) return NextResponse.redirect(agendaReturnUrl(origin, 'config', calendarId))

  if (calendarId) {
    // Under RLS: only an agenda of the caller's active CRM is found.
    const { data } = await ctx.supabase
      .from('calendars')
      .select('id')
      .eq('id', calendarId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!data) return NextResponse.redirect(agendaReturnUrl(origin, 'erro'))
  }

  const state = randomBytes(32).toString('hex')
  const { error } = await supabaseAdmin().from('google_oauth_requests').insert({
    state,
    account_id: ctx.accountId,
    calendar_id: calendarId,
    user_id: ctx.userId,
  })
  if (error) {
    if (!isMissingTable(error)) console.error('[google oauth] start failed:', error)
    return NextResponse.redirect(
      agendaReturnUrl(origin, isMissingTable(error) ? 'indisponivel' : 'erro', calendarId),
    )
  }

  const res = NextResponse.redirect(buildGoogleAuthUrl(config, state))
  res.cookies.set(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    secure: origin.startsWith('https'),
    // Lax: sent on the top-level navigation back from Google
    // (via harpium.com.br/google/retorno), not on cross-site requests.
    sameSite: 'lax',
    path: '/',
    maxAge: GOOGLE_STATE_MAX_AGE,
  })
  return res
}

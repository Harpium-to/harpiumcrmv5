// ============================================================
// GET /conectar-google/<token>
//
// What a professional opens from the link an admin sent them (G3,
// migration 071) — no login to the CRM. A valid link records a sign-in
// request for that agenda, ties it to this browser with the same cookie
// as /api/google/oauth/start, and goes to Google. The callback finishes
// the job and, because nobody is signed in here, lands on
// /conectar-google/pronto instead of the Agenda.
// ============================================================

import { randomBytes } from 'node:crypto'

import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { buildGoogleAuthUrl, googleOAuthConfig } from '@/lib/google/oauth'
import { GOOGLE_STATE_COOKIE, GOOGLE_STATE_MAX_AGE } from '@/lib/google/oauth-flow'
import { crmOrigin } from '@/lib/google/origin'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

const TOKEN = /^[0-9a-f]{64}$/

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
  const limit = checkRateLimit(`google-connect-link:${ip}`, RATE_LIMITS.publicAgendaRead)
  if (!limit.success) return rateLimitResponse(limit)

  const origin = crmOrigin(request)
  const done = (result: string) =>
    NextResponse.redirect(`${origin}/conectar-google/pronto?google=${encodeURIComponent(result)}`)

  const { token } = await params
  if (!TOKEN.test(token)) return done('link-invalido')

  const admin = supabaseAdmin()
  const now = new Date().toISOString()
  const { data } = await admin
    .from('google_connect_links')
    .select('id, account_id, calendar_id')
    .eq('token', token)
    .is('used_at', null)
    .gt('expires_at', now)
    .maybeSingle()
  const link = data as { id: string; account_id: string; calendar_id: string } | null
  if (!link) return done('link-invalido')

  const config = googleOAuthConfig(origin)
  if (!config) return done('config')

  const state = randomBytes(32).toString('hex')
  const { error } = await admin.from('google_oauth_requests').insert({
    state,
    account_id: link.account_id,
    calendar_id: link.calendar_id,
    user_id: null,
    link_id: link.id,
  })
  if (error) {
    console.error('[google connect link] request failed:', error)
    return done('erro')
  }

  const res = NextResponse.redirect(buildGoogleAuthUrl(config, state))
  res.cookies.set(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    secure: origin.startsWith('https'),
    sameSite: 'lax',
    path: '/',
    maxAge: GOOGLE_STATE_MAX_AGE,
  })
  return res
}

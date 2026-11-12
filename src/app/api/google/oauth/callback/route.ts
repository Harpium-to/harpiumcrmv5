// ============================================================
// GET /api/google/oauth/callback?code=…&state=…
//
// Where Google sends the person back (through
// https://harpium.com.br/google/retorno in production — see
// lib/google/oauth.ts). Checks the state against this browser's cookie
// and against the request recorded at /start (single use, 15 minutes),
// trades the code for tokens, refuses a sign-in that did not allow the
// events scope, stores the account (encrypted) and points the agenda
// that asked at the account's main calendar. The agenda's upcoming
// events then start going to Google — the first batch right after
// the redirect, the rest on the scheduler's next ticks.
// ============================================================

import { after, NextResponse, type NextRequest } from 'next/server'

import { refreshGoogleBusy } from '@/lib/agenda/google-busy'
import { processGoogleCalendarSync } from '@/lib/agenda/google-sync'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { listOwnedCalendars } from '@/lib/google/calendar-api'
import { saveGoogleConnection } from '@/lib/google/connections'
import {
  exchangeGoogleCode,
  googleOAuthConfig,
  missingScopes,
  readIdToken,
  revokeGoogleToken,
  type GoogleTokens,
} from '@/lib/google/oauth'
import {
  agendaReturnUrl,
  GOOGLE_STATE_COOKIE,
  professionalReturnUrl,
  type GoogleConnectResult,
} from '@/lib/google/oauth-flow'
import { crmOrigin } from '@/lib/google/origin'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const origin = crmOrigin(request)
  // Started from a professional's link (G3): nobody is signed in to the
  // CRM in this browser, so the answer goes to a page of its own.
  let viaLink = false
  const back = (result: GoogleConnectResult, calendarId?: string | null) => {
    const res = NextResponse.redirect(
      viaLink ? professionalReturnUrl(origin, result) : agendaReturnUrl(origin, result, calendarId),
    )
    res.cookies.delete(GOOGLE_STATE_COOKIE)
    return res
  }

  const state = searchParams.get('state') ?? ''
  const cookieState = request.cookies.get(GOOGLE_STATE_COOKIE)?.value ?? ''
  if (!state || state !== cookieState) return back('expirado')

  const admin = supabaseAdmin()
  const now = new Date().toISOString()
  // Consume the request: one use, and only while it is fresh.
  const { data: pending, error: pendingError } = await admin
    .from('google_oauth_requests')
    .update({ used_at: now })
    .eq('state', state)
    .is('used_at', null)
    .gt('expires_at', now)
    // `*`: link_id only exists from 071 on.
    .select('*')
    .maybeSingle()
  if (pendingError) console.error('[google oauth] request lookup failed:', pendingError)
  const req = pending as {
    account_id: string
    calendar_id: string | null
    user_id: string | null
    link_id?: string | null
  } | null
  if (!req) return back('expirado')
  viaLink = !!req.link_id

  // The person closed the window or said no.
  if (searchParams.get('error')) return back('negado', req.calendar_id)
  const code = searchParams.get('code')
  if (!code) return back('erro', req.calendar_id)

  const config = googleOAuthConfig(origin)
  if (!config) return back('config', req.calendar_id)

  let tokens: GoogleTokens
  try {
    tokens = await exchangeGoogleCode(config, code)
  } catch (error) {
    console.error('[google oauth] code exchange failed:', error)
    return back('erro', req.calendar_id)
  }

  // Google lets the person untick a permission; without the events one
  // the connection is useless. Hand the access back and say so.
  if (missingScopes(tokens.scopes).length > 0) {
    await revokeGoogleToken(tokens.refreshToken ?? tokens.accessToken)
    return back('permissao', req.calendar_id)
  }

  const identity = readIdToken(tokens.idToken)
  if (!identity || !tokens.refreshToken) {
    console.error('[google oauth] no identity or refresh token in the answer')
    return back('erro', req.calendar_id)
  }

  const connectionId = await saveGoogleConnection(admin, {
    accountId: req.account_id,
    userId: req.user_id,
    identity,
    tokens,
  })
  if (!connectionId) return back('erro', req.calendar_id)

  // A reconnect: whatever waited on this account (or failed because
  // its access had dropped) is sent again.
  const { error: markError } = await admin.rpc('google_mark_for_sync', { p_connection_id: connectionId })
  if (markError) console.error('[google oauth] mark for sync failed:', markError)

  if (req.calendar_id) {
    const { data: calendar } = await admin
      .from('calendars')
      .select('google_connection_id')
      .eq('id', req.calendar_id)
      .eq('account_id', req.account_id)
      .maybeSingle()
    // Already on this account (a reconnect): keep the calendar it chose.
    if (calendar && (calendar as { google_connection_id: string | null }).google_connection_id !== connectionId) {
      let target = { id: 'primary', name: identity.email }
      try {
        const owned = await listOwnedCalendars(tokens.accessToken)
        const main = owned.find((c) => c.primary) ?? owned[0]
        if (main) target = { id: main.id, name: main.name }
      } catch (error) {
        // Without the list permission, the main calendar still works as "primary".
        console.warn('[google oauth] calendar list failed, using primary:', error)
      }
      const { error: linkError } = await admin
        .from('calendars')
        .update({
          google_connection_id: connectionId,
          google_calendar_id: target.id,
          google_calendar_name: target.name,
          google_busy_calendar_ids: [target.id],
        })
        .eq('id', req.calendar_id)
        .eq('account_id', req.account_id)
      if (linkError) {
        console.error('[google oauth] link agenda failed:', linkError)
        return back('erro', req.calendar_id)
      }
    }
  }

  // The professional's link did its job: it stops working (G3).
  if (req.link_id) {
    await admin.from('google_connect_links').update({ used_at: now }).eq('id', req.link_id)
  }

  after(async () => {
    await processGoogleCalendarSync(admin, { crmUrl: origin })
    // And what is already in Google shows in the CRM right away (071).
    await refreshGoogleBusy(admin, { accountId: req.account_id, maxAgeMs: 0 })
  })
  return back('conectado', req.calendar_id)
}

// ============================================================
// POST /api/agenda/google/disconnect  { connectionId, deleteRemote }
//
// Disconnects a Google account from the CRM (G1). Admins only.
//
//   deleteRemote  first removes from Google the upcoming events the
//                 CRM created there (the past stays, as history).
//
// Then asks Google to revoke the access and deletes the connection:
// its secrets and pending removals go with it (cascade), and every
// agenda that used it stops writing to Google (FK → NULL, 069). The
// appointments themselves stay in the CRM, untouched.
// ============================================================

import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { deleteGoogleEvent } from '@/lib/google/calendar-api'
import { getGoogleAccessToken, readRefreshToken } from '@/lib/google/connections'
import { googleOAuthConfig, revokeGoogleToken } from '@/lib/google/oauth'
import { UUID } from '@/lib/google/oauth-flow'

/** Removals done inside the request; anything beyond stays in Google. */
const MAX_REMOTE_DELETES = 300
const PARALLEL = 5

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const { origin } = new URL(request.url)
    const body = (await request.json().catch(() => null)) as {
      connectionId?: unknown
      deleteRemote?: unknown
    } | null
    const connectionId = typeof body?.connectionId === 'string' ? body.connectionId : ''
    if (!UUID.test(connectionId)) {
      return NextResponse.json({ error: "'connectionId' inválido" }, { status: 400 })
    }
    const { data: connection } = await ctx.supabase
      .from('google_connections')
      .select('id')
      .eq('id', connectionId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!connection) return NextResponse.json({ error: 'Conta Google não encontrada' }, { status: 404 })

    const admin = supabaseAdmin()
    const config = googleOAuthConfig(origin)
    let removed = 0
    let notRemoved = 0

    if (body?.deleteRemote === true && config) {
      const { data: events } = await admin
        .from('calendar_events')
        .select('id, google_event_id, google_calendar_id')
        .eq('account_id', ctx.accountId)
        .eq('google_connection_id', connectionId)
        .not('google_event_id', 'is', null)
        .gt('ends_at', new Date().toISOString())
        .order('starts_at', { ascending: true })
        .limit(MAX_REMOTE_DELETES)
      const rows = (events ?? []) as { id: string; google_event_id: string; google_calendar_id: string }[]
      try {
        const token = await getGoogleAccessToken(admin, connectionId, config)
        for (let i = 0; i < rows.length; i += PARALLEL) {
          const results = await Promise.allSettled(
            rows
              .slice(i, i + PARALLEL)
              .map((row) => deleteGoogleEvent(token, row.google_calendar_id, row.google_event_id)),
          )
          for (const result of results) {
            if (result.status === 'fulfilled') removed += 1
            else notRemoved += 1
          }
        }
      } catch (error) {
        // Access already gone: nothing can be removed by us any more.
        console.warn('[agenda google] disconnect could not remove events:', error)
        notRemoved += rows.length - removed
      }
    }

    const refreshToken = await readRefreshToken(admin, connectionId)
    if (refreshToken) await revokeGoogleToken(refreshToken)

    const { error } = await admin
      .from('google_connections')
      .delete()
      .eq('id', connectionId)
      .eq('account_id', ctx.accountId)
    if (error) throw error

    return NextResponse.json({ ok: true, removed, notRemoved })
  } catch (err) {
    return toErrorResponse(err)
  }
}

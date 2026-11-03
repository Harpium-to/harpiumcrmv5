import { NextResponse } from 'next/server'

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { encrypt } from '@/lib/whatsapp/encryption'
import { checkInstagramCreds } from '@/lib/instagram/api'

// ============================================================
// Per-account Instagram channel config. Any member reads; admins save.
//
// The token is stored encrypted and never returned — the GET says
// only whether one is set. A credential the UI can read back is a
// credential in a browser cache, a screenshot and a support ticket.
//
// Unlike Evolution there is no per-account webhook token to mint:
// Meta posts everything to one app-level URL and the workspace is
// found from the Instagram account id, so that id is what has to be
// right.
// ============================================================

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const { data } = await ctx.supabase
      .from('instagram_config')
      .select('ig_user_id, page_id, username, enabled, access_token')
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    return NextResponse.json({
      igUserId: data?.ig_user_id ?? '',
      pageId: data?.page_id ?? '',
      username: data?.username ?? '',
      enabled: data?.enabled ?? false,
      hasToken: Boolean(data?.access_token),
      // The operator pastes this into the Meta app dashboard.
      callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/instagram/webhook`,
      verifyTokenSet: Boolean(process.env.META_INSTAGRAM_VERIFY_TOKEN),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = await request.json().catch(() => ({}))

    const igUserId =
      typeof body?.igUserId === 'string' ? body.igUserId.trim() : ''
    const pageId = typeof body?.pageId === 'string' ? body.pageId.trim() : ''
    const enabled = Boolean(body?.enabled)
    const newToken =
      typeof body?.accessToken === 'string' && body.accessToken.trim()
        ? body.accessToken.trim()
        : null

    if (enabled && !igUserId) {
      return NextResponse.json(
        { error: 'O ID da conta do Instagram é obrigatório para ativar.' },
        { status: 400 },
      )
    }

    const admin = supabaseAdmin()

    const { data: current } = await admin
      .from('instagram_config')
      .select('access_token, username')
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (enabled && !newToken && !current?.access_token) {
      return NextResponse.json(
        { error: 'Cole o token da Página para ativar o canal.' },
        { status: 400 },
      )
    }

    // Verify before saving, and only when there is something new to
    // verify. Saving credentials that do not work and finding out on
    // the first customer message is the failure this avoids; the probe
    // reads the Instagram account itself, so a token that is valid but
    // cannot see *this* account is caught here too.
    let username = current?.username ?? null
    if (enabled && newToken) {
      const probe = await checkInstagramCreds({
        igUserId,
        accessToken: newToken,
      })
      if (!probe.ok) {
        return NextResponse.json(
          { error: `O Instagram recusou essas credenciais: ${probe.detail}` },
          { status: 400 },
        )
      }
      username = probe.username ?? username
    }

    const values: Record<string, unknown> = {
      account_id: ctx.accountId,
      ig_user_id: igUserId || null,
      page_id: pageId || null,
      username,
      enabled,
    }
    // Only overwrite the stored token when a new one was typed, so
    // saving the form to flip the switch never wipes the credential.
    if (newToken) values.access_token = encrypt(newToken)

    const { error } = await admin
      .from('instagram_config')
      .upsert(values, { onConflict: 'account_id' })

    if (error) {
      // The unique index on ig_user_id: another workspace already
      // receives this account's DMs, and silently taking it over would
      // reroute somebody else's inbox.
      if (error.code === '23505') {
        return NextResponse.json(
          {
            error:
              'Essa conta do Instagram já está conectada a outro workspace.',
          },
          { status: 409 },
        )
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, username })
  } catch (err) {
    return toErrorResponse(err)
  }
}

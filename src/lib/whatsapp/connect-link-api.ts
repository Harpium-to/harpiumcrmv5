// ============================================================
// The three answers about a CRM's WhatsApp connect link, shared by
// the CRM's own route (/api/whatsapp/connect-link, admins) and the
// agency console's (/api/agencia/crms/<id>/link-whatsapp). Each route
// decides WHO may ask; this decides WHAT they get.
//
//   GET     { link: { created_at, expires_at, via } | null }
//   POST    { url, message, expires_at }   — a new link; open ones stop
//   DELETE  { ok: true }                    — every open link stops
// ============================================================

import { NextResponse } from 'next/server'

import type { SupabaseClient } from '@supabase/supabase-js'

import { resolvePublicOrigin } from '@/lib/http/base-url'
import {
  ConnectLinkUnavailableError,
  connectLinkMessage,
  connectLinkUrl,
  createConnectLink,
  loadOpenConnectLink,
  revokeConnectLinks,
  type ConnectLinkVia,
} from './connect-links'

export async function connectLinkStatus(admin: SupabaseClient, accountId: string) {
  const link = await loadOpenConnectLink(admin, accountId)
  return NextResponse.json({
    link: link ? { created_at: link.createdAt, expires_at: link.expiresAt, via: link.via } : null,
  })
}

export async function newConnectLink(
  request: Request,
  admin: SupabaseClient,
  args: { accountId: string; userId: string; via: ConnectLinkVia; crmName: string | null },
) {
  try {
    const { token, expiresAt } = await createConnectLink(admin, {
      accountId: args.accountId,
      createdBy: args.userId,
      via: args.via,
    })
    const origin =
      resolvePublicOrigin(request, 'whatsapp connect link') ?? new URL(request.url).origin
    const url = connectLinkUrl(origin, token)
    return NextResponse.json({
      url,
      message: connectLinkMessage(url, args.crmName),
      expires_at: expiresAt,
    })
  } catch (err) {
    if (err instanceof ConnectLinkUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }
}

export async function cancelConnectLinks(admin: SupabaseClient, accountId: string) {
  try {
    await revokeConnectLinks(admin, accountId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ConnectLinkUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }
}

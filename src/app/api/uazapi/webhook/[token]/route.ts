import { NextResponse, after } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { dispatchInboundToEngines } from '@/lib/channels/inbound-dispatch'
import { resolveWhatsAppProvider } from '@/lib/channels/whatsapp-route'
import { decrypt } from '@/lib/whatsapp/encryption'
import { parseUazapiConnection, parseUazapiInbound } from '@/lib/uazapi/parse'
import { ingestUazapiInbound } from '@/lib/uazapi/inbound'
import { copyUazapiMediaToStorage } from '@/lib/uazapi/media'

// Inbound webhook for an account's UAZAPI instance. The `token` in the
// path identifies the account (no session) and is the shared secret,
// exactly as in the Evolution webhook.
//
// UAZAPI also puts the *instance* token in the body. We do not trust it
// for identification — it arrives from the network like everything else
// — but we do reject a body whose token doesn't match the instance we
// have on file, so a leaked URL alone can't inject messages.
//
// Since D1 the work runs after the response (media downloads and the
// bots can take a while, and UAZAPI does not retry a failed delivery),
// and a customer message reaches flows, automations and the AI — but
// only when this CRM sends through this same connection. Otherwise the
// answer would leave from another number.

// Media copy + flows + AI, after the response. Same headroom as the
// Meta webhook.
export const maxDuration = 60

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    payload = {}
  }

  const admin = supabaseAdmin()

  const { data: cfg, error } = await admin
    .from('uazapi_config')
    .select('account_id, base_url, instance_token')
    .eq('webhook_token', token)
    .maybeSingle()
  if (error) {
    console.error('[uazapi webhook] config lookup failed:', error.message)
    return NextResponse.json({ error: 'erro no servidor' }, { status: 500 })
  }
  if (!cfg) {
    return NextResponse.json({ error: 'token inválido' }, { status: 404 })
  }

  // Body token must match the instance we minted/stored, when both exist.
  let instanceToken: string | null = null
  if (cfg.instance_token) {
    try {
      instanceToken = decrypt(cfg.instance_token)
    } catch {
      instanceToken = null
    }
    const got =
      typeof (payload as { token?: unknown })?.token === 'string'
        ? (payload as { token: string }).token
        : null
    if (instanceToken && got && got !== instanceToken) {
      return NextResponse.json({ error: 'token inválido' }, { status: 404 })
    }
  }

  // The phone connected, logged out, went offline for too long, or got
  // banned: keep the cached state current so the agency console and the
  // settings screen show it without anyone polling the gateway.
  const connection = parseUazapiConnection(payload)
  if (connection) {
    const { error: upErr } = await admin
      .from('uazapi_config')
      .update({ status: connection.status, updated_at: new Date().toISOString() })
      .eq('account_id', cfg.account_id)
    if (upErr) console.error('[uazapi webhook] status update failed:', upErr.message)
    if (connection.status !== 'connected') {
      console.warn(
        `[uazapi webhook] account ${cfg.account_id} is ${connection.status}`,
        connection.reason ?? '',
      )
    }
    return NextResponse.json({ ok: true, connection: connection.status })
  }

  const messages = parseUazapiInbound(payload)
  if (messages.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 })
  }

  const { data: account } = await admin
    .from('accounts')
    .select('owner_user_id')
    .eq('id', cfg.account_id)
    .maybeSingle()
  if (!account) {
    return NextResponse.json({ error: 'erro no servidor' }, { status: 500 })
  }

  const accountId = cfg.account_id as string
  const ownerUserId = account.owner_user_id as string
  const srv =
    cfg.base_url && instanceToken ? { baseUrl: cfg.base_url as string, token: instanceToken } : null

  after(async () => {
    // Bots answer only when replies leave through this connection.
    const provider = await resolveWhatsAppProvider(admin, accountId)
    for (const msg of messages) {
      try {
        const stored = await ingestUazapiInbound(
          admin,
          { id: accountId, ownerUserId },
          msg,
          {
            resolveMedia: srv
              ? (externalId) => copyUazapiMediaToStorage(admin, accountId, srv, externalId)
              : undefined,
          },
        )
        if (!stored || msg.fromMe || provider !== 'uazapi') continue
        await dispatchInboundToEngines({
          accountId,
          ownerUserId,
          contactId: stored.contactId,
          conversationId: stored.conversationId,
          externalId: msg.externalId,
          text: msg.text,
          interactiveReplyId: msg.interactiveReplyId,
          contentType: stored.contentType,
          isFirstInbound: stored.isFirstInbound,
          contactCreated: stored.contactCreated,
        })
      } catch (err) {
        console.error('[uazapi webhook] ingest failed:', err)
      }
    }
  })

  // Answer fast; UAZAPI does not retry a failed delivery.
  return NextResponse.json({ ok: true, received: messages.length })
}

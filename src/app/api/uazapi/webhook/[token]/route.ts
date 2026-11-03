import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { parseUazapiInbound } from '@/lib/uazapi/parse'
import { ingestUazapiInbound } from '@/lib/uazapi/inbound'

// Inbound webhook for an account's UAZAPI instance. The `token` in the
// path identifies the account (no session) and is the shared secret,
// exactly as in the Evolution webhook.
//
// UAZAPI also puts the *instance* token in the body. We do not trust it
// for identification — it arrives from the network like everything else
// — but we do reject a body whose token doesn't match the instance we
// have on file, so a leaked URL alone can't inject messages.
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
    .select('account_id, instance_token')
    .eq('webhook_token', token)
    .maybeSingle()
  if (error) {
    console.error('[uazapi webhook] config lookup failed:', error.message)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
  if (!cfg) {
    return NextResponse.json({ error: 'invalid token' }, { status: 404 })
  }

  // Body token must match the instance we minted/stored, when both exist.
  if (cfg.instance_token) {
    let expected: string | null = null
    try {
      expected = decrypt(cfg.instance_token)
    } catch {
      expected = null
    }
    const got =
      typeof (payload as { token?: unknown })?.token === 'string'
        ? (payload as { token: string }).token
        : null
    if (expected && got && got !== expected) {
      return NextResponse.json({ error: 'invalid token' }, { status: 404 })
    }
  }

  const { data: account } = await admin
    .from('accounts')
    .select('owner_user_id')
    .eq('id', cfg.account_id)
    .maybeSingle()
  if (!account) {
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }

  const messages = parseUazapiInbound(payload)
  for (const msg of messages) {
    try {
      await ingestUazapiInbound(
        admin,
        { id: cfg.account_id, ownerUserId: account.owner_user_id },
        msg,
      )
    } catch (err) {
      console.error('[uazapi webhook] ingest failed:', err)
    }
  }

  // Answer fast; UAZAPI does not retry a failed delivery.
  return NextResponse.json({ ok: true, processed: messages.length })
}

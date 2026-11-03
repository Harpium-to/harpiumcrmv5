import { NextResponse } from 'next/server'

import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { parseInstagramWebhook } from '@/lib/instagram/parse'
import { ingestInstagramInbound } from '@/lib/instagram/inbound'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'

// ============================================================
// Meta's app-level Instagram messaging webhook.
//
// App-level, not per-account: Meta posts every app subscription to one
// callback URL, so the workspace is resolved from the Instagram
// account id in the payload — the same shape the leadgen webhook
// already uses. That is why `instagram_config.ig_user_id` is unique:
// two rows claiming the same Instagram account would make the
// destination of an inbound DM a coin toss.
//
// Always answers 200 once the signature checks out. Meta retries a
// whole delivery it did not get a 200 for, so a single bad message
// returning 500 would replay the good ones beside it — which, with
// agents switched on, means sending the same reply again.
// ============================================================

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const expected = process.env.META_INSTAGRAM_VERIFY_TOKEN
  if (mode === 'subscribe' && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200 })
  }
  return new Response('Forbidden', { status: 403 })
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256') ?? ''
  // Anyone can POST to this URL; the signature is what makes the
  // payload the app's own. Checked before the body is even parsed.
  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'assinatura inválida' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const messages = parseInstagramWebhook(payload)
  if (messages.length === 0) return NextResponse.json({ ok: true, processed: 0 })

  const admin = supabaseAdmin()
  let processed = 0

  for (const msg of messages) {
    try {
      const { data: cfg } = await admin
        .from('instagram_config')
        .select('account_id, enabled')
        .eq('ig_user_id', msg.igUserId)
        .maybeSingle()
      if (!cfg) {
        console.warn('[instagram webhook] no account for', msg.igUserId)
        continue
      }
      // A disabled channel still belongs to someone; dropping the DM
      // rather than storing it is the point of the switch.
      if (!cfg.enabled) continue

      const { data: account } = await admin
        .from('accounts')
        .select('owner_user_id')
        .eq('id', cfg.account_id)
        .maybeSingle()
      if (!account) continue

      const result = await ingestInstagramInbound(
        admin,
        { id: cfg.account_id, ownerUserId: account.owner_user_id },
        msg,
      )
      if (!result) continue
      processed += 1

      // Same auto-reply path as WhatsApp, which is the whole point of
      // Instagram being a channel rather than a separate product: one
      // team of agents, one set of rules, two doors.
      // `dispatchInboundToAiReply` owns its gates and never throws.
      await dispatchInboundToAiReply({
        accountId: cfg.account_id,
        conversationId: result.conversationId,
        contactId: result.contactId,
        configOwnerUserId: account.owner_user_id,
      })
    } catch (err) {
      console.error('[instagram webhook] ingest failed:', err)
    }
  }

  return NextResponse.json({ ok: true, processed })
}

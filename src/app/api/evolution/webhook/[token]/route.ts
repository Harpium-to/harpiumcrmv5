import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { parseEvolutionInbound } from '@/lib/evolution/parse'
import { ingestEvolutionInbound } from '@/lib/evolution/inbound'

// Inbound webhook for an account's Evolution instance. The `token` in the
// path identifies the account (no session). Evolution posts messages here;
// we turn inbound text into contacts/conversations/messages, same as the
// Meta webhook. The URL token is the shared secret.
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
    .from('evolution_config')
    .select('account_id')
    .eq('webhook_token', token)
    .maybeSingle()
  if (error) {
    console.error('[evolution webhook] config lookup failed:', error.message)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
  if (!cfg) {
    return NextResponse.json({ error: 'invalid token' }, { status: 404 })
  }

  const { data: account } = await admin
    .from('accounts')
    .select('owner_user_id')
    .eq('id', cfg.account_id)
    .maybeSingle()
  if (!account) {
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }

  const messages = parseEvolutionInbound(payload)
  for (const msg of messages) {
    try {
      await ingestEvolutionInbound(
        admin,
        { id: cfg.account_id, ownerUserId: account.owner_user_id },
        msg,
      )
    } catch (err) {
      console.error('[evolution webhook] ingest failed:', err)
    }
  }

  return NextResponse.json({ ok: true, processed: messages.length })
}

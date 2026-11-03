import { NextResponse } from 'next/server'

import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { decrypt } from '@/lib/whatsapp/encryption'
import { supabaseAdmin } from '@/lib/leads/admin-client'
import { fetchLead } from '@/lib/leads/meta'
import { normalizeLead } from '@/lib/leads/parse'
import { ingestLead } from '@/lib/leads/ingest'

// Meta app-level `leadgen` webhook. GET verifies the subscription;
// POST receives lead notifications, then fetches each lead's data with
// the stored Page token and runs the shared ingestLead.

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const expected = process.env.META_LEADS_VERIFY_TOKEN
  if (mode === 'subscribe' && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200 })
  }
  return new Response('Forbidden', { status: 403 })
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256') ?? ''
  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'assinatura inválida' }, { status: 401 })
  }

  let payload: {
    entry?: Array<{
      changes?: Array<{
        field?: string
        value?: {
          leadgen_id?: string
          page_id?: string
          form_id?: string
          ad_id?: string
        }
      }>
    }>
  }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const admin = supabaseAdmin()

  // Always 200 back to Meta even if individual leads fail — otherwise
  // Meta retries the whole batch. Per-lead errors are logged.
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'leadgen' || !change.value?.leadgen_id) continue
      const { leadgen_id: leadgenId, page_id: pageId } = change.value
      try {
        await processLead(admin, leadgenId, pageId)
      } catch (err) {
        console.error('[meta leadgen] processing failed:', err)
      }
    }
  }

  return NextResponse.json({ ok: true })
}

async function processLead(
  admin: ReturnType<typeof supabaseAdmin>,
  leadgenId: string,
  pageId: string | undefined,
) {
  if (!pageId) return

  const { data: page } = await admin
    .from('meta_lead_pages')
    .select('account_id, access_token')
    .eq('page_id', pageId)
    .maybeSingle()
  if (!page) {
    console.warn('[meta leadgen] no connected page for', pageId)
    return
  }

  const { data: account } = await admin
    .from('accounts')
    .select('owner_user_id')
    .eq('id', page.account_id)
    .maybeSingle()
  if (!account) return

  const pageToken = decrypt(page.access_token)
  const raw = await fetchLead(leadgenId, pageToken)
  const normalized = normalizeLead(raw)

  await ingestLead(
    admin,
    { id: page.account_id, ownerUserId: account.owner_user_id },
    normalized,
    raw,
  )
}

import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/leads/admin-client'
import { normalizeLead } from '@/lib/leads/parse'
import { ingestLead } from '@/lib/leads/ingest'

// Public lead-ingest webhook. The `token` in the path identifies the
// account (there is no session). Accepts Google Lead Form, Meta Lead Ads,
// and generic JSON payloads (see normalizeLead). Meta's native app-level
// leadgen webhook — which routes by page_id and needs app review — is a
// separate follow-up; today Meta leads arrive here via a forwarder.
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

  const { data: cfg, error: cfgErr } = await admin
    .from('lead_ingest')
    .select('account_id, google_key')
    .eq('token', token)
    .maybeSingle()
  if (cfgErr) {
    console.error('[leads ingest] config lookup failed:', cfgErr.message)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
  if (!cfg) {
    return NextResponse.json({ error: 'invalid token' }, { status: 404 })
  }

  // Google Lead Form deliveries carry a `google_key`; if the account set
  // one, it must match. (Other sources authenticate by the URL token.)
  const dict =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : {}
  if (Array.isArray(dict.user_column_data) && cfg.google_key) {
    const provided =
      typeof dict.google_key === 'string' ? dict.google_key : ''
    if (provided !== cfg.google_key) {
      return NextResponse.json({ error: 'invalid key' }, { status: 401 })
    }
  }

  const { data: acc, error: accErr } = await admin
    .from('accounts')
    .select('owner_user_id')
    .eq('id', cfg.account_id)
    .maybeSingle()
  if (accErr || !acc) {
    console.error('[leads ingest] account lookup failed:', accErr?.message)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }

  const normalized = normalizeLead(payload)
  try {
    const result = await ingestLead(
      admin,
      { id: cfg.account_id, ownerUserId: acc.owner_user_id },
      normalized,
      payload,
    )
    return NextResponse.json({
      ok: true,
      lead_id: result.leadId,
      contact_id: result.contactId,
    })
  } catch (err) {
    console.error('[leads ingest] failed:', err)
    return NextResponse.json({ error: 'ingest failed' }, { status: 500 })
  }
}

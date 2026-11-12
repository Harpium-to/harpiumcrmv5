import { randomBytes } from 'node:crypto'

import { NextResponse } from 'next/server'

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { hasMinRole } from '@/lib/auth/roles'
import { supabaseAdmin } from '@/lib/leads/admin-client'

// Per-account lead-ingest config: the ingest token (secret in the public
// URL) and the optional Google Lead Form key. Any member can read it;
// only admins+ can change the Google key.

export async function GET() {
  try {
    const ctx = await getCurrentAccount()

    let { data } = await ctx.supabase
      .from('lead_ingest')
      .select('token, google_key')
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    // Accounts created after the migration backfill get their token lazily.
    if (!data) {
      const token = randomBytes(32).toString('hex')
      const { error } = await supabaseAdmin()
        .from('lead_ingest')
        .upsert({ account_id: ctx.accountId, token }, { onConflict: 'account_id' })
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      data = { token, google_key: null }
    }

    return NextResponse.json({
      token: data.token,
      googleKey: data.google_key ?? null,
      canManage: hasMinRole(ctx.role, 'admin'),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = await request.json().catch(() => ({}))
    const googleKey =
      typeof body?.googleKey === 'string' ? body.googleKey.trim() : ''

    const { error } = await supabaseAdmin()
      .from('lead_ingest')
      .update({ google_key: googleKey || null })
      .eq('account_id', ctx.accountId)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

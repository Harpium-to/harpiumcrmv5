import { randomBytes } from 'node:crypto'

import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/leads/admin-client'
import { isMissingTable } from '@/lib/leads/mappings'

// Named tokens for the lead URL, one per origin (migration 068).
// Members list them; admins create and revoke. A revoked token answers
// 401 at once; the account's original URL is not affected.

const UNAVAILABLE = {
  available: false,
  error: 'Tokens por origem ainda não estão ativos (falta aplicar a migration 068).',
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const { data, error } = await ctx.supabase
      .from('lead_ingest_tokens')
      .select('id, name, token, created_at, last_used_at, revoked_at')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ ...UNAVAILABLE, tokens: [] })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ available: true, tokens: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await request.json().catch(() => ({}))) as { name?: unknown }
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
    if (!name) {
      return NextResponse.json({ error: 'Dê um nome ao token (ex.: Quiz planejados)' }, { status: 400 })
    }
    const { data, error } = await supabaseAdmin()
      .from('lead_ingest_tokens')
      .insert({
        account_id: ctx.accountId,
        name,
        token: randomBytes(32).toString('hex'),
        created_by: ctx.userId,
      })
      .select('id, name, token, created_at, last_used_at, revoked_at')
      .single()
    if (error) {
      if (isMissingTable(error)) return NextResponse.json(UNAVAILABLE, { status: 503 })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ token: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
    const { data, error } = await supabaseAdmin()
      .from('lead_ingest_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .is('revoked_at', null)
      .select('id')
    if (error) {
      if (isMissingTable(error)) return NextResponse.json(UNAVAILABLE, { status: 503 })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Token não encontrado ou já revogado' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

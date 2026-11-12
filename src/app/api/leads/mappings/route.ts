import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/leads/admin-client'
import { isMissingTable, isValidTarget } from '@/lib/leads/mappings'
import { foldKey, slugify } from '@/lib/leads/parse'

// The "de/para" per origin (migration 068): for each incoming field key
// of one origin, where it goes — the note, nowhere, a contact column or
// a custom field. Keys without a choice follow the default rule.

const UNAVAILABLE = {
  available: false,
  error: 'O de/para ainda não está ativo (falta aplicar a migration 068).',
}

const MAX_KEYS = 200

function readSource(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  // leads.source is a slug or meta / google / other; keep it as stored.
  return s && s.length <= 60 && slugify(s) === s ? s : null
}

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const source = readSource(new URL(request.url).searchParams.get('source'))
    if (!source) return NextResponse.json({ error: 'origem inválida' }, { status: 400 })
    const { data, error } = await ctx.supabase
      .from('lead_field_mappings')
      .select('field_key, target')
      .eq('account_id', ctx.accountId)
      .eq('source', source)
    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ ...UNAVAILABLE, mappings: {} })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const mappings: Record<string, string> = {}
    for (const row of (data ?? []) as { field_key: string; target: string }[]) {
      mappings[row.field_key] = row.target
    }
    return NextResponse.json({ available: true, mappings })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * Body: `{ source, mappings: { "<key>": "<target>" | null } }`. A null
 * (or "auto") target removes the choice, back to the default rule.
 */
export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await request.json().catch(() => ({}))) as {
      source?: unknown
      mappings?: unknown
    }
    const source = readSource(body.source)
    if (!source) return NextResponse.json({ error: 'origem inválida' }, { status: 400 })
    if (typeof body.mappings !== 'object' || body.mappings === null || Array.isArray(body.mappings)) {
      return NextResponse.json({ error: 'mappings precisa ser um objeto' }, { status: 400 })
    }
    const entries = Object.entries(body.mappings as Record<string, unknown>).slice(0, MAX_KEYS)

    const admin = supabaseAdmin()
    const { data: own } = await admin
      .from('custom_fields')
      .select('id')
      .eq('account_id', ctx.accountId)
    const ownIds = new Set(((own ?? []) as { id: string }[]).map((f) => f.id))

    const upserts: { account_id: string; source: string; field_key: string; target: string; updated_at: string }[] = []
    const removals: string[] = []
    const now = new Date().toISOString()
    for (const [rawKey, rawTarget] of entries) {
      const key = foldKey(rawKey).slice(0, 100)
      if (!key) continue
      if (rawTarget === null || rawTarget === '' || rawTarget === 'auto') {
        removals.push(key)
        continue
      }
      const target = String(rawTarget)
      if (!isValidTarget(target)) {
        return NextResponse.json({ error: `destino inválido para "${rawKey}"` }, { status: 400 })
      }
      if (target.startsWith('custom:') && !ownIds.has(target.slice('custom:'.length))) {
        return NextResponse.json({ error: `campo personalizado desconhecido para "${rawKey}"` }, { status: 400 })
      }
      upserts.push({ account_id: ctx.accountId, source, field_key: key, target, updated_at: now })
    }

    if (upserts.length > 0) {
      const { error } = await admin
        .from('lead_field_mappings')
        .upsert(upserts, { onConflict: 'account_id,source,field_key' })
      if (error) {
        if (isMissingTable(error)) return NextResponse.json(UNAVAILABLE, { status: 503 })
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }
    if (removals.length > 0) {
      const { error } = await admin
        .from('lead_field_mappings')
        .delete()
        .eq('account_id', ctx.accountId)
        .eq('source', source)
        .in('field_key', removals)
      if (error && !isMissingTable(error)) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }
    return NextResponse.json({ ok: true, saved: upserts.length, removed: removals.length })
  } catch (err) {
    return toErrorResponse(err)
  }
}

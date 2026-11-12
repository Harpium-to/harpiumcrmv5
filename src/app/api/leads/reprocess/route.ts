import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/leads/admin-client'
import { reprocessLead, type StoredLead } from '@/lib/leads/ingest'
import { loadFieldMappings } from '@/lib/leads/mappings'
import { normalizeLead } from '@/lib/leads/parse'

// Run stored leads through today's rules again (admins only).
//
//   { ids: [...] }        → those leads (up to BATCH)
//   { cursor?: string }   → the next BATCH leads received before
//                           `cursor`, newest first; the answer carries
//                           `next_cursor` until the list is exhausted.
//
// Safe to repeat: contacts are only backfilled, tags and custom values
// upsert, and each lead's note is written once.

const BATCH = 25

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await request.json().catch(() => ({}))) as {
      ids?: unknown
      cursor?: unknown
    }
    const admin = supabaseAdmin()

    const { data: acc, error: accErr } = await admin
      .from('accounts')
      .select('owner_user_id')
      .eq('id', ctx.accountId)
      .maybeSingle()
    if (accErr || !acc) {
      return NextResponse.json({ error: 'conta não encontrada' }, { status: 500 })
    }
    const account = { id: ctx.accountId, ownerUserId: acc.owner_user_id as string }

    let query = admin
      .from('leads')
      .select('id, raw, contact_id, created_at, source')
      .eq('account_id', ctx.accountId)
      .not('raw', 'is', null)
      .order('created_at', { ascending: false })
      .limit(BATCH)

    const ids = Array.isArray(body.ids)
      ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, BATCH)
      : null
    if (ids) {
      if (ids.length === 0) return NextResponse.json({ ok: true, processed: 0, next_cursor: null })
      query = query.in('id', ids)
    } else if (typeof body.cursor === 'string' && body.cursor) {
      query = query.lt('created_at', body.cursor)
    }

    const { data: rows, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const leads = (rows ?? []) as StoredLead[]
    const mappingCache = new Map<string, Record<string, string>>()
    let created = 0
    let withContact = 0
    for (const row of leads) {
      const source = normalizeLead(row.raw).source
      let mappings = mappingCache.get(source)
      if (!mappings) {
        mappings = await loadFieldMappings(admin, ctx.accountId, source)
        mappingCache.set(source, mappings)
      }
      try {
        const r = await reprocessLead(admin, account, row, mappings)
        if (r.contactStatus === 'criado') created++
        if (r.contactId) withContact++
      } catch (err) {
        console.error('[leads reprocess] failed for', row.id, err)
      }
    }

    const nextCursor =
      !ids && leads.length === BATCH ? leads[leads.length - 1].created_at : null
    return NextResponse.json({
      ok: true,
      processed: leads.length,
      contacts_created: created,
      with_contact: withContact,
      next_cursor: nextCursor,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

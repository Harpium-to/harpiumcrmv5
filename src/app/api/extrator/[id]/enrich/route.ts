// ============================================================
// POST /api/extrator/{id}/enrich — read the sites of the next rows
// that have one, for the WhatsApp link, the e-mail and the Instagram
// (src/lib/extractor/enrich.ts). The screen calls it until `remaining`
// is 0. Admins only.
// ============================================================

import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { enrichNext } from '@/lib/extractor/enrich'
import { getExtraction } from '@/lib/extractor/store'
import { supabaseAdmin } from '@/lib/leads/admin-client'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const extraction = await getExtraction(ctx.supabase, ctx.accountId, id)
    if (!extraction) return NextResponse.json({ error: 'Extração não encontrada.' }, { status: 404 })
    return NextResponse.json(await enrichNext(supabaseAdmin(), ctx.accountId, id))
  } catch (err) {
    return toErrorResponse(err)
  }
}

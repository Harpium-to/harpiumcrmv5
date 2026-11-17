// ============================================================
// POST /api/extrator/{id}/import
//      { result_ids: [...], list_name, complete_existing? }
//
// "Enviar para o CRM": the marked rows become contacts with the list's
// tag, silently — no card in the funnel and no "lead recebido"
// (src/lib/extractor/import.ts). The screen sends the list in batches.
// Admins only.
// ============================================================

import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { ImportError, importResults, parseImportInput } from '@/lib/extractor/import'
import { getExtraction } from '@/lib/extractor/store'
import { supabaseAdmin } from '@/lib/leads/admin-client'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const extraction = await getExtraction(ctx.supabase, ctx.accountId, id)
    if (!extraction) return NextResponse.json({ error: 'Extração não encontrada.' }, { status: 404 })

    let input
    try {
      input = parseImportInput(await request.json().catch(() => null))
    } catch (err) {
      if (err instanceof ImportError) return NextResponse.json({ error: err.message }, { status: err.status })
      throw err
    }

    const admin = supabaseAdmin()
    const { data: account } = await admin
      .from('accounts')
      .select('owner_user_id')
      .eq('id', ctx.accountId)
      .maybeSingle()
    const ownerUserId = (account as { owner_user_id?: string } | null)?.owner_user_id
    if (!ownerUserId) return NextResponse.json({ error: 'CRM sem dono cadastrado.' }, { status: 409 })

    const outcome = await importResults(admin, { id: ctx.accountId, ownerUserId }, extraction, input)
    return NextResponse.json(outcome)
  } catch (err) {
    return toErrorResponse(err)
  }
}

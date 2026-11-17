// ============================================================
// POST /api/extrator/{id}/tasks  { due_at? }
//
// "Criar lista de ligação": one task per lead of the extraction that
// is already in the CRM, for whoever asked. The path of least risk —
// nobody gets banned for calling. Admins only.
// ============================================================

import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { createCallList } from '@/lib/extractor/import'
import { getExtraction } from '@/lib/extractor/store'
import { supabaseAdmin } from '@/lib/leads/admin-client'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const extraction = await getExtraction(ctx.supabase, ctx.accountId, id)
    if (!extraction) return NextResponse.json({ error: 'Extração não encontrada.' }, { status: 404 })
    const body = (await request.json().catch(() => null)) as { due_at?: unknown } | null
    const due = typeof body?.due_at === 'string' && Number.isFinite(Date.parse(body.due_at)) ? body.due_at : null
    const result = await createCallList(
      supabaseAdmin(),
      ctx.accountId,
      id,
      ctx.userId,
      ctx.userId,
      due ? new Date(due).toISOString() : null,
    )
    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}

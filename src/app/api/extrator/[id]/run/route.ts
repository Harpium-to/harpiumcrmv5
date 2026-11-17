// ============================================================
// POST /api/extrator/{id}/run — advance the extraction by one slice.
//
// The open screen calls this in a loop while the job is going, so the
// person sees it fill up; the scheduler does the same for jobs nobody
// is watching (src/lib/extractor/run.ts). Admins only.
// ============================================================

import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { runExtractionSlice } from '@/lib/extractor/run'
import { getExtraction } from '@/lib/extractor/store'
import { supabaseAdmin } from '@/lib/leads/admin-client'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const row = await getExtraction(ctx.supabase, ctx.accountId, id)
    if (!row) return NextResponse.json({ error: 'Extração não encontrada.' }, { status: 404 })
    if (row.status === 'queued' || row.status === 'running') {
      await runExtractionSlice(supabaseAdmin(), id)
    }
    const now = await getExtraction(ctx.supabase, ctx.accountId, id)
    return NextResponse.json({
      status: now?.status ?? row.status,
      found: now?.found ?? row.found,
      requested: row.requested,
      error: now?.error ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

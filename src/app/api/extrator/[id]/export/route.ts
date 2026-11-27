// ============================================================
// GET /api/extrator/{id}/export — the extraction as a spreadsheet
// (CSV that Excel opens). Every row, whatever its situation: the
// "Situação" column says which is which.
// ============================================================

import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { RESULT_EXPORT_COLUMNS } from '@/lib/extractor/export'
import { getExtraction, RESULT_COLUMNS, type ResultRow } from '@/lib/extractor/store'
import { csvResponse, slugForFilename, toCsv } from '@/lib/reports/csv'

const CHUNK = 1000

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getCurrentAccount()
    const { id } = await params
    const extraction = await getExtraction(ctx.supabase, ctx.accountId, id)
    if (!extraction) return NextResponse.json({ error: 'Extração não encontrada.' }, { status: 404 })

    const rows: ResultRow[] = []
    for (let from = 0; ; from += CHUNK) {
      const { data, error } = await ctx.supabase
        .from('lead_extraction_results')
        .select(RESULT_COLUMNS)
        .eq('account_id', ctx.accountId)
        .eq('extraction_id', id)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + CHUNK - 1)
      if (error) throw new Error(error.message)
      const part = (data ?? []) as ResultRow[]
      rows.push(...part)
      if (part.length < CHUNK) break
    }
    const day = new Date().toISOString().slice(0, 10)
    return csvResponse(toCsv(rows, RESULT_EXPORT_COLUMNS), `extrator-${slugForFilename(extraction.name)}-${day}.csv`)
  } catch (err) {
    return toErrorResponse(err)
  }
}

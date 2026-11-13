// ============================================================
// GET /api/quiz/{id}/export?since=<ISO>&campaign=&creative=
//
// Everyone who opened the quiz in the period, one line each, as a CSV:
// contact, where they stopped or which result they got, the campaign,
// and a column per question. Recomputed from the database, like the
// other exports — this is the file that gets mailed around.
// ============================================================

import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { csvResponse, slugForFilename, toCsv } from '@/lib/reports/csv'
import { ReportTooLargeError } from '@/lib/reports/fetch-all'
import { applyFilter, buildPeople, parseSince, peopleTable } from '@/lib/quiz/report'
import { loadReportData } from '@/lib/quiz/report-data'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getCurrentAccount()
    const { id } = await params
    const url = new URL(request.url)

    const data = await loadReportData(
      ctx.supabase,
      ctx.accountId,
      id,
      parseSince(url.searchParams.get('since')),
    )
    if (!data) return NextResponse.json({ error: 'Quiz não encontrado.' }, { status: 404 })

    const sessions = applyFilter(data.sessions, {
      campaign: url.searchParams.get('campaign') || undefined,
      creative: url.searchParams.get('creative') || undefined,
    })
    const table = peopleTable(data.definition, buildPeople(data.definition, sessions))
    const csv = toCsv(
      table.rows,
      table.headers.map((header, i) => ({ header, value: (row: string[]) => row[i] })),
    )
    const day = new Date().toISOString().slice(0, 10)
    return csvResponse(csv, `quiz-${slugForFilename(data.quiz.name)}-${day}.csv`)
  } catch (err) {
    if (err instanceof ReportTooLargeError) {
      return NextResponse.json({ error: err.message }, { status: 413 })
    }
    return toErrorResponse(err)
  }
}

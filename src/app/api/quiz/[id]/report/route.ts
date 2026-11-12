// ============================================================
// GET /api/quiz/{id}/report?since=<ISO>&campaign=&creative=
//
// The numbers of a quiz and the people behind them, for the Relatório
// tab. Any member of the CRM may read it — the same people who already
// see the leads. Worked out here, from the database, on every call.
// ============================================================

import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { ReportTooLargeError } from '@/lib/reports/fetch-all'
import { applyFilter, buildPeople, buildReport, parseSince } from '@/lib/quiz/report'
import { loadReportData } from '@/lib/quiz/report-data'

/** People sent to the screen; the CSV has them all. */
const PEOPLE_ON_SCREEN = 300

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getCurrentAccount()
    const { id } = await params
    const url = new URL(request.url)
    const filter = {
      campaign: url.searchParams.get('campaign') || undefined,
      creative: url.searchParams.get('creative') || undefined,
    }

    const data = await loadReportData(
      ctx.supabase,
      ctx.accountId,
      id,
      parseSince(url.searchParams.get('since')),
    )
    if (!data) return NextResponse.json({ error: 'Quiz não encontrado.' }, { status: 404 })

    const filtered = applyFilter(data.sessions, filter)
    return NextResponse.json({
      report: buildReport(data.definition, data.sessions, filter),
      people: buildPeople(data.definition, filtered.slice(0, PEOPLE_ON_SCREEN)),
      peopleTotal: filtered.length,
    })
  } catch (err) {
    if (err instanceof ReportTooLargeError) {
      return NextResponse.json({ error: err.message }, { status: 413 })
    }
    return toErrorResponse(err)
  }
}

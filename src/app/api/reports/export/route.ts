import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { loadReportBundle } from '@/lib/reports/queries'
import { rangeFromSearchParams } from '@/lib/reports/request'
import { ReportTooLargeError } from '@/lib/reports/fetch-all'
import { exportReport, isExportId } from '@/lib/reports/export'
import { csvResponse, slugForFilename } from '@/lib/reports/csv'

/**
 * GET /api/reports/export?report=funnel&period=last30
 *
 * One section as a CSV download. Recomputed server-side rather than
 * serialised from numbers the client posts back — an export is the
 * artefact that gets mailed to a client, so it has to come from the
 * database and not from whatever the page happens to be holding.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const url = new URL(request.url)

    const report = url.searchParams.get('report')
    if (!isExportId(report)) {
      return NextResponse.json(
        { error: 'Relatório desconhecido' },
        { status: 400 },
      )
    }

    const range = rangeFromSearchParams(url.searchParams)
    const bundle = await loadReportBundle(supabase, accountId, range)
    const result = exportReport(report, bundle)

    if (!result) {
      // The agent sections before migrations 044/045. An empty file
      // would be read as "we did nothing", which is a different claim.
      return NextResponse.json(
        {
          error:
            'Esse relatório depende dos agentes, que ainda não estão ' +
            'instalados neste banco.',
        },
        { status: 409 },
      )
    }

    const stamp = range.dayKeys[0] ?? 'periodo'
    const filename = `${slugForFilename(result.filenamePart)}-${stamp}.csv`
    return csvResponse(result.csv, filename)
  } catch (err) {
    if (err instanceof ReportTooLargeError) {
      return NextResponse.json({ error: err.message }, { status: 413 })
    }
    return toErrorResponse(err)
  }
}

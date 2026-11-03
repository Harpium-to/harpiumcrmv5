import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { loadReportBundle } from '@/lib/reports/queries'
import { rangeFromSearchParams } from '@/lib/reports/request'
import { ReportTooLargeError } from '@/lib/reports/fetch-all'

/**
 * GET /api/reports?period=last30&tz=America/Sao_Paulo
 *
 * Every number the reports screen shows, for one window. Any member
 * may read: the figures are the account's own operation, and gating
 * them behind admin would mean the people doing the work cannot see
 * how it is going.
 *
 * One request rather than one per card. The aggregations share reads
 * (the contacts fetch feeds four breakdowns and the lead goals), so
 * splitting them would multiply the round trips to the database for a
 * screen people land on once.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const url = new URL(request.url)
    const range = rangeFromSearchParams(url.searchParams)
    const bundle = await loadReportBundle(supabase, accountId, range)
    return NextResponse.json(bundle)
  } catch (err) {
    if (err instanceof ReportTooLargeError) {
      // 413 rather than a truncated report: the window is the problem
      // and the message says so.
      return NextResponse.json({ error: err.message }, { status: 413 })
    }
    return toErrorResponse(err)
  }
}

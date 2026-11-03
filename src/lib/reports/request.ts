import {
  PERIOD_IDS,
  resolvePeriod,
  safeTimezone,
  type DateRange,
  type PeriodId,
} from './range'

// ============================================================
// Reading a report window off a request.
//
// Shared by the bundle route, the export and the analyst so all three
// resolve the same window from the same query string — an export that
// disagreed with the chart above it by one day would be impossible to
// debug from the outside.
//
// The zone comes from the client, because the account has no timezone
// column and "hoje" means the viewer's today. Validated here, since
// anything in a query string is arbitrary and `Intl` throws on a bad
// zone name.
// ============================================================

export function rangeFromSearchParams(params: URLSearchParams): DateRange {
  const raw = params.get('period')
  const period: PeriodId = (PERIOD_IDS as string[]).includes(raw ?? '')
    ? (raw as PeriodId)
    : 'last30'
  return resolvePeriod(period, new Date(), safeTimezone(params.get('tz')), {
    from: params.get('from'),
    to: params.get('to'),
  })
}

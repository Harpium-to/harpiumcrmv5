// ============================================================
// Report periods.
//
// Pure: takes a period, a clock and a zone, returns instants. `now` is
// always a parameter, so "what does last month mean on the 1st at
// 00:30" is a test rather than something you find out on the 1st.
//
// WHY THIS DOESN'T USE THE DASHBOARD'S date-utils
//   Those helpers work in the *process's* local time
//   (`startOfLocalDay`, `new Date(dayKey)`). On a server that is UTC,
//   so "hoje" for a client in São Paulo starts at 21:00 the previous
//   day and every daily number is shifted by three hours. The repo
//   already has a test failing on exactly that confusion
//   (`new Date("2026-05-18")` is a Sunday in Brasília), and a revenue
//   figure that moves depending on which machine rendered it is worse
//   than a missing one.
//
//   So every boundary here is wall-clock midnight *in a named zone*,
//   resolved through Intl — the same reasoning as
//   `lib/agents/schedule.ts`, for the same reason: offsets are not
//   constants, and a hand-rolled one is wrong twice a year.
// ============================================================

export type PeriodId =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'last90'
  | 'this_month'
  | 'last_month'
  | 'custom'

export const PERIOD_IDS: PeriodId[] = [
  'today',
  'yesterday',
  'last7',
  'last30',
  'last90',
  'this_month',
  'last_month',
  'custom',
]

export interface DateRange {
  /** Inclusive start, as an ISO instant. */
  fromIso: string
  /** Exclusive end, as an ISO instant — always use `< toIso`. */
  toIso: string
  /** The zone the day boundaries were computed in. */
  timezone: string
  /** `YYYY-MM-DD` keys in `timezone`, one per day, for series. */
  dayKeys: string[]
}

export const DEFAULT_REPORT_TIMEZONE = 'America/Sao_Paulo'

interface CalendarDay {
  year: number
  month: number // 1-12
  day: number
}

/** Validate an IANA zone, falling back rather than throwing. */
export function safeTimezone(timezone: string | null | undefined): string {
  if (!timezone) return DEFAULT_REPORT_TIMEZONE
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return timezone
  } catch {
    return DEFAULT_REPORT_TIMEZONE
  }
}

/**
 * How far `timeZone` is from UTC at this instant, in milliseconds.
 *
 * Derived by formatting the instant in the zone and reading that wall
 * time back as if it were UTC. The difference is the offset — correct
 * across DST, and correct for the zones with non-hour offsets
 * (Kathmandu, Adelaide) that an offset table gets wrong.
 */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0')

  // `hour12: false` yields 24 for midnight in some runtimes.
  const hour = get('hour') % 24

  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second'),
  )
  return asUtc - date.getTime()
}

/** The calendar date at `date`, as seen in `timeZone`. */
export function zonedCalendarDay(date: Date, timeZone: string): CalendarDay {
  const offset = zoneOffsetMs(date, timeZone)
  const shifted = new Date(date.getTime() + offset)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

export function dayKeyOf(day: CalendarDay): string {
  const mm = String(day.month).padStart(2, '0')
  const dd = String(day.day).padStart(2, '0')
  return `${day.year}-${mm}-${dd}`
}

/** `YYYY-MM-DD` for the day `date` falls on in `timeZone`. */
export function zonedDayKey(date: Date, timeZone: string): string {
  return dayKeyOf(zonedCalendarDay(date, timeZone))
}

/**
 * The instant at which wall-clock midnight begins on `dayKey`.
 *
 * Two passes. The first guesses by treating the wall time as UTC and
 * subtracting the offset seen at that guess; on a DST boundary the
 * offset at the *result* can differ, so the second pass re-reads it.
 * Without that, the two days a year a zone shifts land an hour off —
 * which is how a daily report silently double-counts an hour of
 * messages once a year.
 */
export function startOfZonedDay(dayKey: string, timeZone: string): Date {
  const guess = new Date(`${dayKey}T00:00:00Z`)
  const firstOffset = zoneOffsetMs(guess, timeZone)
  let result = new Date(guess.getTime() - firstOffset)
  const secondOffset = zoneOffsetMs(result, timeZone)
  if (secondOffset !== firstOffset) {
    result = new Date(guess.getTime() - secondOffset)
  }
  return result
}

/** Calendar arithmetic, so DST-short days never shorten a step. */
function addDays(day: CalendarDay, amount: number): CalendarDay {
  const d = new Date(Date.UTC(day.year, day.month - 1, day.day))
  d.setUTCDate(d.getUTCDate() + amount)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  }
}

function addMonths(day: CalendarDay, amount: number): CalendarDay {
  const total = day.year * 12 + (day.month - 1) + amount
  return {
    year: Math.floor(total / 12),
    month: (total % 12) + 1,
    day: day.day,
  }
}

const MAX_DAY_KEYS = 400

function keysBetween(start: CalendarDay, endExclusive: CalendarDay): string[] {
  const keys: string[] = []
  const last = dayKeyOf(endExclusive)
  let cursor = start
  // Bounded: a hand-typed custom range of a decade would otherwise
  // build 3,650 buckets the chart cannot draw.
  for (let i = 0; i < MAX_DAY_KEYS; i += 1) {
    const key = dayKeyOf(cursor)
    if (key >= last) break
    keys.push(key)
    cursor = addDays(cursor, 1)
  }
  return keys
}

function build(
  start: CalendarDay,
  endExclusive: CalendarDay,
  timezone: string,
): DateRange {
  return {
    fromIso: startOfZonedDay(dayKeyOf(start), timezone).toISOString(),
    toIso: startOfZonedDay(dayKeyOf(endExclusive), timezone).toISOString(),
    timezone,
    dayKeys: keysBetween(start, endExclusive),
  }
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

/** A `YYYY-MM-DD` string that names a real date, or null. */
export function parseDayKey(value: unknown): CalendarDay | null {
  if (typeof value !== 'string' || !DAY_KEY_RE.test(value)) return null
  const [year, month, day] = value.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  // Round-trip so 2026-02-31 is rejected rather than rolling into March.
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    return null
  }
  return { year, month, day }
}

export interface ResolveOptions {
  /** For `custom`: inclusive first day, `YYYY-MM-DD`. */
  from?: unknown
  /** For `custom`: inclusive last day, `YYYY-MM-DD`. */
  to?: unknown
}

/**
 * Turn a period into instants.
 *
 * The end is always exclusive and always the start of a day, including
 * for periods that contain today: a report whose window ends at "now"
 * changes every time you refresh it, so two people comparing numbers
 * on a call see different figures. Ending at tomorrow's midnight makes
 * today's number stable for the whole day.
 */
export function resolvePeriod(
  period: PeriodId,
  now: Date,
  timezone: string,
  opts: ResolveOptions = {},
): DateRange {
  const zone = safeTimezone(timezone)
  const today = zonedCalendarDay(now, zone)
  const tomorrow = addDays(today, 1)

  switch (period) {
    case 'today':
      return build(today, tomorrow, zone)
    case 'yesterday':
      return build(addDays(today, -1), today, zone)
    case 'last7':
      // Includes today, so "últimos 7 dias" is 7 buckets, not 8.
      return build(addDays(today, -6), tomorrow, zone)
    case 'last30':
      return build(addDays(today, -29), tomorrow, zone)
    case 'last90':
      return build(addDays(today, -89), tomorrow, zone)
    case 'this_month':
      return build({ ...today, day: 1 }, tomorrow, zone)
    case 'last_month': {
      const firstOfThis = { ...today, day: 1 }
      return build(addMonths(firstOfThis, -1), firstOfThis, zone)
    }
    case 'custom': {
      const from = parseDayKey(opts.from)
      const to = parseDayKey(opts.to)
      // A custom range missing or reversed falls back to the last 30
      // days rather than erroring: the period comes from a URL, and a
      // hand-edited one should still render a report.
      if (!from || !to) return build(addDays(today, -29), tomorrow, zone)
      const ordered =
        dayKeyOf(from) <= dayKeyOf(to) ? { from, to } : { from: to, to: from }
      return build(ordered.from, addDays(ordered.to, 1), zone)
    }
  }
}

/**
 * The window of the same length immediately before `range`, for
 * period-over-period deltas.
 *
 * Measured in days rather than by shifting the calendar, so comparing
 * "this month" on the 9th looks at the 9 days before the 1st — the
 * same amount of time. Comparing 9 days against a full previous month
 * is the classic way a dashboard reports a catastrophic decline on the
 * 2nd of every month.
 */
export function previousRange(range: DateRange): DateRange {
  const from = parseDayKey(zonedDayKey(new Date(range.fromIso), range.timezone))
  if (!from) return range
  const length = Math.max(range.dayKeys.length, 1)
  return build(addDays(from, -length), from, range.timezone)
}

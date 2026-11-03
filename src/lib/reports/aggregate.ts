import { findGoalMetric, goalLabelKey } from '@/lib/agents/goals'
import { dayKeyOf, zonedDayKey } from './range'
import type { DateRange } from './range'
import type {
  BreakdownRow,
  DayPoint,
  DealOutcome,
  FirstResponseSummary,
  ForecastBucket,
  GoalAttainmentRow,
  TwoSeriesDayPoint,
} from './types'

// ============================================================
// The arithmetic, with no database in it.
//
// Split from `queries.ts` so the parts that can be wrong in a way
// nobody notices — scaling a monthly target to a 7-day window, a win
// rate over an empty month, a breakdown whose rows stop adding up to
// the total — are testable without a Supabase client. Every function
// here takes rows and returns rows.
// ============================================================

/** The bucket rows with no value fall into. The UI labels it. */
export const UNASSIGNED = '__unassigned__'
/** The folded long tail of a breakdown. */
export const OTHER = '__other__'

/**
 * `numeric` crosses PostgREST as a string, so every sum needs this.
 * `'1200.00' + '800.00'` is `'1200.00800.00'`, and a revenue report is
 * the worst place to discover that.
 */
export function num(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!
}

export interface ClosedDeal {
  status: string
  value: number | string | null
  closed_at: string | null
  assigned_to: string | null
}

export function summariseClosed(rows: readonly ClosedDeal[]) {
  let wonCount = 0
  let wonValue = 0
  let lostCount = 0
  for (const row of rows) {
    if (row.status === 'won') {
      wonCount += 1
      wonValue += num(row.value)
    } else if (row.status === 'lost') {
      lostCount += 1
    }
  }
  return { wonCount, wonValue, lostCount }
}

export function buildOutcome(
  current: readonly ClosedDeal[],
  previous: readonly ClosedDeal[],
  approximate: boolean,
): DealOutcome {
  const now = summariseClosed(current)
  const before = summariseClosed(previous)
  const decided = now.wonCount + now.lostCount
  return {
    wonCount: { current: now.wonCount, previous: before.wonCount },
    wonValue: { current: now.wonValue, previous: before.wonValue },
    lostCount: { current: now.lostCount, previous: before.lostCount },
    // Null rather than 0 when nothing closed: a 0% win rate means you
    // lost everything you decided, and an empty month did not.
    winRate: decided > 0 ? now.wonCount / decided : null,
    averageTicket: now.wonCount > 0 ? now.wonValue / now.wonCount : null,
    approximate,
  }
}

/**
 * Two counts per day, over the window's buckets.
 *
 * Pre-seeded from `range.dayKeys` so a day with no activity is a zero
 * and not a missing point — a line chart that skips empty days draws a
 * straight line across a quiet week and makes it look busy.
 *
 * A row whose stamp falls outside the window is dropped rather than
 * clamped into the first or last bucket.
 */
export function twoSeriesByDay<T>(
  rows: readonly T[],
  range: DateRange,
  stampOf: (row: T) => string | null,
  isA: (row: T) => boolean,
): TwoSeriesDayPoint[] {
  const buckets = new Map<string, { a: number; b: number }>()
  for (const day of range.dayKeys) buckets.set(day, { a: 0, b: 0 })
  for (const row of rows) {
    const stamp = stampOf(row)
    if (!stamp) continue
    const bucket = buckets.get(zonedDayKey(new Date(stamp), range.timezone))
    if (!bucket) continue
    if (isA(row)) bucket.a += 1
    else bucket.b += 1
  }
  return range.dayKeys.map((day) => ({
    day,
    ...(buckets.get(day) ?? { a: 0, b: 0 }),
  }))
}

export function closedByDay(
  rows: readonly ClosedDeal[],
  range: DateRange,
): TwoSeriesDayPoint[] {
  return twoSeriesByDay(
    rows,
    range,
    (row) => row.closed_at,
    (row) => row.status === 'won',
  )
}

export function countByDay(
  stamps: readonly string[],
  range: DateRange,
): DayPoint[] {
  const buckets = new Map<string, number>()
  for (const day of range.dayKeys) buckets.set(day, 0)
  for (const stamp of stamps) {
    const key = zonedDayKey(new Date(stamp), range.timezone)
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  return range.dayKeys.map((day) => ({ day, value: buckets.get(day) ?? 0 }))
}

/**
 * Group rows on one field.
 *
 * Two rules that exist so the rows always add up to the total:
 *   * null / blank collapse into one bucket instead of being dropped.
 *     "we don't know the source of 40% of our leads" is the finding.
 *   * past `limit`, the tail folds into one row instead of being cut.
 * A breakdown whose parts don't sum to the whole is one people stop
 * trusting, and they are right to.
 */
export function groupBy<T>(
  rows: readonly T[],
  pick: (row: T) => string | null,
  measure?: (row: T) => number,
  limit = 12,
): BreakdownRow[] {
  const totals = new Map<string, { count: number; measured: number }>()
  for (const row of rows) {
    const raw = pick(row)
    const key = raw && raw.trim() ? raw.trim() : UNASSIGNED
    const entry = totals.get(key) ?? { count: 0, measured: 0 }
    entry.count += 1
    if (measure) entry.measured += measure(row)
    totals.set(key, entry)
  }

  const all = [...totals.entries()]
    .map(([key, entry]) => ({
      key,
      label: key === UNASSIGNED ? '' : key,
      count: entry.count,
      value: measure ? entry.measured : null,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      // On a tie the unknown bucket loses to a real one. The first row
      // of a breakdown reads as "your main source", and "(sem
      // informação)" is a residual, not a source. It still rises on
      // count alone, because "we don't know where most of our leads
      // came from" is a headline when it's true.
      const aUnknown = a.key === UNASSIGNED
      const bUnknown = b.key === UNASSIGNED
      if (aUnknown !== bUnknown) return aUnknown ? 1 : -1
      return a.key.localeCompare(b.key)
    })

  if (all.length <= limit) return all

  const head = all.slice(0, limit - 1)
  const tail = all.slice(limit - 1)
  head.push({
    key: OTHER,
    label: '',
    count: tail.reduce((sum, row) => sum + row.count, 0),
    value: measure ? tail.reduce((sum, row) => sum + (row.value ?? 0), 0) : null,
  })
  return head
}

export const FORECAST_ORDER = [
  'overdue',
  'this_month',
  'next_month',
  'later',
  'undated',
] as const

/**
 * Open deals by when they are expected to close.
 *
 * `overdue` first on purpose: a deal whose expected date has passed
 * while it sits open is the most actionable row on the screen, and
 * filing it under "later" is how a forecast becomes decoration.
 *
 * `today` is a `YYYY-MM-DD` key in the report's zone, passed in rather
 * than read from the clock so the boundary is testable.
 */
export function bucketForecast(
  rows: readonly { expected_close_date: string | null; value: number | string | null }[],
  todayKey: string,
): ForecastBucket[] {
  const thisMonth = todayKey.slice(0, 7)
  const [year, month] = thisMonth.split('-').map(Number) as [number, number]
  const nextDate = new Date(Date.UTC(year, month, 1))
  const nextMonth = dayKeyOf({
    year: nextDate.getUTCFullYear(),
    month: nextDate.getUTCMonth() + 1,
    day: 1,
  }).slice(0, 7)

  const totals = new Map<string, { count: number; value: number }>()
  for (const key of FORECAST_ORDER) totals.set(key, { count: 0, value: 0 })

  for (const row of rows) {
    const date = row.expected_close_date
    let bucket: string
    if (!date) bucket = 'undated'
    else if (date < todayKey) bucket = 'overdue'
    else if (date.startsWith(thisMonth)) bucket = 'this_month'
    else if (date.startsWith(nextMonth)) bucket = 'next_month'
    else bucket = 'later'
    const entry = totals.get(bucket)!
    entry.count += 1
    entry.value += num(row.value)
  }

  return FORECAST_ORDER.map((bucket) => ({
    bucket,
    ...(totals.get(bucket) ?? { count: 0, value: 0 }),
  }))
}

/** Days a per-day / per-week / per-month target covers. */
const PERIOD_DAYS: Record<string, number> = { day: 1, week: 7, month: 30 }

export interface GoalInputs {
  agents: ReadonlyArray<{
    id: string
    name: string
    goals: Record<string, number> | null
  }>
  runs: ReadonlyArray<{ agent_id: string | null; status: string }>
  tasks: ReadonlyArray<{ agent_id: string | null; kind: string; status: string }>
  contactOwnerIds: ReadonlyArray<string | null>
  /** Days in the report window. */
  windowDays: number
}

/**
 * Target versus actual, per agent per metric.
 *
 * Two things this gets right that a naive version does not:
 *
 *   * The target is scaled to the window. A monthly target read
 *     against a 7-day view would show a closer missing a
 *     10-deals-a-month goal by 90% every single week.
 *   * A metric with no measurement source reports `actual: null` and
 *     `measured: false`, never 0. There is no meetings table and no
 *     agent attribution on deals (see `GoalSource`), so those targets
 *     cannot be counted — and 0% would read as an agent failing
 *     completely, which is how somebody switches off an agent that is
 *     working fine.
 */
export function buildGoals(input: GoalInputs): GoalAttainmentRow[] {
  const { agents, runs, tasks, contactOwnerIds, windowDays } = input
  const out: GoalAttainmentRow[] = []

  for (const agent of agents) {
    for (const [metricId, rawTarget] of Object.entries(agent.goals ?? {})) {
      const target = Number(rawTarget)
      if (!Number.isFinite(target) || target <= 0) continue

      const metric = findGoalMetric(metricId)
      const source = metric?.source ?? null
      const perDay = target / (PERIOD_DAYS[metric?.period ?? 'day'] ?? 1)
      const scaled = perDay * Math.max(windowDays, 1)

      let actual: number | null = null
      if (source?.from === 'agent_runs') {
        actual = runs.filter(
          (run) => run.agent_id === agent.id && run.status === source.status,
        ).length
      } else if (source?.from === 'agent_tasks') {
        actual = tasks.filter(
          (task) =>
            task.agent_id === agent.id &&
            task.kind === source.kind &&
            task.status === 'done',
        ).length
      } else if (source?.from === 'contacts_owned') {
        actual = contactOwnerIds.filter((id) => id === agent.id).length
      }

      out.push({
        agentId: agent.id,
        agentName: agent.name,
        metricId,
        metricLabelKey: goalLabelKey(metricId),
        target: Math.round(scaled * 100) / 100,
        actual,
        ratio: actual !== null && scaled > 0 ? actual / scaled : null,
        measured: source !== null,
      })
    }
  }

  return out.sort((a, b) => {
    // Unmeasured last: that is a gap in the product, not a ranking.
    if (a.measured !== b.measured) return a.measured ? -1 : 1
    return (a.ratio ?? 0) - (b.ratio ?? 0)
  })
}

// ------------------------------------------------------------
// First response
// ------------------------------------------------------------

/** What `report_first_response` (migration 048) returns. */
export interface RawFirstResponse {
  replied: number
  unreplied: number
  median_seconds: number | null
  p90_seconds: number | null
  by_responder: { responder: string; replied: number; median_seconds: number | null }[]
  by_day: { day: string; replied: number; median_seconds: number | null }[]
}

/** Seconds → minutes, one decimal: "0,4 min" is a real answer for a bot. */
function toMinutes(seconds: number | null | undefined): number | null {
  if (seconds === null || seconds === undefined) return null
  const n = Number(seconds)
  return Number.isFinite(n) ? Math.round(n / 6) / 10 : null
}

export function buildFirstResponse(
  raw: RawFirstResponse,
  range: DateRange,
): FirstResponseSummary {
  const byDay = new Map((raw.by_day ?? []).map((d) => [d.day, d]))
  return {
    replied: Number(raw.replied ?? 0),
    unreplied: Number(raw.unreplied ?? 0),
    medianMinutes: toMinutes(raw.median_seconds),
    p90Minutes: toMinutes(raw.p90_seconds),
    byResponder: (raw.by_responder ?? []).map((r) => ({
      responder: r.responder,
      replied: Number(r.replied),
      medianMinutes: toMinutes(r.median_seconds),
    })),
    byDay: range.dayKeys.map((day) => {
      const point = byDay.get(day)
      return {
        day,
        replied: point ? Number(point.replied) : 0,
        medianMinutes: point ? toMinutes(point.median_seconds) : null,
      }
    }),
  }
}

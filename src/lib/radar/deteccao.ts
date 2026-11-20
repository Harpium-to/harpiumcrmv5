import {
  METRICS,
  RATES,
  alertHref,
  dimensionLabel,
  formatValue,
  type GoodDirection,
  type MetricDef,
  type RateDef,
} from './metricas'
import { addDays, daysBetween, weekdayOf } from './tempo'

// ============================================================
// The anomaly detector, pure. Every number is compared with the normal
// of *this* CRM: the same weekday over the last weeks (a Monday with a
// Monday), by median and median absolute deviation, so one odd week in
// the history does not move the normal. It speaks only when three
// things agree — far from normal (k deviations), a real change in %,
// and enough volume — because a Radar that cries wolf stops being read.
// See docs/plano-radar-monitoramento.md §5.2.
// ============================================================

export type Sensitivity = 'baixa' | 'normal' | 'alta'

export const THRESHOLDS: Record<Sensitivity, { k: number; rel: number }> = {
  baixa: { k: 4, rel: 0.4 },
  normal: { k: 3, rel: 0.3 },
  alta: { k: 2.25, rel: 0.2 },
}

/** Weeks of history the normal is taken from. */
export const BASELINE_WEEKS = 6
/** At least this many of them must exist to judge anything. */
export const MIN_BASELINE_POINTS = 4

export interface LedgerRow {
  day: string
  metric: string
  dimension: string
  value: number
}

/** metric_daily rows, by metric and dimension. */
export class Ledger {
  private readonly series = new Map<string, Map<string, number>>()
  private readonly dims = new Map<string, Set<string>>()

  constructor(rows: readonly LedgerRow[]) {
    for (const r of rows) {
      const key = `${r.metric}|${r.dimension}`
      let s = this.series.get(key)
      if (!s) {
        s = new Map()
        this.series.set(key, s)
      }
      s.set(r.day, Number(r.value))
      if (r.dimension) {
        const set = this.dims.get(r.metric) ?? new Set<string>()
        set.add(r.dimension)
        this.dims.set(r.metric, set)
      }
    }
  }

  /** The day's value; a missing day is 0 for counts, "no data" otherwise. */
  get(metric: string, dimension: string, day: string, zeroWhenMissing: boolean): number | null {
    const v = this.series.get(`${metric}|${dimension}`)?.get(day)
    if (v !== undefined) return v
    return zeroWhenMissing ? 0 : null
  }

  sum(metric: string, dimension: string, from: string, to: string): number {
    let total = 0
    for (let d = from; d <= to; d = addDays(d, 1)) total += this.get(metric, dimension, d, true) ?? 0
    return total
  }

  dimensions(metric: string): string[] {
    return [...(this.dims.get(metric) ?? [])].sort()
  }
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/**
 * Far from normal? Robust z-score against the baseline, with a floor
 * on the spread so a perfectly flat history (always 10) does not turn
 * an 11 into a huge deviation. Counts get the floor counts naturally
 * have (proportional to the square root of the volume); minutes and
 * money a share of the normal.
 */
export function judge(
  x: number,
  baseline: readonly number[],
  opts: { k: number; rel: number; minVolume: number; unit: MetricDef['unit'] },
): { flagged: boolean; normal: number; z: number } {
  const m = median(baseline)
  const mad = median(baseline.map((v) => Math.abs(v - m))) * 1.4826
  const floor =
    opts.unit === 'count'
      ? Math.max(0.75 * Math.sqrt(Math.max(m, 1)), 1)
      : opts.unit === 'minutes'
        ? Math.max(0.15 * m, 2)
        : Math.max(0.25 * m, 1)
  const scale = Math.max(mad, floor)
  const diff = x - m
  const z = diff / scale
  const relChange = Math.abs(diff) / Math.max(m, 1)
  const volume = Math.max(x, m) >= opts.minVolume
  return { flagged: Math.abs(z) >= opts.k && relChange >= opts.rel && volume, normal: m, z }
}

export type Tone = 'ruim' | 'bom' | 'neutro'

export function toneOf(good: GoodDirection, direction: 'alta' | 'queda'): Tone {
  if (good === 'neutral') return 'neutro'
  if (good === 'up') return direction === 'alta' ? 'bom' : 'ruim'
  return direction === 'alta' ? 'ruim' : 'bom'
}

export interface Finding {
  metric: string
  dimension: string
  period: 'dia' | 'semana'
  periodStart: string
  periodEnd: string
  value: number
  expected: number
  direction: 'alta' | 'queda'
  tone: Tone
  severity: 'atencao' | 'alta'
  /** |z|: how far from normal, for ordering. */
  score: number
  title: string
  detail: string
  href: string
}

const WEEKDAY = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']
const WEEKDAY_PLURAL = [
  'das segundas',
  'das terças',
  'das quartas',
  'das quintas',
  'das sextas',
  'dos sábados',
  'dos domingos',
]

const ddmm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`

/** "Leads do Instagram", "Leads sem origem", or the metric's own label. */
function subject(def: MetricDef, dimension: string): { text: string; plural: boolean } {
  if (!dimension) return { text: def.label, plural: def.unit !== 'minutes' && def.unit !== 'money' }
  const name = dimensionLabel(def.key, dimension)
  if (name === 'sem origem') return { text: 'Leads sem origem', plural: true }
  const masculine = ['Instagram', 'Facebook', 'Google', 'WhatsApp', 'site', 'Meta (anúncios)']
  return { text: `Leads ${masculine.includes(name) ? 'do' : 'de'} ${name}`, plural: true }
}

function verb(plural: boolean, direction: 'alta' | 'queda'): string {
  if (direction === 'alta') return plural ? 'subiram' : 'subiu'
  return plural ? 'caíram' : 'caiu'
}

function finding(
  def: MetricDef,
  dimension: string,
  period: 'dia' | 'semana',
  start: string,
  end: string,
  x: number,
  normal: number,
  z: number,
  k: number,
): Finding {
  const direction = x > normal ? 'alta' : 'queda'
  const who = subject(def, dimension)
  const pct = Math.round((Math.abs(x - normal) / Math.max(normal, 1)) * 100)
  const v = (n: number) => formatValue(def.unit, n)

  const title =
    def.unit === 'minutes'
      ? `${who.text} ${verb(who.plural, direction)}: ${v(x)} (normal: ${v(normal)})`
      : `${who.text} ${verb(who.plural, direction)} ${pct}%${period === 'semana' ? ' na semana' : ''}`
  const detail =
    period === 'dia'
      ? `${v(x)} na ${WEEKDAY[weekdayOf(start) - 1]}, ${ddmm(start)}; o normal ${WEEKDAY_PLURAL[weekdayOf(start) - 1]} é ${v(normal)}.`
      : `${v(x)} de ${ddmm(start)} a ${ddmm(end)}; o normal de uma semana é ${v(normal)}.`

  return {
    metric: def.key,
    dimension,
    period,
    periodStart: start,
    periodEnd: end,
    value: x,
    expected: Math.round(normal * 100) / 100,
    direction,
    tone: toneOf(def.good, direction),
    severity: Math.abs(z) >= k + 2 ? 'alta' : 'atencao',
    score: Math.abs(z),
    title,
    detail,
    href: alertHref(def.href, start, end),
  }
}

export interface DetectOptions {
  sensitivity: Sensitivity
  /** First day of the ledger. */
  trackedSince: string
  /** Weeks of history before any verdict (§7, decision 6). */
  minWeeks: number
}

/** Is the CRM still learning its normal on `day`? */
export function isLearning(day: string, trackedSince: string, minWeeks: number): boolean {
  return daysBetween(trackedSince, day) < minWeeks * 7
}

/** One closed day against the same weekday of the weeks before. */
export function detectDay(ledger: Ledger, day: string, opts: DetectOptions): Finding[] {
  if (isLearning(day, opts.trackedSince, opts.minWeeks)) return []
  const { k, rel } = THRESHOLDS[opts.sensitivity]
  const out: Finding[] = []

  for (const def of METRICS) {
    if (!def.daily) continue
    if (def.key === 'primeira_resposta_min') {
      // A median of two waits is not a trend.
      if ((ledger.get('primeira_resposta_n', '', day, true) ?? 0) < 5) continue
    }
    const dims = ['', ...(def.byDimension ? ledger.dimensions(def.key) : [])]
    for (const dim of dims) {
      const zero = def.zeroWhenMissing || dim !== ''
      const x = ledger.get(def.key, dim, day, zero)
      if (x === null) continue
      const baseline: number[] = []
      for (let w = 1; w <= BASELINE_WEEKS; w++) {
        const d = addDays(day, -7 * w)
        if (d < opts.trackedSince) continue
        const v = ledger.get(def.key, dim, d, zero)
        if (v !== null) baseline.push(v)
      }
      if (baseline.length < MIN_BASELINE_POINTS) continue
      const verdict = judge(x, baseline, { k, rel, minVolume: def.minVolume, unit: def.unit })
      if (verdict.flagged) out.push(finding(def, dim, 'dia', day, day, x, verdict.normal, verdict.z, k))
    }
  }
  return out
}

/** The week ending on `end` (a Sunday) against the weeks before. */
export function detectWeek(ledger: Ledger, end: string, opts: DetectOptions): Finding[] {
  const start = addDays(end, -6)
  if (isLearning(start, opts.trackedSince, opts.minWeeks)) return []
  const { k, rel } = THRESHOLDS[opts.sensitivity]
  const out: Finding[] = []

  for (const def of METRICS) {
    if (def.unit === 'minutes') continue // a median does not add up over a week
    const dims = ['', ...(def.byDimension ? ledger.dimensions(def.key) : [])]
    for (const dim of dims) {
      const x = ledger.sum(def.key, dim, start, end)
      const baseline: number[] = []
      for (let w = 1; w <= BASELINE_WEEKS; w++) {
        const s = addDays(start, -7 * w)
        if (s < opts.trackedSince) continue
        baseline.push(ledger.sum(def.key, dim, s, addDays(s, 6)))
      }
      if (baseline.length < MIN_BASELINE_POINTS) continue
      const minVolume = def.daily ? def.minVolume * 3 : def.minVolume
      const verdict = judge(x, baseline, { k, rel, minVolume, unit: def.unit })
      if (verdict.flagged) out.push(finding(def, dim, 'semana', start, end, x, verdict.normal, verdict.z, k))
    }
  }

  for (const rate of RATES) {
    const r = detectRate(ledger, rate, start, end, opts, { k, rel })
    if (r) out.push(r)
  }
  return out
}

/** A rate of the week (faltas, taxa de ganho) against the pooled rate of the weeks before. */
export function detectRate(
  ledger: Ledger,
  rate: RateDef,
  start: string,
  end: string,
  opts: DetectOptions,
  t: { k: number; rel: number },
): Finding | null {
  const den = (from: string, to: string) => rate.denominator.reduce((s, m) => s + ledger.sum(m, '', from, to), 0)
  const n = den(start, end)
  if (n < rate.minEvents) return null
  const num = ledger.sum(rate.numerator, '', start, end)

  let numB = 0
  let denB = 0
  for (let w = 1; w <= BASELINE_WEEKS; w++) {
    const s = addDays(start, -7 * w)
    if (s < opts.trackedSince) continue
    numB += ledger.sum(rate.numerator, '', s, addDays(s, 6))
    denB += den(s, addDays(s, 6))
  }
  if (denB < rate.minEvents * 2) return null

  const p = num / n
  const p0 = numB / denB
  const se = Math.sqrt(Math.max(p0 * (1 - p0), 0.01) / n)
  const z = (p - p0) / se
  const gap = Math.abs(p - p0)
  if (Math.abs(z) < t.k || gap < 0.05 || gap / Math.max(p0, 0.05) < t.rel) return null

  const direction = p > p0 ? 'alta' : 'queda'
  const pct = (x: number) => formatValue('rate', x)
  const plural = rate.key === 'taxa_faltas'
  return {
    metric: rate.key,
    dimension: '',
    period: 'semana',
    periodStart: start,
    periodEnd: end,
    value: Math.round(p * 1000) / 1000,
    expected: Math.round(p0 * 1000) / 1000,
    direction,
    tone: toneOf(rate.good, direction),
    severity: Math.abs(z) >= t.k + 2 ? 'alta' : 'atencao',
    score: Math.abs(z),
    title: `${rate.label} ${verb(plural, direction)}: ${pct(p)} na semana (normal: ${pct(p0)})`,
    detail: `${num} de ${n} de ${ddmm(start)} a ${ddmm(end)}; nas semanas anteriores, ${pct(p0)}.`,
    href: alertHref(rate.href, start, end),
  }
}

/**
 * What reaches people: switched-off and snoozed alerts out, worst news
 * first, at most `limit` (a long list is not read).
 */
export function selectFindings(
  findings: readonly Finding[],
  opts: { disabled: readonly string[]; snoozed: Record<string, string>; today: string; limit?: number },
): Finding[] {
  const TONE_ORDER: Record<Tone, number> = { ruim: 0, neutro: 1, bom: 2 }
  return findings
    .filter((f) => !opts.disabled.includes(f.metric))
    .filter((f) => {
      const until = opts.snoozed[`${f.metric}|${f.dimension}`] ?? opts.snoozed[`${f.metric}|`]
      return !until || until < opts.today
    })
    .sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || b.score - a.score)
    .slice(0, opts.limit ?? 6)
}

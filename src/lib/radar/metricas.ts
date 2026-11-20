// ============================================================
// The Radar's metrics: what each key in metric_daily (079) means, how
// it reads to a person, and the rules the detector applies to it.
// Pure; keep in step with radar_compute_days.
// ============================================================

/** Which way is good news. 'neutral': a spike matters, but neither way is "bad". */
export type GoodDirection = 'up' | 'down' | 'neutral'

export interface MetricDef {
  key: string
  /** As it reads in a sentence: "Leads do Instagram". */
  label: string
  /** Lower-case, for the middle of a sentence. */
  noun: string
  unit: 'count' | 'minutes' | 'money' | 'rate'
  good: GoodDirection
  /**
   * Below this, the detector stays quiet: going from 1 to 2 leads is not
   * "+100%". Compared with the larger of the value and the normal.
   */
  minVolume: number
  /** Compared day by day (same weekday); otherwise only by week. */
  daily: boolean
  /** A missing day is a 0 (counts) — not "no data" (a median). */
  zeroWhenMissing: boolean
  /** Has a breakdown by `dimension` (lead origin) worth watching too. */
  byDimension?: boolean
  /** The screen the alert's button opens, on the alert's period (`alertHref`). */
  href: '/relatorios' | '/agenda'
}

export const METRICS: readonly MetricDef[] = [
  {
    key: 'leads',
    label: 'Leads novos',
    noun: 'leads novos',
    unit: 'count',
    good: 'up',
    minVolume: 5,
    daily: true,
    zeroWhenMissing: true,
    byDimension: true,
    href: '/relatorios',
  },
  {
    key: 'conversas_novas',
    label: 'Conversas novas',
    noun: 'conversas novas',
    unit: 'count',
    good: 'up',
    minVolume: 5,
    daily: true,
    zeroWhenMissing: true,
    href: '/relatorios',
  },
  {
    key: 'mensagens_recebidas',
    label: 'Mensagens recebidas',
    noun: 'mensagens recebidas',
    unit: 'count',
    good: 'neutral',
    minVolume: 30,
    daily: true,
    zeroWhenMissing: true,
    href: '/relatorios',
  },
  {
    key: 'primeira_resposta_min',
    label: 'Tempo da primeira resposta',
    noun: 'tempo da primeira resposta',
    unit: 'minutes',
    good: 'down',
    // Minutes: below 5 min nobody needs a warning.
    minVolume: 5,
    daily: true,
    zeroWhenMissing: false,
    href: '/relatorios',
  },
  {
    key: 'negocios_criados',
    label: 'Negócios criados',
    noun: 'negócios criados',
    unit: 'count',
    good: 'up',
    minVolume: 4,
    daily: false,
    zeroWhenMissing: true,
    href: '/relatorios',
  },
  {
    key: 'negocios_ganhos',
    label: 'Negócios ganhos',
    noun: 'negócios ganhos',
    unit: 'count',
    good: 'up',
    minVolume: 4,
    daily: false,
    zeroWhenMissing: true,
    href: '/relatorios',
  },
  {
    key: 'negocios_ganhos_valor',
    label: 'Valor ganho',
    noun: 'valor ganho',
    unit: 'money',
    good: 'up',
    minVolume: 1,
    daily: false,
    zeroWhenMissing: true,
    href: '/relatorios',
  },
  {
    key: 'negocios_perdidos',
    label: 'Negócios perdidos',
    noun: 'negócios perdidos',
    unit: 'count',
    good: 'down',
    minVolume: 4,
    daily: false,
    zeroWhenMissing: true,
    href: '/relatorios',
  },
  {
    key: 'consultas_marcadas',
    label: 'Consultas marcadas',
    noun: 'consultas marcadas',
    unit: 'count',
    good: 'up',
    minVolume: 5,
    daily: true,
    zeroWhenMissing: true,
    href: '/agenda',
  },
  {
    key: 'prazo_estourado',
    label: 'Conversas que passaram do prazo',
    noun: 'conversas que passaram do prazo',
    unit: 'count',
    good: 'down',
    minVolume: 3,
    daily: true,
    zeroWhenMissing: true,
    href: '/relatorios',
  },
]

/**
 * A rate built from two counts, watched by week: faltas sobre consultas
 * que aconteceram, perdas sobre negócios decididos.
 */
export interface RateDef {
  key: string
  label: string
  noun: string
  numerator: string
  /** The denominator is the sum of these metrics. */
  denominator: string[]
  good: GoodDirection
  /** Fewer events than this in the week: no verdict. */
  minEvents: number
  href: '/relatorios' | '/agenda'
}

export const RATES: readonly RateDef[] = [
  {
    key: 'taxa_faltas',
    label: 'Faltas na agenda',
    noun: 'taxa de faltas',
    numerator: 'faltas',
    denominator: ['faltas', 'consultas_realizadas'],
    good: 'down',
    minEvents: 10,
    href: '/agenda',
  },
  {
    key: 'taxa_ganho',
    label: 'Negócios fechando',
    noun: 'taxa de ganho',
    numerator: 'negocios_ganhos',
    denominator: ['negocios_ganhos', 'negocios_perdidos'],
    good: 'up',
    minEvents: 8,
    href: '/relatorios',
  },
]

/**
 * The link of an alert's button: the period the alert talks about, on
 * the screen that shows it — the agenda on that day, or the reports for
 * that day or week (they split leads by origin, and prazos by setor).
 */
export function alertHref(screen: '/relatorios' | '/agenda', periodStart: string, periodEnd: string): string {
  if (screen === '/agenda') return `/agenda?data=${periodStart}`
  return `/relatorios?period=custom&from=${periodStart}&to=${periodEnd}`
}

export const METRIC_BY_KEY: ReadonlyMap<string, MetricDef> = new Map(METRICS.map((m) => [m.key, m]))
export const RATE_BY_KEY: ReadonlyMap<string, RateDef> = new Map(RATES.map((r) => [r.key, r]))

/** Every key a person can switch off in Configurações › Radar. */
export const ALERT_KEYS: readonly { key: string; label: string }[] = [
  ...METRICS.map((m) => ({ key: m.key, label: m.label })),
  ...RATES.map((r) => ({ key: r.key, label: r.label })),
]

/** A dimension value as people read it. */
export function dimensionLabel(metric: string, dimension: string): string {
  if (!dimension) return ''
  if (metric === 'leads') {
    const known: Record<string, string> = {
      instagram: 'Instagram',
      facebook: 'Facebook',
      meta: 'Meta (anúncios)',
      google: 'Google',
      whatsapp: 'WhatsApp',
      site: 'site',
      'sem origem': 'sem origem',
    }
    return known[dimension.toLowerCase()] ?? dimension
  }
  return dimension
}

/** A number as it reads in an alert. */
export function formatValue(unit: MetricDef['unit'] | 'rate', value: number): string {
  if (unit === 'minutes') {
    if (value >= 120) return `${Math.round(value / 60)} h`
    return `${Math.round(value)} min`
  }
  if (unit === 'money') {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(value)
  }
  if (unit === 'rate') return `${Math.round(value * 100)}%`
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',')
}

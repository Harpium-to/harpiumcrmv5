import { describe, expect, it } from 'vitest'

import {
  detectDay,
  detectWeek,
  isLearning,
  judge,
  Ledger,
  selectFindings,
  type Finding,
  type LedgerRow,
} from './deteccao'
import { addDays } from './tempo'

const YESTERDAY = '2026-11-17' // a Tuesday
const SUNDAY = '2026-11-15'
const TRACKED = '2026-08-25'
const opts = { sensitivity: 'normal' as const, trackedSince: TRACKED, minWeeks: 4 }

/** A daily series: `pick(day, weeksAgo)` for every day of the last 12 weeks up to `last`. */
function series(metric: string, last: string, pick: (day: string, i: number) => number, dimension = ''): LedgerRow[] {
  const rows: LedgerRow[] = []
  for (let i = 0; i < 84; i++) {
    const day = addDays(last, -i)
    rows.push({ day, metric, dimension, value: pick(day, i) })
  }
  return rows
}

/** Tuesdays around 18 (16–20), other days around 10. */
const leadsTuesday = (dropTo?: number) =>
  series('leads', YESTERDAY, (day, i) => {
    if (i === 0 && dropTo !== undefined) return dropTo
    return i % 7 === 0 ? 16 + (i % 5) : 10
  })

describe('judge', () => {
  it('a flat history does not make an 11 out of a 10 a big deal', () => {
    expect(judge(11, [10, 10, 10, 10, 10, 10], { k: 3, rel: 0.3, minVolume: 5, unit: 'count' }).flagged).toBe(false)
  })
  it('small numbers never speak: 0 instead of 2', () => {
    expect(judge(0, [2, 2, 1, 2, 2, 2], { k: 3, rel: 0.3, minVolume: 5, unit: 'count' }).flagged).toBe(false)
  })
  it('a real drop does', () => {
    const v = judge(8, [17, 18, 16, 19, 20, 18], { k: 3, rel: 0.3, minVolume: 5, unit: 'count' })
    expect(v.flagged).toBe(true)
    expect(v.normal).toBe(18)
  })
})

describe('detectDay', () => {
  it('a drop against the same weekday becomes a "ruim" alert with the numbers', () => {
    const [f] = detectDay(new Ledger(leadsTuesday(8)), YESTERDAY, opts)
    expect(f).toMatchObject({
      metric: 'leads',
      dimension: '',
      period: 'dia',
      value: 8,
      expected: 18,
      direction: 'queda',
      tone: 'ruim',
      title: 'Leads novos caíram 56%',
    })
    expect(f.detail).toBe('8 na terça, 17/11; o normal das terças é 18.')
    // The button opens that day in the reports, which split leads by origin.
    expect(f.href).toBe(`/relatorios?period=custom&from=${YESTERDAY}&to=${YESTERDAY}`)
  })

  it('ordinary noise says nothing', () => {
    expect(detectDay(new Ledger(leadsTuesday(15)), YESTERDAY, opts)).toEqual([])
  })

  it('a CRM still learning its normal says nothing', () => {
    expect(isLearning(YESTERDAY, '2026-10-30', 4)).toBe(true)
    expect(detectDay(new Ledger(leadsTuesday(2)), YESTERDAY, { ...opts, trackedSince: '2026-10-30' })).toEqual([])
  })

  it('by origin: Instagram falls while Google holds', () => {
    const rows = [
      ...series('leads', YESTERDAY, (_d, i) => (i === 0 ? 10 : 22), ''),
      ...series('leads', YESTERDAY, (_d, i) => (i === 0 ? 2 : 12), 'instagram'),
      ...series('leads', YESTERDAY, () => 10, 'google'),
    ]
    const found = detectDay(new Ledger(rows), YESTERDAY, opts)
    expect(found.map((f) => f.title)).toEqual(['Leads novos caíram 55%', 'Leads do Instagram caíram 83%'])
  })

  it('a spike in messages is "neutro": worth knowing, not bad news', () => {
    const rows = series('mensagens_recebidas', YESTERDAY, (_d, i) => (i === 0 ? 150 : 50 + (i % 3)))
    const [f] = detectDay(new Ledger(rows), YESTERDAY, opts)
    expect(f).toMatchObject({ tone: 'neutro', direction: 'alta', title: 'Mensagens recebidas subiram 194%' })
  })

  it('first response: slower is bad, but only with enough waits that day', () => {
    const minutes = series('primeira_resposta_min', YESTERDAY, (_d, i) => (i === 0 ? 42 : 15))
    const many = series('primeira_resposta_n', YESTERDAY, () => 10)
    const [f] = detectDay(new Ledger([...minutes, ...many]), YESTERDAY, opts)
    expect(f).toMatchObject({ tone: 'ruim', title: 'Tempo da primeira resposta subiu: 42 min (normal: 15 min)' })

    const few = series('primeira_resposta_n', YESTERDAY, () => 3)
    expect(detectDay(new Ledger([...minutes, ...few]), YESTERDAY, opts)).toEqual([])
  })

  it('missing first-response days are "no data", not zero', () => {
    const rows: LedgerRow[] = [
      { day: YESTERDAY, metric: 'primeira_resposta_min', dimension: '', value: 40 },
      { day: YESTERDAY, metric: 'primeira_resposta_n', dimension: '', value: 10 },
    ]
    expect(detectDay(new Ledger(rows), YESTERDAY, opts)).toEqual([])
  })

  it('sensitivity moves the bar', () => {
    const rows = leadsTuesday(10)
    expect(detectDay(new Ledger(rows), YESTERDAY, { ...opts, sensitivity: 'baixa' })).toEqual([])
    expect(detectDay(new Ledger(rows), YESTERDAY, { ...opts, sensitivity: 'alta' })).toHaveLength(1)
  })
})

describe('detectWeek', () => {
  it('a slow drop shows in the week even when no single day is alarming', () => {
    const rows = series('leads', SUNDAY, (_d, i) => (i < 7 ? 6 : 10))
    const found = detectWeek(new Ledger(rows), SUNDAY, opts)
    expect(found.map((f) => f.title)).toContain('Leads novos caíram 40% na semana')
    expect(found[0].href).toBe(`/relatorios?period=custom&from=${found[0].periodStart}&to=${SUNDAY}`)
    expect(found[0].periodStart).toBe(addDays(SUNDAY, -6))
    const day = detectDay(new Ledger(rows), SUNDAY, opts)
    expect(day).toEqual([])
  })

  it('no-shows: the rate of the week against the weeks before', () => {
    const rows = [
      ...series('faltas', SUNDAY, (_d, i) => (i < 7 ? (i === 3 ? 0 : 1) : i % 7 === 0 ? 1 : 0)),
      ...series('consultas_realizadas', SUNDAY, () => 2),
    ]
    const found = detectWeek(new Ledger(rows), SUNDAY, opts)
    const rate = found.find((f) => f.metric === 'taxa_faltas')
    expect(rate).toMatchObject({ tone: 'ruim', direction: 'alta' })
    expect(rate?.title).toBe('Faltas na agenda subiram: 30% na semana (normal: 7%)')
    expect(rate?.href).toBe(`/agenda?data=${addDays(SUNDAY, -6)}`)
  })
})

describe('selectFindings', () => {
  const f = (patch: Partial<Finding>): Finding => ({
    metric: 'leads',
    dimension: '',
    period: 'dia',
    periodStart: YESTERDAY,
    periodEnd: YESTERDAY,
    value: 1,
    expected: 2,
    direction: 'queda',
    tone: 'ruim',
    severity: 'atencao',
    score: 3,
    title: 't',
    detail: 'd',
    href: '/',
    ...patch,
  })

  it('bad news first, switched-off and snoozed out, a short list', () => {
    const picked = selectFindings(
      [
        f({ metric: 'leads', tone: 'bom', score: 9 }),
        f({ metric: 'conversas_novas', tone: 'ruim', score: 3 }),
        f({ metric: 'mensagens_recebidas', tone: 'neutro', score: 5 }),
        f({ metric: 'faltas', tone: 'ruim', score: 8 }),
        f({ metric: 'leads', dimension: 'instagram', tone: 'ruim', score: 7 }),
      ],
      { disabled: ['faltas'], snoozed: { 'leads|instagram': '2026-11-20' }, today: '2026-11-18', limit: 2 },
    )
    expect(picked.map((x) => x.metric)).toEqual(['conversas_novas', 'mensagens_recebidas'])
  })
})

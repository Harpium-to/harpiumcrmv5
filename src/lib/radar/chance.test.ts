import { describe, expect, it } from 'vitest'

import { computeChances, forecastMonth, MIN_CLOSED, type DealRow, type StageRow } from './chance'

const NOW = new Date('2026-11-20T12:00:00Z')
const STAGES: StageRow[] = [
  { id: 's-novo', pipeline_id: 'p', position: 0 },
  { id: 's-orc', pipeline_id: 'p', position: 1 },
  { id: 's-neg', pipeline_id: 'p', position: 2 },
]

let n = 0
const deal = (patch: Partial<DealRow>): DealRow => ({
  id: `d${++n}`,
  pipeline_id: 'p',
  stage_id: 's-novo',
  status: 'open',
  value: 1000,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-11-19T12:00:00Z',
  closed_at: null,
  temperature: null,
  source: null,
  ...patch,
})

/** History: lost early, won late — the classic funnel. */
function history(): DealRow[] {
  const out: DealRow[] = []
  for (let i = 0; i < 12; i++) out.push(deal({ status: 'lost', stage_id: 's-novo', closed_at: '2026-10-20T12:00:00Z' }))
  for (let i = 0; i < 4; i++) out.push(deal({ status: 'lost', stage_id: 's-orc', closed_at: '2026-10-20T12:00:00Z' }))
  for (let i = 0; i < 8; i++)
    out.push(deal({ status: 'won', stage_id: 's-neg', created_at: '2026-10-01T12:00:00Z', closed_at: '2026-10-11T12:00:00Z' }))
  return out
}

describe('computeChances', () => {
  it('a deal further along the funnel has a better chance', () => {
    const a = deal({ stage_id: 's-novo' })
    const b = deal({ stage_id: 's-neg' })
    const { chances, stageRates } = computeChances({ stages: STAGES, deals: [...history(), a, b], now: NOW })
    const pa = chances.find((c) => c.id === a.id)!.p
    const pb = chances.find((c) => c.id === b.id)!.p
    expect(pb).toBeGreaterThan(pa)
    expect(chances.every((c) => c.basis === 'historico')).toBe(true)
    // 8 won of the 24 that reached the first stage; all 8 of 8 at the last, pulled toward the base.
    const rate = (id: string) => stageRates.find((r) => r.stage_id === id)!.rate
    expect(rate('s-novo')).toBeCloseTo((8 + 0.34 * 5) / (24 + 5), 1)
    expect(rate('s-neg')).toBeGreaterThan(0.6)
    // Wins take about 10 days here: that is the normal pace.
    expect(stageRates[0].typical_days).toBe(10)
  })

  it('a deal stopped far longer than the normal pace loses chance', () => {
    const fresh = deal({ stage_id: 's-neg', updated_at: '2026-11-19T12:00:00Z' })
    const stale = deal({ stage_id: 's-neg', updated_at: '2026-10-01T12:00:00Z' })
    const { chances } = computeChances({ stages: STAGES, deals: [...history(), fresh, stale], now: NOW })
    expect(chances.find((c) => c.id === stale.id)!.p).toBeCloseTo(chances.find((c) => c.id === fresh.id)!.p * 0.5, 2)
  })

  it('with little history the chance is marked weak', () => {
    const few = history().slice(0, MIN_CLOSED - 1)
    const open = deal({})
    const { chances } = computeChances({ stages: STAGES, deals: [...few, open], now: NOW })
    expect(chances.find((c) => c.id === open.id)!.basis).toBe('fraca')
  })

  it('never certain, never zero', () => {
    const allWon = Array.from({ length: 30 }, () => deal({ status: 'won', stage_id: 's-neg', closed_at: '2026-10-05T12:00:00Z' }))
    const open = deal({ stage_id: 's-neg', temperature: 'hot' })
    const { chances } = computeChances({ stages: STAGES, deals: [...allWon, open], now: NOW })
    expect(chances.find((c) => c.id === open.id)!.p).toBeLessThanOrEqual(0.95)
  })
})

describe('forecastMonth', () => {
  it('expected value with a band; deals without a date counted apart', () => {
    const f = forecastMonth(
      [
        { value: 10000, p: 0.5, expected_close_date: '2026-11-28', status: 'open' },
        { value: 2000, p: 0.8, expected_close_date: '2026-11-10', status: 'open' },
        { value: 5000, p: 0.9, expected_close_date: '2026-12-02', status: 'open' },
        { value: 3000, p: 0.5, expected_close_date: null, status: 'open' },
        { value: 9000, p: 0.9, expected_close_date: '2026-11-15', status: 'won' },
      ],
      '2026-11',
    )
    expect(f.expected).toBe(6600)
    expect(f.deals).toBe(2)
    expect(f.withoutDate).toBe(1)
    expect(f.low).toBeLessThan(f.expected)
    expect(f.high).toBeGreaterThan(f.expected)
    expect(f.low).toBeGreaterThanOrEqual(0)
  })
})

describe('forecastMonth — backtest of the band', () => {
  it('the real revenue falls inside the band in most months', () => {
    // A seeded generator, so the test is the same on every run.
    let seed = 42
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    let inside = 0
    const months = 200
    for (let m = 0; m < months; m++) {
      const deals = Array.from({ length: 25 }, () => ({
        value: 500 + Math.round(rand() * 4500),
        p: Math.round((0.1 + rand() * 0.8) * 100) / 100,
        expected_close_date: '2026-11-15',
        status: 'open',
      }))
      const f = forecastMonth(deals, '2026-11')
      const real = deals.reduce((s, d) => s + (rand() < d.p ? d.value : 0), 0)
      if (real >= f.low && real <= f.high) inside++
    }
    // The band is ~80%: allow sampling noise, never a broken formula.
    expect(inside / months).toBeGreaterThan(0.7)
    expect(inside / months).toBeLessThan(0.92)
  })
})

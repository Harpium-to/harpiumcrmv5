import { describe, expect, it } from 'vitest'

import {
  bucketForecast,
  buildFirstResponse,
  buildGoals,
  buildOutcome,
  closedByDay,
  countByDay,
  groupBy,
  median,
  num,
  OTHER,
  twoSeriesByDay,
  UNASSIGNED,
} from './aggregate'
import { resolvePeriod } from './range'
import type { ClosedDeal } from './aggregate'

const SP = 'America/Sao_Paulo'
const NOW = new Date('2026-05-18T21:00:00Z') // 18:00 in São Paulo

function deal(over: Partial<ClosedDeal> = {}): ClosedDeal {
  return {
    status: 'won',
    value: 1000,
    closed_at: '2026-05-18T14:00:00Z',
    assigned_to: null,
    ...over,
  }
}

describe('num', () => {
  it('coerces the strings PostgREST sends for numeric', () => {
    // The bug this exists to prevent: '1200.00' + '800.00' is
    // '1200.00800.00'.
    expect(num('1200.00') + num('800.00')).toBe(2000)
  })

  it('treats missing and unparseable as zero', () => {
    expect(num(null)).toBe(0)
    expect(num(undefined)).toBe(0)
    expect(num('abc')).toBe(0)
    expect(num(Number.NaN)).toBe(0)
  })
})

describe('median', () => {
  it('takes the middle of an odd list', () => {
    expect(median([5, 1, 3])).toBe(3)
  })

  it('averages the two middles of an even list', () => {
    expect(median([1, 2, 3, 10])).toBe(2.5)
  })

  it('is null with no samples', () => {
    expect(median([])).toBeNull()
  })

  it('is not dragged by one outlier the way a mean is', () => {
    // One approval left over a weekend must not make the team look
    // like it answers nothing for two days.
    const values = [2, 3, 4, 5, 4000]
    expect(median(values)).toBe(4)
  })
})

describe('buildOutcome', () => {
  it('sums value as money, not as strings', () => {
    const out = buildOutcome(
      [deal({ value: '1200.00' }), deal({ value: '800.50' })],
      [],
      false,
    )
    expect(out.wonValue.current).toBe(2000.5)
    expect(out.averageTicket).toBe(1000.25)
  })

  it('counts won and lost separately', () => {
    const out = buildOutcome(
      [deal(), deal(), deal({ status: 'lost', value: 9999 })],
      [],
      false,
    )
    expect(out.wonCount.current).toBe(2)
    expect(out.lostCount.current).toBe(1)
    // A lost deal's value is not revenue.
    expect(out.wonValue.current).toBe(2000)
  })

  it('reports an empty month as no win rate, not a 0% one', () => {
    const out = buildOutcome([], [], false)
    expect(out.winRate).toBeNull()
    expect(out.averageTicket).toBeNull()
  })

  it('reports an all-lost month as an actual 0%', () => {
    const out = buildOutcome([deal({ status: 'lost' })], [], false)
    expect(out.winRate).toBe(0)
  })

  it('carries the previous window for the delta', () => {
    const out = buildOutcome([deal()], [deal(), deal()], false)
    expect(out.wonCount).toEqual({ current: 1, previous: 2 })
  })

  it('passes the approximate flag through', () => {
    expect(buildOutcome([], [], true).approximate).toBe(true)
  })
})

describe('closedByDay', () => {
  const range = resolvePeriod('last7', NOW, SP)

  it('seeds every day so a quiet day is a zero, not a gap', () => {
    const series = closedByDay([], range)
    expect(series).toHaveLength(7)
    expect(series.every((p) => p.a === 0 && p.b === 0)).toBe(true)
  })

  it('buckets by local day, not UTC day', () => {
    // 01:00Z on the 19th is still the 18th in São Paulo.
    const series = closedByDay(
      [deal({ closed_at: '2026-05-19T01:00:00Z' })],
      range,
    )
    expect(series.find((p) => p.day === '2026-05-18')?.a).toBe(1)
    // The 17th is in the window, so it exists and is empty — not
    // missing, which is what the pre-seeding is for.
    expect(series.find((p) => p.day === '2026-05-17')?.a).toBe(0)
  })

  it('drops a row outside the window instead of clamping it', () => {
    // Clamping would pile a year of history onto the first bar.
    const series = closedByDay(
      [deal({ closed_at: '2020-01-01T12:00:00Z' })],
      range,
    )
    expect(series.reduce((sum, p) => sum + p.a, 0)).toBe(0)
  })

  it('ignores a row with no stamp', () => {
    const series = closedByDay([deal({ closed_at: null })], range)
    expect(series.reduce((sum, p) => sum + p.a, 0)).toBe(0)
  })
})

describe('twoSeriesByDay', () => {
  it('splits on the predicate', () => {
    const range = resolvePeriod('today', NOW, SP)
    const rows = [
      { at: '2026-05-18T12:00:00Z', who: 'customer' },
      { at: '2026-05-18T13:00:00Z', who: 'agent' },
      { at: '2026-05-18T14:00:00Z', who: 'bot' },
    ]
    const series = twoSeriesByDay(
      rows,
      range,
      (r) => r.at,
      (r) => r.who === 'customer',
    )
    expect(series).toEqual([{ day: '2026-05-18', a: 1, b: 2 }])
  })
})

describe('countByDay', () => {
  it('counts per local day across the window', () => {
    const range = resolvePeriod('custom', NOW, SP, {
      from: '2026-05-17',
      to: '2026-05-18',
    })
    const series = countByDay(
      [
        '2026-05-17T15:00:00Z',
        '2026-05-18T15:00:00Z',
        '2026-05-18T16:00:00Z',
      ],
      range,
    )
    expect(series).toEqual([
      { day: '2026-05-17', value: 1 },
      { day: '2026-05-18', value: 2 },
    ])
  })
})

describe('groupBy', () => {
  const rows = [
    { source: 'meta', value: 10 },
    { source: 'meta', value: 20 },
    { source: 'indicacao', value: 5 },
    { source: null, value: 1 },
    { source: '   ', value: 2 },
  ]

  it('groups and orders by count', () => {
    const out = groupBy(rows, (r) => r.source)
    expect(out[0]).toMatchObject({ key: 'meta', count: 2 })
  })

  it('keeps the unknown bucket behind a real one on a tie', () => {
    // Both 'meta' and the unknown bucket have 2 here.
    expect(groupBy(rows, (r) => r.source)[0]!.key).toBe('meta')
  })

  it('collapses null and blank into one unknown bucket', () => {
    // Dropping them would make the rows stop adding up to the total,
    // and "we don't know the source of these" is itself the finding.
    const out = groupBy(rows, (r) => r.source)
    const unknown = out.find((r) => r.key === UNASSIGNED)
    expect(unknown?.count).toBe(2)
    expect(out.reduce((sum, r) => sum + r.count, 0)).toBe(rows.length)
  })

  it('sums a measure when given one, and is null when not', () => {
    const withMeasure = groupBy(rows, (r) => r.source, (r) => r.value)
    expect(withMeasure.find((r) => r.key === 'meta')?.value).toBe(30)
    expect(groupBy(rows, (r) => r.source)[0]!.value).toBeNull()
  })

  it('folds the long tail instead of cutting it, keeping the total', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      source: `origem-${i}`,
      value: 1,
    }))
    const out = groupBy(many, (r) => r.source, (r) => r.value, 5)
    expect(out).toHaveLength(5)
    expect(out[4]!.key).toBe(OTHER)
    expect(out.reduce((sum, r) => sum + r.count, 0)).toBe(30)
    expect(out.reduce((sum, r) => sum + (r.value ?? 0), 0)).toBe(30)
  })

  it('is stable when counts tie', () => {
    const tied = [{ k: 'b' }, { k: 'a' }]
    expect(groupBy(tied, (r) => r.k).map((r) => r.key)).toEqual(['a', 'b'])
  })
})

describe('bucketForecast', () => {
  const rows = [
    { expected_close_date: '2026-04-30', value: 100 }, // passou
    { expected_close_date: '2026-05-18', value: 200 }, // hoje
    { expected_close_date: '2026-05-31', value: 300 }, // este mês
    { expected_close_date: '2026-06-10', value: 400 }, // mês que vem
    { expected_close_date: '2026-12-01', value: 500 }, // depois
    { expected_close_date: null, value: 600 }, // sem data
  ]

  it('puts the overdue bucket first', () => {
    expect(bucketForecast(rows, '2026-05-18')[0]!.bucket).toBe('overdue')
  })

  it('files each deal in exactly one bucket', () => {
    const out = bucketForecast(rows, '2026-05-18')
    const by = Object.fromEntries(out.map((b) => [b.bucket, b]))
    expect(by.overdue).toMatchObject({ count: 1, value: 100 })
    expect(by.this_month).toMatchObject({ count: 2, value: 500 })
    expect(by.next_month).toMatchObject({ count: 1, value: 400 })
    expect(by.later).toMatchObject({ count: 1, value: 500 })
    expect(by.undated).toMatchObject({ count: 1, value: 600 })
    expect(out.reduce((sum, b) => sum + b.count, 0)).toBe(rows.length)
  })

  it('counts today as this month, not overdue', () => {
    const out = bucketForecast(
      [{ expected_close_date: '2026-05-18', value: 1 }],
      '2026-05-18',
    )
    expect(out.find((b) => b.bucket === 'overdue')!.count).toBe(0)
    expect(out.find((b) => b.bucket === 'this_month')!.count).toBe(1)
  })

  it('rolls the year over for next month in December', () => {
    const out = bucketForecast(
      [{ expected_close_date: '2027-01-15', value: 1 }],
      '2026-12-10',
    )
    expect(out.find((b) => b.bucket === 'next_month')!.count).toBe(1)
    expect(out.find((b) => b.bucket === 'later')!.count).toBe(0)
  })

  it('always returns every bucket, even empty', () => {
    const out = bucketForecast([], '2026-05-18')
    expect(out).toHaveLength(5)
    expect(out.every((b) => b.count === 0)).toBe(true)
  })
})

describe('buildGoals', () => {
  const agent = (id: string, goals: Record<string, number>) => ({
    id,
    name: id,
    goals,
  })

  it('scales a monthly target down to a weekly window', () => {
    // Read raw, a 10-a-month target over 7 days looks like a 90% miss
    // every week of the year.
    const [row] = buildGoals({
      agents: [agent('a', { closes_per_month: 30 })],
      runs: [],
      tasks: [],
      contactOwnerIds: [],
      windowDays: 7,
    })
    expect(row!.target).toBe(7)
  })

  it('scales a daily target up to a month', () => {
    const [row] = buildGoals({
      agents: [agent('a', { leads_per_day: 20 })],
      runs: [],
      tasks: [],
      contactOwnerIds: [],
      windowDays: 30,
    })
    expect(row!.target).toBe(600)
  })

  it('counts replied runs for a conversations target', () => {
    const [row] = buildGoals({
      agents: [agent('a', { conversations_per_day: 10 })],
      runs: [
        { agent_id: 'a', status: 'replied' },
        { agent_id: 'a', status: 'replied' },
        { agent_id: 'a', status: 'skipped' },
        { agent_id: 'b', status: 'replied' },
      ],
      tasks: [],
      contactOwnerIds: [],
      windowDays: 1,
    })
    expect(row!.actual).toBe(2)
    expect(row!.ratio).toBeCloseTo(0.2)
    expect(row!.measured).toBe(true)
  })

  it('counts only completed tasks of the right kind', () => {
    const [row] = buildGoals({
      agents: [agent('a', { briefings_per_day: 4 })],
      runs: [],
      tasks: [
        { agent_id: 'a', kind: 'research', status: 'done' },
        { agent_id: 'a', kind: 'research', status: 'failed' },
        { agent_id: 'a', kind: 'outreach', status: 'done' },
      ],
      contactOwnerIds: [],
      windowDays: 1,
    })
    expect(row!.actual).toBe(1)
  })

  it('counts contacts the agent owns for a leads target', () => {
    const [row] = buildGoals({
      agents: [agent('a', { leads_per_day: 2 })],
      runs: [],
      tasks: [],
      contactOwnerIds: ['a', 'a', 'b', null],
      windowDays: 1,
    })
    expect(row!.actual).toBe(2)
    expect(row!.ratio).toBe(1)
  })

  it('reports an unmeasurable target as unmeasured, never as 0%', () => {
    // There is no meetings table. 0% would read as an agent failing
    // completely, and somebody would switch off an agent that works.
    const [row] = buildGoals({
      agents: [agent('a', { meetings_per_week: 5 })],
      runs: [],
      tasks: [],
      contactOwnerIds: [],
      windowDays: 7,
    })
    expect(row!.measured).toBe(false)
    expect(row!.actual).toBeNull()
    expect(row!.ratio).toBeNull()
  })

  it('still measures nothing for a factory-invented metric', () => {
    const [row] = buildGoals({
      agents: [agent('a', { demos_por_quinzena: 4 })],
      runs: [],
      tasks: [],
      contactOwnerIds: [],
      windowDays: 7,
    })
    expect(row!.measured).toBe(false)
    expect(row!.metricLabelKey).toBeNull()
  })

  it('skips a zero or negative target', () => {
    expect(
      buildGoals({
        agents: [agent('a', { leads_per_day: 0, closes_per_month: -3 })],
        runs: [],
        tasks: [],
        contactOwnerIds: [],
        windowDays: 7,
      }),
    ).toEqual([])
  })

  it('puts the worst measured attainment first and the unmeasured last', () => {
    const rows = buildGoals({
      agents: [
        agent('a', { conversations_per_day: 10, meetings_per_week: 5 }),
        agent('b', { conversations_per_day: 1 }),
      ],
      runs: [{ agent_id: 'b', status: 'replied' }],
      tasks: [],
      contactOwnerIds: [],
      windowDays: 1,
    })
    expect(rows.map((r) => [r.agentId, r.measured])).toEqual([
      ['a', true], // 0 of 10
      ['b', true], // 1 of 1
      ['a', false], // sem fonte
    ])
  })
})

describe('buildFirstResponse', () => {
  const range = resolvePeriod('last7', NOW, SP)

  it('converts seconds to minutes and fills every day of the window', () => {
    const out = buildFirstResponse(
      {
        replied: 3,
        unreplied: 1,
        median_seconds: 210,
        p90_seconds: 2280,
        by_responder: [{ responder: 'bot', replied: 1, median_seconds: 12 }],
        by_day: [{ day: range.dayKeys[2], replied: 3, median_seconds: 210 }],
      },
      range,
    )
    expect(out.medianMinutes).toBe(3.5)
    expect(out.p90Minutes).toBe(38)
    expect(out.byResponder[0].medianMinutes).toBe(0.2)
    expect(out.byDay.map((d) => d.day)).toEqual(range.dayKeys)
    expect(out.byDay[2]).toEqual({ day: range.dayKeys[2], replied: 3, medianMinutes: 3.5 })
  })

  it('leaves a day with no answered wait as null, not zero minutes', () => {
    const out = buildFirstResponse(
      {
        replied: 0,
        unreplied: 2,
        median_seconds: null,
        p90_seconds: null,
        by_responder: [],
        by_day: [],
      },
      range,
    )
    expect(out.medianMinutes).toBeNull()
    expect(out.unreplied).toBe(2)
    expect(out.byDay.every((d) => d.medianMinutes === null && d.replied === 0)).toBe(true)
  })
})

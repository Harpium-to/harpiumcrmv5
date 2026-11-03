import { describe, expect, it } from 'vitest'

import {
  parseDayKey,
  previousRange,
  resolvePeriod,
  safeTimezone,
  startOfZonedDay,
  zonedDayKey,
} from './range'

const SP = 'America/Sao_Paulo'
const NY = 'America/New_York'

describe('startOfZonedDay', () => {
  it('resolves midnight in a fixed-offset zone', () => {
    // São Paulo dropped DST in 2019: UTC-3 all year.
    expect(startOfZonedDay('2026-05-18', SP).toISOString()).toBe(
      '2026-05-18T03:00:00.000Z',
    )
    expect(startOfZonedDay('2026-01-01', SP).toISOString()).toBe(
      '2026-01-01T03:00:00.000Z',
    )
  })

  it('resolves midnight on both sides of a DST shift', () => {
    // US DST 2026: forward 8 Mar, back 1 Nov.
    expect(startOfZonedDay('2026-03-07', NY).toISOString()).toBe(
      '2026-03-07T05:00:00.000Z',
    )
    expect(startOfZonedDay('2026-03-09', NY).toISOString()).toBe(
      '2026-03-09T04:00:00.000Z',
    )
    expect(startOfZonedDay('2026-11-02', NY).toISOString()).toBe(
      '2026-11-02T05:00:00.000Z',
    )
  })

  it('resolves midnight on the shift day itself', () => {
    // The hour 02:00–03:00 does not exist on 8 Mar, but midnight does
    // and it is still at -05:00. This is the case the single-pass
    // offset guess gets wrong.
    expect(startOfZonedDay('2026-03-08', NY).toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    )
    expect(startOfZonedDay('2026-11-01', NY).toISOString()).toBe(
      '2026-11-01T04:00:00.000Z',
    )
  })

  it('handles a zone with a half-hour offset', () => {
    expect(startOfZonedDay('2026-05-18', 'Asia/Kolkata').toISOString()).toBe(
      '2026-05-17T18:30:00.000Z',
    )
  })
})

describe('zonedDayKey', () => {
  it('reads the local day, not the UTC day', () => {
    // 01:30 UTC on the 19th is still the 18th in São Paulo. This is
    // the whole reason this module exists.
    expect(zonedDayKey(new Date('2026-05-19T01:30:00Z'), SP)).toBe('2026-05-18')
    expect(zonedDayKey(new Date('2026-05-19T03:30:00Z'), SP)).toBe('2026-05-19')
  })
})

describe('resolvePeriod', () => {
  // 18:00 in São Paulo on Monday 18 May 2026.
  const now = new Date('2026-05-18T21:00:00Z')

  it('ends today at tomorrow midnight so the number is stable all day', () => {
    const r = resolvePeriod('today', now, SP)
    expect(r.fromIso).toBe('2026-05-18T03:00:00.000Z')
    expect(r.toIso).toBe('2026-05-19T03:00:00.000Z')
    expect(r.dayKeys).toEqual(['2026-05-18'])
  })

  it('counts "last 7 days" as 7 buckets including today', () => {
    const r = resolvePeriod('last7', now, SP)
    expect(r.dayKeys).toHaveLength(7)
    expect(r.dayKeys[0]).toBe('2026-05-12')
    expect(r.dayKeys[6]).toBe('2026-05-18')
  })

  it('starts this month on the 1st', () => {
    const r = resolvePeriod('this_month', now, SP)
    expect(r.fromIso).toBe('2026-05-01T03:00:00.000Z')
    expect(r.dayKeys).toHaveLength(18)
  })

  it('covers last month exactly, whatever its length', () => {
    const r = resolvePeriod('last_month', now, SP)
    expect(r.fromIso).toBe('2026-04-01T03:00:00.000Z')
    expect(r.toIso).toBe('2026-05-01T03:00:00.000Z')
    expect(r.dayKeys).toHaveLength(30)
  })

  it('handles last month from a 31st, where naive month maths breaks', () => {
    // 31 March: "one month before" is not 31 February.
    const r = resolvePeriod(
      'last_month',
      new Date('2026-03-31T15:00:00Z'),
      SP,
    )
    expect(r.fromIso).toBe('2026-02-01T03:00:00.000Z')
    expect(r.toIso).toBe('2026-03-01T03:00:00.000Z')
    expect(r.dayKeys).toHaveLength(28)
  })

  it('includes the last day of a custom range', () => {
    const r = resolvePeriod('custom', now, SP, {
      from: '2026-05-01',
      to: '2026-05-03',
    })
    expect(r.dayKeys).toEqual(['2026-05-01', '2026-05-02', '2026-05-03'])
    expect(r.toIso).toBe('2026-05-04T03:00:00.000Z')
  })

  it('orders a reversed custom range instead of returning nothing', () => {
    const r = resolvePeriod('custom', now, SP, {
      from: '2026-05-03',
      to: '2026-05-01',
    })
    expect(r.dayKeys).toEqual(['2026-05-01', '2026-05-02', '2026-05-03'])
  })

  it('falls back to 30 days when a custom range is unusable', () => {
    // These arrive from a URL; a hand-edited one still has to render.
    for (const opts of [
      {},
      { from: '2026-05-01' },
      { from: 'ontem', to: 'hoje' },
      { from: '2026-02-31', to: '2026-03-01' },
    ]) {
      expect(resolvePeriod('custom', now, SP, opts).dayKeys).toHaveLength(30)
    }
  })

  it('keeps a DST-shortened day as one bucket', () => {
    const r = resolvePeriod('custom', now, NY, {
      from: '2026-03-07',
      to: '2026-03-09',
    })
    expect(r.dayKeys).toEqual(['2026-03-07', '2026-03-08', '2026-03-09'])
  })

  it('falls back to a usable zone instead of throwing', () => {
    expect(safeTimezone('Mars/Olympus_Mons')).toBe('America/Sao_Paulo')
    expect(safeTimezone(null)).toBe('America/Sao_Paulo')
    expect(safeTimezone(SP)).toBe(SP)
    expect(() => resolvePeriod('today', now, 'Mars/Olympus_Mons')).not.toThrow()
  })
})

describe('previousRange', () => {
  const now = new Date('2026-05-09T21:00:00Z')

  it('compares the same number of days, not the whole previous month', () => {
    // On the 9th, "this month" is 9 days. The comparison window has to
    // be the 9 days before the 1st — otherwise every report shows a
    // collapse on the 2nd of the month.
    const current = resolvePeriod('this_month', now, SP)
    const prev = previousRange(current)
    expect(current.dayKeys).toHaveLength(9)
    expect(prev.dayKeys).toHaveLength(9)
    expect(prev.toIso).toBe(current.fromIso)
    expect(prev.dayKeys[0]).toBe('2026-04-22')
  })

  it('sits immediately before the range for a rolling window', () => {
    const current = resolvePeriod('last7', now, SP)
    const prev = previousRange(current)
    expect(prev.toIso).toBe(current.fromIso)
    expect(prev.dayKeys).toHaveLength(7)
  })
})

describe('parseDayKey', () => {
  it('accepts a real date and rejects a rolled-over one', () => {
    expect(parseDayKey('2026-02-28')).toEqual({ year: 2026, month: 2, day: 28 })
    expect(parseDayKey('2026-02-31')).toBeNull()
    expect(parseDayKey('2026-13-01')).toBeNull()
    expect(parseDayKey('18/05/2026')).toBeNull()
    expect(parseDayKey(null)).toBeNull()
  })

  it('accepts a leap day only in a leap year', () => {
    expect(parseDayKey('2028-02-29')).not.toBeNull()
    expect(parseDayKey('2026-02-29')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'

import { BACKFILL_DAYS, planAccount, type RadarState } from './livro'
import { addDays, daysBetween, isoWeek, localParts, weekdayOf } from './tempo'

const NOW = new Date('2026-11-20T15:00:00Z') // 12:00 in São Paulo

describe('tempo', () => {
  it('cuts the day in the CRM zone', () => {
    expect(localParts(new Date('2026-11-21T02:30:00Z'), 'America/Sao_Paulo')).toMatchObject({ day: '2026-11-20', hour: 23 })
    expect(localParts(NOW, 'America/Sao_Paulo')).toMatchObject({ day: '2026-11-20', hour: 12, weekday: 5 })
  })

  it('date arithmetic', () => {
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31')
    expect(daysBetween('2026-11-01', '2026-11-20')).toBe(19)
    expect(weekdayOf('2026-11-23')).toBe(1) // Monday
    expect(isoWeek('2026-11-23')).toBe('2026-W48')
  })
})

describe('planAccount', () => {
  const base: RadarState = {
    account_id: 'A',
    timezone: 'America/Sao_Paulo',
    tracked_since: '2026-08-28',
    computed_through: '2026-11-19',
    today_refreshed_at: '2026-11-20T14:50:00Z',
  }

  it('first time: twelve weeks of history, then today', () => {
    const p = planAccount({ state: null, createdDay: '2025-01-01', today: '2026-11-20', now: NOW })
    expect(p.ranges).toEqual([
      { from: addDays('2026-11-20', -BACKFILL_DAYS), to: '2026-11-19', kind: 'backfill' },
      { from: '2026-11-20', to: '2026-11-20', kind: 'today' },
    ])
    expect(p.next.computed_through).toBe('2026-11-19')
    expect(p.next.tracked_since).toBe(addDays('2026-11-20', -BACKFILL_DAYS))
  })

  it('a CRM born last week starts on its first day', () => {
    const p = planAccount({ state: null, createdDay: '2026-11-14', today: '2026-11-20', now: NOW })
    expect(p.ranges[0]).toEqual({ from: '2026-11-14', to: '2026-11-19', kind: 'backfill' })
    expect(p.next.tracked_since).toBe('2026-11-14')
  })

  it('a CRM born today has no history to fill', () => {
    const p = planAccount({ state: null, createdDay: '2026-11-20', today: '2026-11-20', now: NOW })
    expect(p.ranges).toEqual([{ from: '2026-11-20', to: '2026-11-20', kind: 'today' }])
  })

  it('catches up the days that ended; refreshes today at most every 30 min', () => {
    const behind = planAccount({ state: { ...base, computed_through: '2026-11-17' }, createdDay: '2025-01-01', today: '2026-11-20', now: NOW })
    expect(behind.ranges).toEqual([{ from: '2026-11-18', to: '2026-11-19', kind: 'close' }])
    const stale = planAccount({ state: { ...base, today_refreshed_at: '2026-11-20T14:00:00Z' }, createdDay: '2025-01-01', today: '2026-11-20', now: NOW })
    expect(stale.ranges).toEqual([{ from: '2026-11-20', to: '2026-11-20', kind: 'today' }])
    expect(stale.next.today_refreshed_at).toBe(NOW.toISOString())
  })
})

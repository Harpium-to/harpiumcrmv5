import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BACKFILL_DAYS,
  CHUNK_DAYS,
  planAccount,
  processarRadar,
  registerDailyStep,
  type RadarState,
} from './livro'
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

  it('first time: twelve weeks of history in pieces, oldest first, then today', () => {
    const p = planAccount({ state: null, createdDay: '2025-01-01', today: '2026-11-20', now: NOW })
    const history = p.ranges.filter((r) => r.kind === 'backfill')
    expect(history).toHaveLength(BACKFILL_DAYS / CHUNK_DAYS)
    expect(history[0].from).toBe(addDays('2026-11-20', -BACKFILL_DAYS))
    expect(history.at(-1)!.to).toBe('2026-11-19')
    history.forEach((r, i) => {
      expect(daysBetween(r.from, r.to)).toBeLessThan(CHUNK_DAYS)
      if (i > 0) expect(r.from).toBe(addDays(history[i - 1].to, 1))
    })
    expect(p.ranges.at(-1)).toEqual({ from: '2026-11-20', to: '2026-11-20', kind: 'today' })
    expect(p.trackedSince).toBe(addDays('2026-11-20', -BACKFILL_DAYS))
    expect(p.computedThrough).toBeNull()
  })

  it('a CRM born last week starts on its first day, in one piece', () => {
    const p = planAccount({ state: null, createdDay: '2026-11-14', today: '2026-11-20', now: NOW })
    expect(p.ranges).toEqual([
      { from: '2026-11-14', to: '2026-11-19', kind: 'backfill' },
      { from: '2026-11-20', to: '2026-11-20', kind: 'today' },
    ])
    expect(p.trackedSince).toBe('2026-11-14')
  })

  it('a CRM born today has no history to fill', () => {
    const p = planAccount({ state: null, createdDay: '2026-11-20', today: '2026-11-20', now: NOW })
    expect(p.ranges).toEqual([{ from: '2026-11-20', to: '2026-11-20', kind: 'today' }])
    expect(p.computedThrough).toBe('2026-11-19')
  })

  it('goes on from the last piece saved, keeping where the history starts', () => {
    const p = planAccount({
      state: { ...base, computed_through: '2026-09-10', today_refreshed_at: null },
      createdDay: '2025-01-01',
      today: '2026-11-20',
      now: NOW,
    })
    expect(p.ranges[0]).toEqual({ from: '2026-09-11', to: '2026-09-24', kind: 'close' })
    expect(p.ranges.filter((r) => r.kind === 'close')).toHaveLength(5) // 70 days
    expect(p.trackedSince).toBe('2026-08-28')
  })

  it('catches up the days that ended; refreshes today at most every 30 min', () => {
    const behind = planAccount({ state: { ...base, computed_through: '2026-11-17' }, createdDay: '2025-01-01', today: '2026-11-20', now: NOW })
    expect(behind.ranges).toEqual([{ from: '2026-11-18', to: '2026-11-19', kind: 'close' }])
    const stale = planAccount({ state: { ...base, today_refreshed_at: '2026-11-20T14:00:00Z' }, createdDay: '2025-01-01', today: '2026-11-20', now: NOW })
    expect(stale.ranges).toEqual([{ from: '2026-11-20', to: '2026-11-20', kind: 'today' }])
  })
})

// ------------------------------------------------------------
// processarRadar against a fake database
// ------------------------------------------------------------

type Row = Record<string, unknown>

function fakeAdmin(opts: {
  states?: Row[]
  /** Runs on every compute; may move the clock. */
  onCompute?: () => void
  /** The compute call (0-based) that fails. */
  failAt?: number
  /** An upsert with any of these columns fails, like a database without 080. */
  missingColumns?: string[]
}) {
  const computed: { from: string; to: string }[] = []
  const saved: Row[] = []
  const admin = {
    from(table: string) {
      if (table === 'radar_state') {
        return {
          select: async () => ({ data: opts.states ?? [], error: null }),
          upsert: async (row: Row) => {
            if (opts.missingColumns?.some((c) => c in row)) {
              return { error: { code: 'PGRST204', message: 'column not in the schema cache' } }
            }
            saved.push(row)
            return { error: null }
          },
        }
      }
      if (table === 'accounts') {
        return {
          select: () => ({
            in: async () => ({ data: [{ id: 'A', created_at: '2025-01-01T12:00:00Z' }], error: null }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
    rpc: async (_fn: string, args: { p_from: string; p_to: string }) => {
      const n = computed.length
      computed.push({ from: args.p_from, to: args.p_to })
      opts.onCompute?.()
      return { error: n === opts.failAt ? { message: 'statement timeout' } : null }
    },
  }
  return { admin: admin as unknown as SupabaseClient, computed, saved }
}

describe('processarRadar', () => {
  const dailyRuns: string[] = []
  let dailyThrows = false
  registerDailyStep(async (ctx) => {
    dailyRuns.push(ctx.accountId)
    if (dailyThrows) throw new Error('boom')
    return { detected_through: ctx.yesterday }
  })

  beforeEach(() => {
    dailyRuns.length = 0
    dailyThrows = false
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fills the history piece by piece while time allows, and waits for all of it before the daily work', async () => {
    let clock = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)

    // Each piece takes 3 s and the tick has 8 s: three pieces, then stop.
    const first = fakeAdmin({ onCompute: () => (clock += 3000) })
    const s1 = await processarRadar(first.admin, { deadline: clock + 8000, now: NOW })
    expect(first.computed).toHaveLength(3)
    expect(s1).toMatchObject({ backfilled: 3, refreshed: 0, daily: 0 })
    expect(dailyRuns).toEqual([])
    const saved1 = first.saved.at(-1)!
    expect(saved1).toMatchObject({
      tracked_since: addDays('2026-11-20', -BACKFILL_DAYS),
      computed_through: first.computed[2].to,
      today_refreshed_at: null,
    })

    // The next tick goes on from there and, with the history complete,
    // refreshes today and does the daily work.
    const second = fakeAdmin({ states: [saved1], onCompute: () => (clock += 1000) })
    const s2 = await processarRadar(second.admin, { deadline: clock + 60_000, now: NOW })
    expect(second.computed[0].from).toBe(addDays(String(saved1.computed_through), 1))
    expect(s2).toMatchObject({ refreshed: 1, daily: 1 })
    expect(dailyRuns).toEqual(['A'])
    expect(second.saved.at(-1)).toMatchObject({
      tracked_since: saved1.tracked_since,
      computed_through: '2026-11-19',
      today_refreshed_at: NOW.toISOString(),
      detected_through: '2026-11-19',
    })
  })

  it('a piece that fails keeps what was done before it and skips the daily work', async () => {
    const { admin, computed, saved } = fakeAdmin({ failAt: 1 })
    const s = await processarRadar(admin, { deadline: Date.now() + 60_000, now: NOW })
    expect(computed).toHaveLength(2)
    expect(s.daily).toBe(0)
    expect(saved.at(-1)).toMatchObject({ computed_through: computed[0].to, today_refreshed_at: null })
  })

  it('a daily step that fails keeps the progress', async () => {
    dailyThrows = true
    const state: Row = {
      account_id: 'A',
      timezone: 'America/Sao_Paulo',
      tracked_since: '2026-08-28',
      computed_through: '2026-11-18',
      today_refreshed_at: null,
    }
    const { admin, saved } = fakeAdmin({ states: [state] })
    const s = await processarRadar(admin, { deadline: Date.now() + 60_000, now: NOW })
    expect(s.daily).toBe(1)
    expect(saved.at(-1)).toMatchObject({ computed_through: '2026-11-19', today_refreshed_at: NOW.toISOString() })
  })

  it('a database with 079 but not 080 still saves the history progress', async () => {
    const { admin, saved } = fakeAdmin({ missingColumns: ['detected_through'] })
    await processarRadar(admin, { deadline: Date.now() + 60_000, now: NOW })
    expect(saved).toHaveLength(1)
    expect(saved[0]).not.toHaveProperty('detected_through')
    expect(saved[0]).toMatchObject({ computed_through: '2026-11-19', today_refreshed_at: NOW.toISOString() })
  })
})

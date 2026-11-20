import type { SupabaseClient } from '@supabase/supabase-js'

import { addDays, DEFAULT_TZ, localParts } from './tempo'

// ============================================================
// The Radar's scheduler, called from /api/automations/cron (no cron
// of its own). Per CRM, in its time zone:
//
//   first time   fill the ledger with up to 12 weeks of history;
//   every tick   close the days that ended (up to yesterday) and,
//                at most every 30 minutes, refresh today;
//   once a day   (after 03:00 local) the daily work in `daily` below:
//                anomalies, win chances, the weekly digest (080+).
//
// Bounded by `deadline`: what does not fit waits for the next tick,
// oldest CRM first. Never throws — the cron must not stop because of it.
// See docs/plano-radar-monitoramento.md §5.
// ============================================================

export const BACKFILL_DAYS = 84
export const TODAY_EVERY_MS = 30 * 60_000
/** Local hour after which yesterday is closed for good and analysed. */
export const DAILY_HOUR = 3

export interface RadarState {
  account_id: string
  timezone: string
  tracked_since: string | null
  computed_through: string | null
  today_refreshed_at: string | null
  detected_through?: string | null
  chances_at?: string | null
  digest_week?: string | null
}

export interface RadarTickSummary {
  accounts: number
  backfilled: number
  closedDays: number
  refreshed: number
  daily: number
}

/** What the daily step of one CRM gets: its state, its local clock. */
export interface DailyContext {
  admin: SupabaseClient
  accountId: string
  tz: string
  today: string
  yesterday: string
  hour: number
  weekday: number
  now: Date
  state: RadarState
}

/**
 * The daily work of later phases (anomalies, chances, digest), set up
 * by the module that owns it. Returns the state fields it changed.
 */
type DailyStep = (ctx: DailyContext) => Promise<Partial<RadarState>>
const dailySteps: DailyStep[] = []
export function registerDailyStep(step: DailyStep): void {
  if (!dailySteps.includes(step)) dailySteps.push(step)
}

/**
 * The plan for one CRM this tick, pure: which ranges to compute and how
 * the state moves. Exported for the tests.
 */
export function planAccount(args: {
  state: RadarState | null
  createdDay: string
  today: string
  now: Date
}): {
  ranges: { from: string; to: string; kind: 'backfill' | 'close' | 'today' }[]
  next: Pick<RadarState, 'tracked_since' | 'computed_through' | 'today_refreshed_at'>
} {
  const { state, createdDay, today, now } = args
  const yesterday = addDays(today, -1)
  const ranges: { from: string; to: string; kind: 'backfill' | 'close' | 'today' }[] = []
  let tracked = state?.tracked_since ?? null
  let through = state?.computed_through ?? null

  if (!through) {
    const earliest = addDays(today, -BACKFILL_DAYS)
    const from = createdDay > earliest ? createdDay : earliest
    tracked = from
    if (from <= yesterday) ranges.push({ from, to: yesterday, kind: 'backfill' })
    through = yesterday
  } else if (through < yesterday) {
    ranges.push({ from: addDays(through, 1), to: yesterday, kind: 'close' })
    through = yesterday
  }

  const last = state?.today_refreshed_at ? Date.parse(state.today_refreshed_at) : 0
  let refreshedAt = state?.today_refreshed_at ?? null
  if (now.getTime() - last >= TODAY_EVERY_MS) {
    ranges.push({ from: today, to: today, kind: 'today' })
    refreshedAt = now.toISOString()
  }

  return { ranges, next: { tracked_since: tracked, computed_through: through, today_refreshed_at: refreshedAt } }
}

export async function processarRadar(
  admin: SupabaseClient,
  opts: { deadline: number; now?: Date },
): Promise<RadarTickSummary> {
  const summary: RadarTickSummary = { accounts: 0, backfilled: 0, closedDays: 0, refreshed: 0, daily: 0 }
  const now = opts.now ?? new Date()

  // Before 079 there is no ledger: nothing to do.
  const { data: stateRows, error: stateErr } = await admin.from('radar_state').select('*')
  if (stateErr) return summary
  const states = new Map(((stateRows ?? []) as RadarState[]).map((s) => [s.account_id, s]))

  const accounts = await liveAccounts(admin)
  // Oldest refresh first, so a long backfill never starves anyone.
  accounts.sort((a, b) => refreshedAt(states.get(a.id)) - refreshedAt(states.get(b.id)))

  for (const account of accounts) {
    if (Date.now() > opts.deadline) break
    const state = states.get(account.id) ?? null
    const tz = state?.timezone || DEFAULT_TZ
    try {
      const clock = localParts(now, tz)
      const plan = planAccount({
        state,
        createdDay: localParts(new Date(account.created_at), tz).day,
        today: clock.day,
        now,
      })
      for (const r of plan.ranges) {
        const { error } = await admin.rpc('radar_compute_days', {
          p_account: account.id,
          p_from: r.from,
          p_to: r.to,
          p_tz: tz,
        })
        if (error) throw new Error(error.message)
        if (r.kind === 'backfill') summary.backfilled += 1
        if (r.kind === 'close') summary.closedDays += 1
        if (r.kind === 'today') summary.refreshed += 1
      }

      let next: RadarState = { ...(state ?? emptyState(account.id, tz)), ...plan.next }

      // The daily work, once the day before is final.
      if (clock.hour >= DAILY_HOUR && dailySteps.length > 0) {
        const ctx: DailyContext = {
          admin,
          accountId: account.id,
          tz,
          today: clock.day,
          yesterday: addDays(clock.day, -1),
          hour: clock.hour,
          weekday: clock.weekday,
          now,
          state: next,
        }
        for (const step of dailySteps) {
          if (Date.now() > opts.deadline) break
          next = { ...next, ...(await step({ ...ctx, state: next })) }
        }
        summary.daily += 1
      }

      await admin.from('radar_state').upsert(
        {
          account_id: account.id,
          timezone: tz,
          tracked_since: next.tracked_since,
          computed_through: next.computed_through,
          today_refreshed_at: next.today_refreshed_at,
          ...('detected_through' in next ? { detected_through: next.detected_through } : {}),
          ...('chances_at' in next ? { chances_at: next.chances_at } : {}),
          ...('digest_week' in next ? { digest_week: next.digest_week } : {}),
        },
        { onConflict: 'account_id' },
      )
      summary.accounts += 1
    } catch (err) {
      console.error('[radar] account failed:', account.id, err)
    }
  }
  return summary
}

function emptyState(accountId: string, tz: string): RadarState {
  return { account_id: accountId, timezone: tz, tracked_since: null, computed_through: null, today_refreshed_at: null }
}

function refreshedAt(s: RadarState | undefined): number {
  return s?.today_refreshed_at ? Date.parse(s.today_refreshed_at) : 0
}

/** CRMs in use: active or being set up (050); every CRM before it. */
async function liveAccounts(admin: SupabaseClient): Promise<{ id: string; created_at: string }[]> {
  const withStatus = await admin
    .from('accounts')
    .select('id, created_at, status')
    .in('status', ['active', 'onboarding'])
  if (!withStatus.error) return (withStatus.data ?? []) as { id: string; created_at: string }[]
  const all = await admin.from('accounts').select('id, created_at')
  return (all.data ?? []) as { id: string; created_at: string }[]
}

import type { SupabaseClient } from '@supabase/supabase-js'

import { addDays, DEFAULT_TZ, localParts } from './tempo'

// ============================================================
// The Radar's scheduler, called from /api/automations/cron (no cron
// of its own). Per CRM, in its time zone:
//
//   first time   fill the ledger with up to 12 weeks of history, two
//                weeks per call, oldest first;
//   every tick   close the days that ended (up to yesterday, two weeks
//                per call as well) and, at most every 30 minutes,
//                refresh today — once the history is in place;
//   once a day   after 03:00 local and only with the history complete,
//                the daily work in `dailySteps` below: anomalies, win
//                chances, the weekly digest (080+).
//
// Bounded by `deadline`, checked before every call: what does not fit
// waits for the next tick, which goes on from the last piece saved,
// oldest CRM first. Never throws — the cron must not stop because of
// it. See docs/plano-radar-monitoramento.md §5.
// ============================================================

export const BACKFILL_DAYS = 84
/**
 * Days computed per call. Twelve weeks of a big CRM in one call could
 * outlast the scheduler's time, fail, and be tried again forever; in
 * pieces, each one saves its progress.
 */
export const CHUNK_DAYS = 14
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

export interface RadarRange {
  from: string
  to: string
  kind: 'backfill' | 'close' | 'today'
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
 * The plan for one CRM this tick, pure. `ranges` are the pieces of
 * history still missing, oldest first and at most CHUNK_DAYS each, then
 * today when it is due. The caller runs them in order while time allows
 * and moves `computed_through` piece by piece, so today is refreshed
 * only once the history is in place. Exported for the tests.
 */
export function planAccount(args: {
  state: RadarState | null
  createdDay: string
  today: string
  now: Date
}): {
  ranges: RadarRange[]
  /** First day of the history. */
  trackedSince: string
  /** Last day in the ledger before this tick's work (null: none yet). */
  computedThrough: string | null
} {
  const { state, createdDay, today, now } = args
  const yesterday = addDays(today, -1)
  const ranges: RadarRange[] = []
  let trackedSince: string
  let computedThrough = state?.computed_through ?? null

  if (!computedThrough) {
    const earliest = addDays(today, -BACKFILL_DAYS)
    trackedSince = createdDay > earliest ? createdDay : earliest
    if (trackedSince <= yesterday) ranges.push(...pieces(trackedSince, yesterday, 'backfill'))
    // A CRM born today has no history to fill: it is complete already.
    else computedThrough = yesterday
  } else {
    trackedSince = state?.tracked_since ?? computedThrough
    if (computedThrough < yesterday) ranges.push(...pieces(addDays(computedThrough, 1), yesterday, 'close'))
  }

  const last = state?.today_refreshed_at ? Date.parse(state.today_refreshed_at) : 0
  if (now.getTime() - last >= TODAY_EVERY_MS) ranges.push({ from: today, to: today, kind: 'today' })

  return { ranges, trackedSince, computedThrough }
}

function pieces(from: string, to: string, kind: 'backfill' | 'close'): RadarRange[] {
  const out: RadarRange[] = []
  for (let start = from; start <= to; start = addDays(start, CHUNK_DAYS)) {
    const end = addDays(start, CHUNK_DAYS - 1)
    out.push({ from: start, to: end < to ? end : to, kind })
  }
  return out
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
  // Oldest refresh first: a CRM still filling its history keeps the
  // lead until it is done, then goes to the back of the line.
  accounts.sort((a, b) => refreshedAt(states.get(a.id)) - refreshedAt(states.get(b.id)))

  for (const account of accounts) {
    if (Date.now() > opts.deadline) break
    const state = states.get(account.id) ?? null
    const tz = state?.timezone || DEFAULT_TZ
    try {
      const clock = localParts(now, tz)
      const yesterday = addDays(clock.day, -1)
      const plan = planAccount({
        state,
        createdDay: localParts(new Date(account.created_at), tz).day,
        today: clock.day,
        now,
      })
      let next: RadarState = {
        ...(state ?? emptyState(account.id, tz)),
        timezone: tz,
        tracked_since: plan.trackedSince,
        computed_through: plan.computedThrough,
      }

      for (const r of plan.ranges) {
        // Never start a piece with the time up: the next tick goes on
        // from the last one saved.
        if (Date.now() > opts.deadline) break
        const { error } = await admin.rpc('radar_compute_days', {
          p_account: account.id,
          p_from: r.from,
          p_to: r.to,
          p_tz: tz,
        })
        if (error) {
          console.error('[radar] compute failed:', account.id, r.from, r.to, error.message)
          break
        }
        if (r.kind === 'today') {
          next.today_refreshed_at = now.toISOString()
          summary.refreshed += 1
        } else {
          next.computed_through = r.to
          if (r.kind === 'backfill') summary.backfilled += 1
          else summary.closedDays += 1
        }
      }

      // The daily work, once the day before is final — and only with
      // the whole history in place: the baseline reads a missing day as
      // zero, so half a history would cry wolf.
      const complete = !!next.computed_through && next.computed_through >= yesterday
      if (complete && clock.hour >= DAILY_HOUR && dailySteps.length > 0) {
        const ctx: DailyContext = {
          admin,
          accountId: account.id,
          tz,
          today: clock.day,
          yesterday,
          hour: clock.hour,
          weekday: clock.weekday,
          now,
          state: next,
        }
        for (const step of dailySteps) {
          if (Date.now() > opts.deadline) break
          try {
            next = { ...next, ...(await step({ ...ctx, state: next })) }
          } catch (err) {
            // One step failing keeps the others and the progress; it is
            // tried again on the next tick.
            console.error('[radar] daily step failed:', account.id, err)
          }
        }
        summary.daily += 1
      }

      await saveState(admin, next)
      summary.accounts += 1
    } catch (err) {
      console.error('[radar] account failed:', account.id, err)
    }
  }
  return summary
}

/**
 * Upserts the state. A database with 079 but not 080 has no columns for
 * the daily marks yet: the history's progress is saved anyway, or the
 * same weeks would be computed again on every tick.
 */
async function saveState(admin: SupabaseClient, s: RadarState): Promise<void> {
  const base = {
    account_id: s.account_id,
    timezone: s.timezone,
    tracked_since: s.tracked_since,
    computed_through: s.computed_through,
    today_refreshed_at: s.today_refreshed_at,
  }
  const marks = {
    ...('detected_through' in s ? { detected_through: s.detected_through } : {}),
    ...('chances_at' in s ? { chances_at: s.chances_at } : {}),
    ...('digest_week' in s ? { digest_week: s.digest_week } : {}),
  }
  const { error } = await admin.from('radar_state').upsert({ ...base, ...marks }, { onConflict: 'account_id' })
  if (!error) return
  const missingColumn = error.code === '42703' || error.code === 'PGRST204'
  if (!missingColumn || Object.keys(marks).length === 0) throw new Error(error.message)
  const retry = await admin.from('radar_state').upsert(base, { onConflict: 'account_id' })
  if (retry.error) throw new Error(retry.error.message)
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

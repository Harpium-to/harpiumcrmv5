import type { SupabaseClient } from '@supabase/supabase-js'

import type { DailyContext, RadarState } from './livro'
import { localParts } from './tempo'

// ============================================================
// Each open deal's chance of closing (Fase 3), from the CRM's own
// closed deals of the last 12 months. No AI, nothing opaque:
//
//   1. the stage: of the deals that reached this stage (their last
//      stage was this one or a later one), how many were won — pulled
//      toward the pipeline's overall rate when there are few;
//   2. time stopped: longer than the pipeline's normal pace lowers it;
//   3. the contact's temperature and origin, when the history shows
//      they matter (lifts calibrated on the same deals, clamped).
//
// The CRM keeps no history of stage moves, so "reached" assumes deals
// move forward — true for most funnels, and the reason the rate is
// pulled toward the base when a stage has few deals.
// See docs/plano-radar-monitoramento.md §5.3.
// ============================================================

export interface StageRow {
  id: string
  pipeline_id: string
  position: number
}

export interface DealRow {
  id: string
  pipeline_id: string
  stage_id: string | null
  status: 'open' | 'won' | 'lost'
  value: number
  created_at: string
  updated_at: string
  closed_at: string | null
  temperature: string | null
  source: string | null
}

export interface Chance {
  id: string
  p: number
  basis: 'historico' | 'fraca'
}

export interface StageRate {
  stage_id: string
  pipeline_id: string
  rate: number
  typical_days: number
  basis: 'historico' | 'fraca'
}

/** Closed deals of a pipeline needed before a chance is shown as reliable. */
export const MIN_CLOSED = 10
const PRIOR = 0.25
const PULL = 5

const DAY = 86_400_000
const smooth = (wins: number, n: number, toward: number) => (wins + toward * PULL) / (n + PULL)
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

function medianOf(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/** Lift of a category (temperature, origin) over the overall rate, clamped. */
function lifts(closed: DealRow[], key: 'temperature' | 'source', overall: number, lo: number, hi: number) {
  const by = new Map<string, { won: number; n: number }>()
  for (const d of closed) {
    const k = d[key]
    if (!k) continue
    const cur = by.get(k) ?? { won: 0, n: 0 }
    cur.n += 1
    if (d.status === 'won') cur.won += 1
    by.set(k, cur)
  }
  const out = new Map<string, number>()
  for (const [k, { won, n }] of by) {
    if (n < 5) continue
    out.set(k, clamp(smooth(won, n, overall) / Math.max(overall, 0.01), lo, hi))
  }
  return out
}

/**
 * The chance of every open deal and the base rate of every stage. Pure.
 * `now` is the moment "time stopped" is measured against.
 */
export function computeChances(args: {
  stages: readonly StageRow[]
  deals: readonly DealRow[]
  now: Date
}): { chances: Chance[]; stageRates: StageRate[] } {
  const { stages, deals, now } = args
  const position = new Map(stages.map((s) => [s.id, s]))
  const chances: Chance[] = []
  const stageRates: StageRate[] = []

  const pipelines = new Set(stages.map((s) => s.pipeline_id))
  for (const d of deals) pipelines.add(d.pipeline_id)

  for (const pipelineId of pipelines) {
    const closed = deals.filter((d) => d.pipeline_id === pipelineId && d.status !== 'open')
    const open = deals.filter((d) => d.pipeline_id === pipelineId && d.status === 'open')
    const won = closed.filter((d) => d.status === 'won')
    const base = smooth(won.length, closed.length, PRIOR)
    const basis: 'historico' | 'fraca' = closed.length >= MIN_CLOSED ? 'historico' : 'fraca'

    const days = won
      .map((d) => (Date.parse(d.closed_at ?? d.updated_at) - Date.parse(d.created_at)) / DAY)
      .filter((x) => x >= 0)
    const typical = Math.max(7, Math.round(medianOf(days) ?? 30))

    const temperature = lifts(closed, 'temperature', base, 0.6, 1.5)
    if (temperature.size === 0) {
      // No evidence yet: a gentle nudge in the obvious direction.
      temperature.set('hot', 1.15)
      temperature.set('cold', 0.85)
    }
    const origin = lifts(closed, 'source', base, 0.7, 1.4)

    const myStages = stages.filter((s) => s.pipeline_id === pipelineId)
    for (const s of myStages) {
      const reached = closed.filter((d) => {
        const at = d.stage_id ? position.get(d.stage_id) : undefined
        return at !== undefined && at.position >= s.position
      })
      const rate = smooth(reached.filter((d) => d.status === 'won').length, reached.length, base)
      stageRates.push({
        stage_id: s.id,
        pipeline_id: pipelineId,
        rate: Math.round(clamp(rate, 0.02, 0.95) * 1000) / 1000,
        typical_days: typical,
        basis,
      })
    }
    const rateOf = new Map(stageRates.filter((r) => r.pipeline_id === pipelineId).map((r) => [r.stage_id, r.rate]))

    for (const d of open) {
      let p = (d.stage_id ? rateOf.get(d.stage_id) : undefined) ?? base
      const stopped = (now.getTime() - Date.parse(d.updated_at)) / DAY
      if (stopped > 2 * typical) p *= 0.5
      else if (stopped > typical) p *= 0.75
      if (d.temperature) p *= temperature.get(d.temperature) ?? 1
      if (d.source) p *= origin.get(d.source) ?? 1
      chances.push({ id: d.id, p: Math.round(clamp(p, 0.02, 0.95) * 1000) / 1000, basis })
    }
  }
  return { chances, stageRates }
}

/**
 * Revenue expected from the open deals due in a month, as a range: the
 * expected value (value × chance) and the band a z of 1.28 around it
 * covers (about 80% of outcomes). Pure.
 */
export function forecastMonth(
  deals: readonly { value: number; p: number | null; expected_close_date: string | null; status: string }[],
  month: string,
): { expected: number; low: number; high: number; deals: number; withoutDate: number } {
  let expected = 0
  let variance = 0
  let count = 0
  let withoutDate = 0
  for (const d of deals) {
    if (d.status !== 'open' || d.p === null) continue
    if (!d.expected_close_date) {
      withoutDate += 1
      continue
    }
    if (d.expected_close_date.slice(0, 7) !== month) continue
    const v = Math.max(Number(d.value) || 0, 0)
    expected += v * d.p
    variance += v * v * d.p * (1 - d.p)
    count += 1
  }
  const band = 1.28 * Math.sqrt(variance)
  return {
    expected: Math.round(expected),
    low: Math.max(0, Math.round(expected - band)),
    high: Math.round(expected + band),
    deals: count,
    withoutDate,
  }
}

// ------------------------------------------------------------
// The night step
// ------------------------------------------------------------

export async function chancesStep(ctx: DailyContext): Promise<Partial<RadarState>> {
  const { admin, accountId, now, tz } = ctx
  if (ctx.state.chances_at && localParts(new Date(ctx.state.chances_at), tz).day === ctx.today) return {}

  const yearAgo = new Date(now.getTime() - 365 * DAY).toISOString()
  const [stagesRes, openRes, closedRes] = await Promise.all([
    admin
      .from('pipeline_stages')
      .select('id, pipeline_id, position, pipelines!inner(account_id)')
      .eq('pipelines.account_id', accountId),
    admin
      .from('deals')
      .select('id, pipeline_id, stage_id, status, value, created_at, updated_at, closed_at, contact:contacts(temperature, source)')
      .eq('account_id', accountId)
      .eq('status', 'open')
      .limit(5000),
    admin
      .from('deals')
      .select('id, pipeline_id, stage_id, status, value, created_at, updated_at, closed_at, contact:contacts(temperature, source)')
      .eq('account_id', accountId)
      .in('status', ['won', 'lost'])
      .gte('updated_at', yearAgo)
      .limit(10000),
  ])
  if (stagesRes.error || openRes.error || closedRes.error) {
    throw new Error((stagesRes.error ?? openRes.error ?? closedRes.error)!.message)
  }

  const toDeal = (r: Record<string, unknown>): DealRow => {
    const contact = (Array.isArray(r.contact) ? r.contact[0] : r.contact) as
      | { temperature: string | null; source: string | null }
      | null
    return {
      id: String(r.id),
      pipeline_id: String(r.pipeline_id),
      stage_id: (r.stage_id as string | null) ?? null,
      status: r.status as DealRow['status'],
      value: Number(r.value) || 0,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
      closed_at: (r.closed_at as string | null) ?? null,
      temperature: contact?.temperature ?? null,
      source: contact?.source ?? null,
    }
  }
  const deals = [...(openRes.data ?? []), ...(closedRes.data ?? [])].map((r) => toDeal(r as Record<string, unknown>))
  const stages = ((stagesRes.data ?? []) as { id: string; pipeline_id: string; position: number }[]).map((s) => ({
    id: s.id,
    pipeline_id: s.pipeline_id,
    position: Number(s.position) || 0,
  }))

  const { chances, stageRates } = computeChances({ stages, deals, now })

  if (stageRates.length > 0) {
    await admin.from('radar_stage_rates').upsert(
      stageRates.map((r) => ({ ...r, account_id: accountId, updated_at: now.toISOString() })),
      { onConflict: 'stage_id' },
    )
  }
  for (let i = 0; i < chances.length; i += 500) {
    const { error } = await admin.rpc('radar_set_win_probabilities', {
      p_account: accountId,
      p_rows: chances.slice(i, i + 500),
    })
    if (error) throw new Error(error.message)
  }
  return { chances_at: now.toISOString() }
}

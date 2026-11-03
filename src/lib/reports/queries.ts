import type { SupabaseClient } from '@supabase/supabase-js'

import { AGENT_GOAL_METRICS } from '@/lib/agents/goals'
import {
  bucketForecast,
  buildGoals,
  buildOutcome,
  closedByDay,
  countByDay,
  groupBy,
  median,
  num,
  twoSeriesByDay,
  UNASSIGNED,
} from './aggregate'
import { fetchAllRows, type PageResult } from './fetch-all'
import { dayKeyOf, previousRange, zonedCalendarDay } from './range'
import type { DateRange } from './range'
import type {
  AgentCostRow,
  AgentRunTotals,
  ApprovalTotals,
  BreakdownRow,
  ForecastBucket,
  ReportBundle,
  TwoSeriesDayPoint,
} from './types'

// ============================================================
// Reading the numbers.
//
// Aggregated in TypeScript over fully-paginated reads rather than in
// SQL, deliberately: SQL aggregation would be one round trip and
// exact, but it would also put every report behind a migration, and
// migrations 044–046 are not applied yet. This way the whole screen
// works against the database as it stands today, and gets *more*
// accurate as migrations land rather than appearing only after they
// do. `fetchAllRows` throws instead of truncating, so the trade-off
// is visible rather than silent.
//
// Every query filters `account_id` explicitly even though RLS already
// scopes it. Same reasoning as the agent routes: the filter makes the
// scoping true in the query as well, so a leaked id reads as empty
// rather than relying on the policy alone.
//
// Money: `numeric` crosses PostgREST as a *string*. Every sum here
// goes through Number() for that reason — `'1200.00' + '800.00'` is
// '1200.00800.00', and a revenue report is the worst place to find
// that out.
// ============================================================

type DB = SupabaseClient

// ------------------------------------------------------------
// What this database can answer
// ------------------------------------------------------------

export interface SchemaCapabilities {
  /** Migration 046: real close stamps instead of `updated_at` guesses. */
  dealClosedAt: boolean
  /** Migration 045: source, temperature, segment, owner_agent_id. */
  contactQualification: boolean
}

/** Postgres "column does not exist". */
const UNDEFINED_COLUMN = '42703'

function isMissingColumn(error: { code?: string; message?: string }): boolean {
  return (
    error.code === UNDEFINED_COLUMN ||
    /does not exist/i.test(error.message ?? '')
  )
}

/**
 * Probe once for the columns later migrations add.
 *
 * Any error that is *not* "no such column" is rethrown: downgrading to
 * approximate numbers because of a transient network failure would
 * mislabel a correct report as a guess, and nobody would ever notice
 * it had happened.
 */
export async function detectCapabilities(
  db: DB,
  accountId: string,
): Promise<SchemaCapabilities> {
  const [deals, contacts] = await Promise.all([
    db.from('deals').select('closed_at').eq('account_id', accountId).limit(1),
    db.from('contacts').select('temperature').eq('account_id', accountId).limit(1),
  ])

  for (const res of [deals, contacts]) {
    if (res.error && !isMissingColumn(res.error)) throw res.error
  }

  return {
    dealClosedAt: !deals.error,
    contactQualification: !contacts.error,
  }
}

// ------------------------------------------------------------
// Comercial
// ------------------------------------------------------------

interface ClosedDealRow {
  status: string
  value: number | string | null
  closed_at: string | null
  assigned_to: string | null
}

async function loadClosedDeals(
  db: DB,
  accountId: string,
  range: DateRange,
  caps: SchemaCapabilities,
): Promise<ClosedDealRow[]> {
  // Without 046 there is no close stamp, so `updated_at` stands in —
  // the best available guess, and flagged as one all the way to the
  // screen (`DealOutcome.approximate`).
  //
  // Two literal selects rather than one interpolated string: the
  // client types parse the select at compile time, and a built string
  // turns every column into `unknown`, which is how a typo in a column
  // name becomes a runtime 400 instead of a build error.
  const stamp = caps.dealClosedAt ? 'closed_at' : 'updated_at'
  const rows = await fetchAllRows<Record<string, unknown>>((from, to) => {
    const base = db
      .from('deals')
      .select(
        caps.dealClosedAt
          ? 'status, value, assigned_to, closed_at'
          : 'status, value, assigned_to, updated_at',
      )
      .eq('account_id', accountId)
      .in('status', ['won', 'lost'])
      .gte(stamp, range.fromIso)
      .lt(stamp, range.toIso)
      .order(stamp, { ascending: true })
      .range(from, to)
    return base as unknown as PromiseLike<PageResult<Record<string, unknown>>>
  })
  return rows.map((row) => ({
    status: String(row.status ?? ''),
    value: row.value as number | string | null,
    closed_at: (row[stamp] as string | null) ?? null,
    assigned_to: (row.assigned_to as string | null) ?? null,
  }))
}

/**
 * Open deals by stage.
 *
 * A snapshot, not a period cut, and the UI says so: a funnel is where
 * the pipeline stands right now. Filtering it by creation date would
 * answer a question nobody asks ("deals created in May that are still
 * open") while looking like the funnel.
 */
async function loadFunnel(db: DB, accountId: string): Promise<BreakdownRow[]> {
  const [stagesRes, deals] = await Promise.all([
    db
      .from('pipeline_stages')
      .select('id, name, position, pipeline_id, pipelines!inner(account_id)')
      .eq('pipelines.account_id', accountId)
      .order('position', { ascending: true }),
    fetchAllRows<{ stage_id: string; value: number | string | null }>((from, to) =>
      db
        .from('deals')
        .select('stage_id, value')
        .eq('account_id', accountId)
        .eq('status', 'open')
        .range(from, to),
    ),
  ])
  if (stagesRes.error) throw stagesRes.error

  const totals = new Map<string, { count: number; value: number }>()
  for (const deal of deals) {
    const entry = totals.get(deal.stage_id) ?? { count: 0, value: 0 }
    entry.count += 1
    entry.value += num(deal.value)
    totals.set(deal.stage_id, entry)
  }

  const stages = (stagesRes.data ?? []) as Array<{ id: string; name: string }>
  return stages.map((stage) => {
    const entry = totals.get(stage.id) ?? { count: 0, value: 0 }
    return {
      key: stage.id,
      label: stage.name,
      count: entry.count,
      value: entry.value,
    }
  })
}

async function loadOwners(
  db: DB,
  accountId: string,
  rows: ClosedDealRow[],
): Promise<BreakdownRow[]> {
  const totals = new Map<string, { count: number; value: number }>()
  for (const row of rows) {
    if (row.status !== 'won') continue
    const key = row.assigned_to ?? UNASSIGNED
    const entry = totals.get(key) ?? { count: 0, value: 0 }
    entry.count += 1
    entry.value += num(row.value)
    totals.set(key, entry)
  }
  if (totals.size === 0) return []

  const ids = [...totals.keys()].filter((id) => id !== UNASSIGNED)
  const names = new Map<string, string>()
  if (ids.length > 0) {
    // `profiles_select` (017) lets account members read each other, so
    // this resolves teammates and not just the caller.
    const { data } = await db
      .from('profiles')
      .select('id, full_name, email')
      .in('id', ids)
    for (const row of (data ?? []) as Array<{
      id: string
      full_name: string | null
      email: string | null
    }>) {
      names.set(row.id, row.full_name?.trim() || row.email || row.id)
    }
  }

  return [...totals.entries()]
    .map(([key, entry]) => ({
      key,
      // An id with no readable profile keeps its id rather than
      // vanishing: the deals are real and have to add up to the total.
      label: key === UNASSIGNED ? '' : names.get(key) ?? key,
      count: entry.count,
      value: entry.value,
    }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
}

/**
 * Open deals by when they are expected to close.
 *
 * `overdue` first on purpose: a deal whose expected close date has
 * passed while it sits open is the most actionable row on the screen,
 * and burying it under "later" is how a forecast becomes decoration.
 */
async function loadForecast(
  db: DB,
  accountId: string,
  range: DateRange,
): Promise<ForecastBucket[]> {
  const rows = await fetchAllRows<{
    expected_close_date: string | null
    value: number | string | null
  }>((from, to) =>
    db
      .from('deals')
      .select('expected_close_date, value')
      .eq('account_id', accountId)
      .eq('status', 'open')
      .range(from, to),
  )
  return bucketForecast(rows, dayKeyOf(zonedCalendarDay(new Date(), range.timezone)))
}

// ------------------------------------------------------------
// Leads
// ------------------------------------------------------------

interface ContactRow {
  created_at: string
  source: string | null
  temperature: string | null
  segment: string | null
  potential: number | string | null
  owner_agent_id: string | null
}

async function loadContacts(
  db: DB,
  accountId: string,
  range: DateRange,
  caps: SchemaCapabilities,
): Promise<ContactRow[]> {
  // One read, grouped four ways below. Without 045 the qualification
  // columns are not there, so the select narrows and those breakdowns
  // come back empty rather than failing the whole report.
  const rows = await fetchAllRows<Record<string, unknown>>((from, to) => {
    const base = db
      .from('contacts')
      .select(
        caps.contactQualification
          ? 'created_at, source, temperature, segment, potential, owner_agent_id'
          : 'created_at',
      )
      .eq('account_id', accountId)
      .gte('created_at', range.fromIso)
      .lt('created_at', range.toIso)
      .order('created_at', { ascending: true })
      .range(from, to)
    return base as unknown as PromiseLike<PageResult<Record<string, unknown>>>
  })
  return rows.map((row) => ({
    created_at: String(row.created_at),
    source: (row.source as string | null) ?? null,
    temperature: (row.temperature as string | null) ?? null,
    segment: (row.segment as string | null) ?? null,
    potential: (row.potential as number | string | null) ?? null,
    owner_agent_id: (row.owner_agent_id as string | null) ?? null,
  }))
}

// ------------------------------------------------------------
// Atendimento
// ------------------------------------------------------------

async function loadMessagesByDay(
  db: DB,
  range: DateRange,
): Promise<TwoSeriesDayPoint[]> {
  // `messages` has no account_id (017 did not add one); RLS scopes it
  // through the conversation's owner, so there is no explicit filter to
  // add here.
  const rows = await fetchAllRows<{ created_at: string; sender_type: string }>(
    (from, to) =>
      db
        .from('messages')
        .select('created_at, sender_type')
        .gte('created_at', range.fromIso)
        .lt('created_at', range.toIso)
        .order('created_at', { ascending: true })
        .range(from, to),
  )

  // agent and bot both count as outbound: from the customer's side a
  // reply is a reply, whoever wrote it.
  return twoSeriesByDay(
    rows,
    range,
    (row) => row.created_at,
    (row) => row.sender_type === 'customer',
  )
}

async function loadConversationsByStatus(
  db: DB,
  accountId: string,
  range: DateRange,
): Promise<BreakdownRow[]> {
  const rows = await fetchAllRows<{ status: string }>((from, to) =>
    db
      .from('conversations')
      .select('status')
      .eq('account_id', accountId)
      .gte('created_at', range.fromIso)
      .lt('created_at', range.toIso)
      .range(from, to),
  )
  return groupBy(rows, (row) => row.status)
}

// ------------------------------------------------------------
// Agentes
// ------------------------------------------------------------

interface TaskRow {
  agent_id: string | null
  kind: string
  status: string
  cost_usd: number | string | null
  total_tokens: number | null
  finished_at: string | null
}

async function loadAgentSection(
  db: DB,
  accountId: string,
  range: DateRange,
  contacts: ContactRow[],
): Promise<ReportBundle['agents']> {
  try {
    const [agentsRes, runs, tasks, approvals] = await Promise.all([
      db.from('agents').select('id, name, goals').eq('account_id', accountId),
      fetchAllRows<{
        agent_id: string | null
        agent_name_snapshot: string
        status: string
        total_tokens: number | null
        duration_ms: number | null
      }>((from, to) =>
        db
          .from('agent_runs')
          .select('agent_id, agent_name_snapshot, status, total_tokens, duration_ms')
          .eq('account_id', accountId)
          .gte('started_at', range.fromIso)
          .lt('started_at', range.toIso)
          .range(from, to),
      ),
      fetchAllRows<TaskRow>((from, to) =>
        db
          .from('agent_tasks')
          .select('agent_id, kind, status, cost_usd, total_tokens, finished_at')
          .eq('account_id', accountId)
          .gte('created_at', range.fromIso)
          .lt('created_at', range.toIso)
          .range(from, to),
      ),
      fetchAllRows<{ status: string; created_at: string; decided_at: string | null }>(
        (from, to) =>
          db
            .from('agent_approvals')
            .select('status, created_at, decided_at')
            .eq('account_id', accountId)
            .gte('created_at', range.fromIso)
            .lt('created_at', range.toIso)
            .range(from, to),
      ),
    ])
    if (agentsRes.error) throw agentsRes.error

    const agents = (agentsRes.data ?? []) as Array<{
      id: string
      name: string
      goals: Record<string, number> | null
    }>
    const nameById = new Map(agents.map((a) => [a.id, a.name]))

    // Runs per agent. Keyed by id where there is one, and by the name
    // snapshot otherwise — a deleted agent's runs survive (ON DELETE
    // SET NULL) and still have to appear, or the totals stop matching
    // the live feed.
    const runTotals = new Map<string, AgentRunTotals>()
    const durations = new Map<string, number[]>()
    for (const run of runs) {
      const key = run.agent_id ?? `name:${run.agent_name_snapshot}`
      const entry =
        runTotals.get(key) ??
        ({
          agentId: run.agent_id ?? '',
          agentName:
            (run.agent_id ? nameById.get(run.agent_id) : null) ??
            run.agent_name_snapshot,
          replied: 0,
          handoff: 0,
          skipped: 0,
          failed: 0,
          tokens: 0,
          avgDurationMs: null,
        } satisfies AgentRunTotals)
      if (run.status === 'replied') entry.replied += 1
      else if (run.status === 'handoff') entry.handoff += 1
      else if (run.status === 'skipped') entry.skipped += 1
      else if (run.status === 'failed') entry.failed += 1
      entry.tokens += num(run.total_tokens)
      runTotals.set(key, entry)
      if (run.duration_ms !== null) {
        const list = durations.get(key) ?? []
        list.push(num(run.duration_ms))
        durations.set(key, list)
      }
    }
    for (const [key, entry] of runTotals) {
      const list = durations.get(key) ?? []
      entry.avgDurationMs =
        list.length > 0
          ? Math.round(list.reduce((a, b) => a + b, 0) / list.length)
          : null
    }

    const costByAgent = new Map<string, AgentCostRow>()
    for (const task of tasks) {
      const id = task.agent_id ?? ''
      const entry =
        costByAgent.get(id) ??
        ({
          agentId: id,
          agentName: nameById.get(id) ?? '',
          costUsd: 0,
          tokens: 0,
          tasks: 0,
        } satisfies AgentCostRow)
      entry.costUsd += num(task.cost_usd)
      entry.tokens += num(task.total_tokens)
      entry.tasks += 1
      costByAgent.set(id, entry)
    }

    const decisionMinutes: number[] = []
    const approvalTotals: ApprovalTotals = {
      pending: 0,
      approved: 0,
      rejected: 0,
      expired: 0,
      medianDecisionMinutes: null,
    }
    for (const approval of approvals) {
      if (approval.status === 'pending') approvalTotals.pending += 1
      else if (approval.status === 'approved') approvalTotals.approved += 1
      else if (approval.status === 'rejected') approvalTotals.rejected += 1
      else if (approval.status === 'expired') approvalTotals.expired += 1
      if (approval.decided_at) {
        const ms =
          new Date(approval.decided_at).getTime() -
          new Date(approval.created_at).getTime()
        if (ms >= 0) decisionMinutes.push(ms / 60_000)
      }
    }
    // Median, not mean: one approval left over a weekend would drag a
    // mean into saying the team takes two days to answer anything.
    const med = median(decisionMinutes)
    approvalTotals.medianDecisionMinutes =
      med === null ? null : Math.round(med * 10) / 10

    return {
      runs: [...runTotals.values()].sort((a, b) => b.replied - a.replied),
      tasksByKind: groupBy(tasks, (task) => task.kind),
      cost: [...costByAgent.values()].sort((a, b) => b.costUsd - a.costUsd),
      goals: buildGoals({
        agents,
        runs,
        tasks,
        contactOwnerIds: contacts.map((c) => c.owner_agent_id),
        windowDays: range.dayKeys.length,
      }),
      approvals: approvalTotals,
    }
  } catch {
    // The agent tables arrive with migrations 044/045. Until those run,
    // the section is absent rather than a wall of zeros — "no agents
    // configured" and "this table does not exist" must not look the
    // same on a report.
    return null
  }
}

// ------------------------------------------------------------
// The bundle
// ------------------------------------------------------------

export async function loadReportBundle(
  db: DB,
  accountId: string,
  range: DateRange,
): Promise<ReportBundle> {
  const caps = await detectCapabilities(db, accountId)
  const prev = previousRange(range)

  const [
    accountRes,
    closed,
    previousClosed,
    funnel,
    forecast,
    contacts,
    messagesByDay,
    conversationsByStatus,
  ] = await Promise.all([
    db.from('accounts').select('default_currency').eq('id', accountId).maybeSingle(),
    loadClosedDeals(db, accountId, range, caps),
    loadClosedDeals(db, accountId, prev, caps),
    loadFunnel(db, accountId),
    loadForecast(db, accountId, range),
    loadContacts(db, accountId, range, caps),
    loadMessagesByDay(db, range),
    loadConversationsByStatus(db, accountId, range),
  ])

  const [dealsByOwner, agents] = await Promise.all([
    loadOwners(db, accountId, closed),
    loadAgentSection(db, accountId, range, contacts),
  ])

  return {
    range: {
      fromIso: range.fromIso,
      toIso: range.toIso,
      timezone: range.timezone,
      dayKeys: range.dayKeys,
    },
    currency:
      (accountRes.data as { default_currency?: string } | null)
        ?.default_currency ?? 'BRL',
    deals: buildOutcome(closed, previousClosed, !caps.dealClosedAt),
    dealsByDay: closedByDay(closed, range),
    funnel,
    dealsByOwner,
    forecast,
    contactsByDay: countByDay(
      contacts.map((c) => c.created_at),
      range,
    ),
    contactsBySource: caps.contactQualification
      ? groupBy(contacts, (c) => c.source)
      : [],
    contactsByTemperature: caps.contactQualification
      ? groupBy(
          contacts,
          (c) => c.temperature,
          (c) => num(c.potential),
        )
      : [],
    contactsBySegment: caps.contactQualification
      ? groupBy(contacts, (c) => c.segment, undefined, 8)
      : [],
    messagesByDay,
    conversationsByStatus,
    agents,
  }
}

export { AGENT_GOAL_METRICS }

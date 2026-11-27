import type { SupabaseClient } from '@supabase/supabase-js'

import { MIN_STEP_MS } from './loop'
import { processarRondas, type RondasSummary } from './rondas'
import { runAccountQueue, type QueueSummary } from './runner'

// ============================================================
// The agent engine — one entry point for everything agents do on a
// schedule (docs/plano-agentes-ativos.md, Fase 0).
//
// Before: the queue only moved if something called /api/agents/cron
// every minute, a second scheduler most CRMs never set up — so tasks
// sat in the queue and approving one in Aprovações did nothing. Now the
// same cron that already runs automations, Harpi's routines and the
// Radar (/api/automations/cron) calls this too, within its time budget.
// /api/agents/cron still works and calls the same function.
//
// Order: the pulse first (so the screen can tell the engine is alive
// even on a tick with no work), stale approvals, the rounds (cheap
// queries), then the queue (AI calls) for as long as time allows.
//
// Never throws.
// ============================================================

export interface AgentesSummary extends QueueSummary {
  accounts: number
  expired: number
  /** Tasks too old to run: the engine was not running when they were due. */
  stale: number
  rondas: RondasSummary | null
}

/** Rounds get a short slice: they are queries, and the queue needs the rest. */
const RONDAS_BUDGET_MS = 4_000
/** Accounts touched per tick. */
const MAX_ACCOUNTS = 20
/** Tasks claimed per account per tick. */
const MAX_TASKS_PER_ACCOUNT = 5
/**
 * A task due longer ago than this sat in a queue nobody was running
 * (before 082 the queue needed a second scheduler most CRMs never set
 * up). Running it now would message a customer days late about
 * something that has moved on, so it is cancelled instead.
 */
const STALE_AFTER_MS = 3 * 86_400_000

export async function processarAgentes(
  db: SupabaseClient,
  opts: { deadline: number },
): Promise<AgentesSummary> {
  const summary: AgentesSummary = {
    accounts: 0,
    expired: 0,
    stale: 0,
    rondas: null,
    claimed: 0,
    completed: 0,
    deferred: 0,
    parked: 0,
    failed: 0,
  }
  const nowIso = () => new Date().toISOString()

  try {
    await db.from('agent_engine_state').update({ last_tick_at: nowIso() }).eq('id', 1)
  } catch {
    // 082 not applied: the engine still runs.
  }

  // An approval nobody decided in time is stale: a message approved
  // tomorrow is worse than none. Its task stops too, instead of waiting
  // for a decision that can no longer come.
  try {
    const { data: expired } = await db
      .from('agent_approvals')
      .update({ status: 'expired' })
      .eq('status', 'pending')
      .not('expires_at', 'is', null)
      .lt('expires_at', nowIso())
      .select('task_id')
    const taskIds = ((expired ?? []) as { task_id: string | null }[])
      .map((r) => r.task_id)
      .filter((id): id is string => !!id)
    summary.expired = (expired ?? []).length
    if (taskIds.length > 0) {
      await db
        .from('agent_tasks')
        .update({ status: 'failed', last_error: 'aprovação expirou', finished_at: nowIso() })
        .in('id', taskIds)
        .eq('status', 'waiting_approval')
    }
  } catch (err) {
    console.error('[agentes] expiring approvals failed:', err)
  }

  try {
    const { data: stale } = await db
      .from('agent_tasks')
      .update({
        status: 'cancelled',
        last_error: 'ficou mais de 3 dias parada na fila (o motor não estava rodando)',
        finished_at: nowIso(),
      })
      .in('status', ['queued', 'blocked'])
      .lt('scheduled_for', new Date(Date.now() - STALE_AFTER_MS).toISOString())
      .select('id')
    summary.stale = (stale ?? []).length
  } catch (err) {
    console.error('[agentes] stale sweep failed:', err)
  }

  try {
    summary.rondas = await processarRondas(db, {
      deadline: Math.min(opts.deadline, Date.now() + RONDAS_BUDGET_MS),
    })
  } catch (err) {
    console.error('[agentes] rounds failed:', err)
  }

  try {
    const { data: pending, error } = await db
      .from('agent_tasks')
      .select('account_id')
      .in('status', ['queued', 'blocked'])
      .lte('scheduled_for', nowIso())
      .order('priority', { ascending: false })
      .limit(500)
    if (error) throw error
    const accountIds = [
      ...new Set(((pending ?? []) as { account_id: string }[]).map((r) => r.account_id)),
    ].slice(0, MAX_ACCOUNTS)

    // Sequential: each account's tasks use its own AI key, and fanning
    // out would turn one busy CRM into a rate-limit problem for all.
    for (const accountId of accountIds) {
      if (opts.deadline - Date.now() < MIN_STEP_MS) break
      try {
        const s = await runAccountQueue(accountId, MAX_TASKS_PER_ACCOUNT, opts.deadline)
        summary.accounts += 1
        summary.claimed += s.claimed
        summary.completed += s.completed
        summary.deferred += s.deferred
        summary.parked += s.parked
        summary.failed += s.failed
      } catch (err) {
        console.error(`[agentes] account ${accountId} failed:`, err)
      }
    }
  } catch (err) {
    console.error('[agentes] queue scan failed:', err)
  }

  try {
    await db
      .from('agent_engine_state')
      .update({ last_tick_at: nowIso(), last_summary: summary })
      .eq('id', 1)
  } catch {
    // Best-effort.
  }
  return summary
}

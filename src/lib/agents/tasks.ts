import type { SupabaseClient } from '@supabase/supabase-js'
import { HANDOFF_CHAIN, HANDOFF_TASK_KIND } from './roles'
import type { AgentTask, AgentTaskStep, AgentTaskStatus } from './types'

// ============================================================
// The work queue.
//
// Tasks are Postgres rows claimed with FOR UPDATE SKIP LOCKED (see
// `claim_agent_task` in migration 045). Everything here is a thin,
// honest wrapper over that — the concurrency guarantee lives in the
// database, not in this file, because a JavaScript "read then update"
// is exactly how two workers message the same lead twice.
// ============================================================

const TASK_COLUMNS =
  'id, account_id, agent_id, target_role, created_by_agent_id, kind, title, input, output, contact_id, deal_id, conversation_id, status, priority, scheduled_for, depends_on_task_id, attempts, max_attempts, last_error, total_tokens, cost_usd, created_at, started_at, finished_at'

interface TaskRow {
  id: string
  account_id: string
  agent_id: string | null
  target_role: string | null
  created_by_agent_id: string | null
  kind: string
  title: string
  input: Record<string, unknown> | null
  output: Record<string, unknown> | null
  contact_id: string | null
  deal_id: string | null
  conversation_id: string | null
  status: string
  priority: number
  scheduled_for: string
  depends_on_task_id: string | null
  attempts: number
  max_attempts: number
  last_error: string | null
  total_tokens: number | null
  cost_usd: number | string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export function mapTaskRow(row: TaskRow): AgentTask {
  return {
    id: row.id,
    accountId: row.account_id,
    agentId: row.agent_id,
    targetRole: row.target_role,
    createdByAgentId: row.created_by_agent_id,
    kind: row.kind,
    title: row.title,
    input: row.input ?? {},
    output: row.output,
    contactId: row.contact_id,
    dealId: row.deal_id,
    conversationId: row.conversation_id,
    status: row.status as AgentTaskStatus,
    priority: row.priority,
    scheduledFor: row.scheduled_for,
    dependsOnTaskId: row.depends_on_task_id,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error,
    totalTokens: row.total_tokens ?? 0,
    costUsd: Number(row.cost_usd ?? 0),
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}

export interface EnqueueArgs {
  accountId: string
  /** Either a specific agent, or a role for the orchestrator to route to. */
  agentId?: string | null
  targetRole?: string | null
  createdByAgentId?: string | null
  createdBy?: string | null
  kind: string
  title: string
  input?: Record<string, unknown>
  contactId?: string | null
  dealId?: string | null
  conversationId?: string | null
  priority?: number
  /** Not before this time. Drives follow-ups and off-hours deferral. */
  scheduledFor?: Date | string | null
  /** Stays `blocked` until this task is done. */
  dependsOnTaskId?: string | null
  maxAttempts?: number
  /** Stable key for duplicate suppression within the account. */
  dedupeKey?: string | null
}

/**
 * Add work to the queue.
 *
 * Returns the task, or `null` when a task with the same `dedupeKey`
 * already exists. That null is a success, not an error: two triggers
 * racing to enqueue "research this company" should result in one task,
 * and the caller wanting to know which one won is rarer than the
 * caller just wanting it queued once.
 */
export async function enqueueTask(
  db: SupabaseClient,
  args: EnqueueArgs,
): Promise<AgentTask | null> {
  const scheduledFor =
    args.scheduledFor instanceof Date
      ? args.scheduledFor.toISOString()
      : (args.scheduledFor ?? new Date().toISOString())

  const { data, error } = await db
    .from('agent_tasks')
    .insert({
      account_id: args.accountId,
      agent_id: args.agentId ?? null,
      target_role: args.targetRole ?? null,
      created_by_agent_id: args.createdByAgentId ?? null,
      created_by: args.createdBy ?? null,
      kind: args.kind,
      title: args.title,
      input: args.input ?? {},
      contact_id: args.contactId ?? null,
      deal_id: args.dealId ?? null,
      conversation_id: args.conversationId ?? null,
      // A task with a dependency starts blocked; `claim_agent_task`
      // promotes it once the blocker finishes.
      status: args.dependsOnTaskId ? 'blocked' : 'queued',
      priority: args.priority ?? 0,
      scheduled_for: scheduledFor,
      depends_on_task_id: args.dependsOnTaskId ?? null,
      max_attempts: args.maxAttempts ?? 3,
      dedupe_key: args.dedupeKey ?? null,
    })
    .select(TASK_COLUMNS)
    .maybeSingle()

  if (error) {
    // 23505 = unique_violation, i.e. the dedupe index did its job.
    if (error.code === '23505') return null
    throw error
  }
  return data ? mapTaskRow(data as TaskRow) : null
}

/**
 * Claim the next runnable task for an account, atomically.
 *
 * Returns null when the queue is empty — the normal case, called on a
 * schedule. The RPC also promotes tasks whose dependency has finished,
 * so callers never reason about the chain.
 */
export async function claimTask(
  db: SupabaseClient,
  accountId: string,
): Promise<AgentTask | null> {
  const { data, error } = await db.rpc('claim_agent_task', {
    p_account_id: accountId,
  })
  if (error) throw error
  const rows = (data ?? []) as TaskRow[]
  return rows.length > 0 ? mapTaskRow(rows[0]) : null
}

export interface CompleteArgs {
  output?: Record<string, unknown> | null
  totalTokens?: number
  costUsd?: number
}

/** Mark a task done and record what it produced. */
export async function completeTask(
  db: SupabaseClient,
  taskId: string,
  args: CompleteArgs = {},
): Promise<void> {
  const { error } = await db
    .from('agent_tasks')
    .update({
      status: 'done',
      output: args.output ?? null,
      total_tokens: args.totalTokens ?? 0,
      cost_usd: args.costUsd ?? 0,
      finished_at: new Date().toISOString(),
    })
    .eq('id', taskId)
  if (error) throw error
}

/**
 * Record a failure, and decide whether it gets another go.
 *
 * `attempts` was already incremented by the claim, so the comparison
 * here reflects attempts *spent*. Backoff is exponential from one
 * minute — long enough that a provider blip clears, short enough that
 * a transient failure doesn't park the lead until tomorrow.
 */
export async function failTask(
  db: SupabaseClient,
  task: AgentTask,
  message: string,
): Promise<{ retried: boolean }> {
  const exhausted = task.attempts >= task.maxAttempts
  const backoffMs = Math.min(60_000 * 2 ** (task.attempts - 1), 30 * 60_000)

  const { error } = await db
    .from('agent_tasks')
    .update(
      exhausted
        ? {
            status: 'failed',
            last_error: message.slice(0, 1000),
            finished_at: new Date().toISOString(),
          }
        : {
            status: 'queued',
            last_error: message.slice(0, 1000),
            scheduled_for: new Date(Date.now() + backoffMs).toISOString(),
          },
    )
    .eq('id', task.id)
  if (error) throw error
  return { retried: !exhausted }
}

/** Park a task while an approval is pending. */
export async function parkTaskForApproval(
  db: SupabaseClient,
  taskId: string,
): Promise<void> {
  const { error } = await db
    .from('agent_tasks')
    .update({ status: 'waiting_approval' })
    .eq('id', taskId)
  if (error) throw error
}

/** Put an approved task back in line, to run immediately. */
export async function resumeTask(
  db: SupabaseClient,
  taskId: string,
): Promise<void> {
  const { error } = await db
    .from('agent_tasks')
    .update({ status: 'queued', scheduled_for: new Date().toISOString() })
    .eq('id', taskId)
  if (error) throw error
}

/**
 * Hand a finished task's work to the next role in the commercial line.
 *
 * The successor is looked up in `HANDOFF_CHAIN` rather than named by
 * the caller, so the sequence is defined once (roles.ts) instead of
 * being re-stated at every site that completes a task. Routing is by
 * *role*, not by agent id — the SDR passes to "an executive", and
 * which one is the orchestrator's problem at claim time.
 *
 * Returns the new task, or null when the role ends the chain or the
 * handoff was already enqueued (the dedupe key makes this idempotent,
 * which matters because a retried task would otherwise hand off twice).
 */
export async function handoffToNextRole(
  db: SupabaseClient,
  task: AgentTask,
  fromRole: string,
  briefing: Record<string, unknown>,
): Promise<AgentTask | null> {
  const nextRole = HANDOFF_CHAIN[fromRole]
  if (!nextRole) return null

  return enqueueTask(db, {
    accountId: task.accountId,
    targetRole: nextRole,
    createdByAgentId: task.agentId,
    kind: HANDOFF_TASK_KIND[fromRole] ?? 'custom',
    title: task.title,
    // The briefing travels with the task. A handoff that passed only a
    // contact id would make the next agent redo the research.
    input: { ...briefing, handed_off_from: fromRole, source_task_id: task.id },
    contactId: task.contactId,
    dealId: task.dealId,
    conversationId: task.conversationId,
    priority: task.priority,
    dedupeKey: `handoff:${task.id}:${nextRole}`,
  })
}

// ============================================================
// Steps — the visible inside of a run.
// ============================================================

interface StepRow {
  id: string
  task_id: string
  seq: number
  label: string
  status: string
  detail: string | null
  started_at: string
  finished_at: string | null
}

export function mapStepRow(row: StepRow): AgentTaskStep {
  return {
    id: row.id,
    taskId: row.task_id,
    seq: row.seq,
    label: row.label,
    status: row.status as AgentTaskStep['status'],
    detail: row.detail,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}

/**
 * Open a step. Written *before* the work happens, which is the whole
 * point: the monitor shows "Etapa 3: construindo abordagem" because
 * the runner said so, not because the UI is animating a guess.
 *
 * Never throws — a failed trace write must not fail the task it is
 * describing.
 */
export async function startStep(
  db: SupabaseClient,
  args: { accountId: string; taskId: string; seq: number; label: string },
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from('agent_task_steps')
      .insert({
        account_id: args.accountId,
        task_id: args.taskId,
        seq: args.seq,
        label: args.label,
      })
      .select('id')
      .single()
    if (error) throw error
    return (data as { id: string }).id
  } catch (err) {
    console.error('[agents] could not open step:', err)
    return null
  }
}

/** Close a step. Never throws, for the same reason as `startStep`. */
export async function finishStep(
  db: SupabaseClient,
  stepId: string | null,
  status: AgentTaskStep['status'],
  detail?: string | null,
): Promise<void> {
  if (!stepId) return
  try {
    const { error } = await db
      .from('agent_task_steps')
      .update({
        status,
        detail: detail ?? null,
        finished_at: new Date().toISOString(),
      })
      .eq('id', stepId)
    if (error) throw error
  } catch (err) {
    console.error('[agents] could not close step:', err)
  }
}

// ============================================================
// Reads for the dashboard.
// ============================================================

export async function loadTasks(
  db: SupabaseClient,
  accountId: string,
  opts: { status?: AgentTaskStatus[]; limit?: number } = {},
): Promise<AgentTask[]> {
  let query = db
    .from('agent_tasks')
    .select(TASK_COLUMNS)
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200))

  if (opts.status && opts.status.length > 0) {
    query = query.in('status', opts.status)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map((row) => mapTaskRow(row as TaskRow))
}

export async function loadTaskSteps(
  db: SupabaseClient,
  taskId: string,
): Promise<AgentTaskStep[]> {
  const { data, error } = await db
    .from('agent_task_steps')
    .select('id, task_id, seq, label, status, detail, started_at, finished_at')
    .eq('task_id', taskId)
    .order('seq', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => mapStepRow(row as StepRow))
}

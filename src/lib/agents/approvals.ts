import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentApproval, ApprovalStatus } from './types'

// ============================================================
// The brake: actions an agent parked for a human.
//
// An approval is always paired with the task that is waiting on it.
// Deciding does two things — records the decision, and unblocks (or
// kills) the task — and the order matters: the decision is written
// first, so a crash between the two leaves an approval that has been
// answered and a task still parked, which a human can see and retry.
// The reverse order would release a task with no record of who
// authorised it.
// ============================================================

const APPROVAL_COLUMNS =
  'id, agent_id, agent_name_snapshot, task_id, contact_id, kind, summary, payload, edited_payload, status, decided_by, decided_at, decision_note, expires_at, executed_at, created_at'

interface ApprovalRow {
  id: string
  agent_id: string | null
  agent_name_snapshot: string
  task_id: string | null
  contact_id: string | null
  kind: string
  summary: string
  payload: Record<string, unknown> | null
  edited_payload: Record<string, unknown> | null
  status: string
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
  expires_at: string | null
  executed_at: string | null
  created_at: string
}

export function mapApprovalRow(row: ApprovalRow): AgentApproval {
  return {
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name_snapshot,
    taskId: row.task_id,
    contactId: row.contact_id,
    kind: row.kind,
    summary: row.summary,
    payload: row.payload ?? {},
    editedPayload: row.edited_payload,
    status: row.status as ApprovalStatus,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    expiresAt: row.expires_at,
    executedAt: row.executed_at,
    createdAt: row.created_at,
  }
}

export async function loadApprovals(
  db: SupabaseClient,
  accountId: string,
  opts: { status?: ApprovalStatus[]; limit?: number } = {},
): Promise<AgentApproval[]> {
  let query = db
    .from('agent_approvals')
    .select(APPROVAL_COLUMNS)
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200))

  if (opts.status && opts.status.length > 0) {
    query = query.in('status', opts.status)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map((row) => mapApprovalRow(row as ApprovalRow))
}

export interface RequestApprovalArgs {
  accountId: string
  agentId: string
  agentName: string
  taskId: string | null
  contactId: string | null
  kind: string
  summary: string
  payload: Record<string, unknown>
  /**
   * How long the action stays worth taking. A reply approved tomorrow
   * is worse than no reply, so customer-facing asks get a short fuse
   * and the runner expires them rather than sending late.
   */
  expiresInMinutes?: number
}

/**
 * Park an action for a human and return the approval id.
 *
 * The payload is the exact action, so approving executes precisely
 * what was shown — not a regenerated version that happens to differ
 * from the text the operator read and agreed to.
 */
export async function requestApproval(
  db: SupabaseClient,
  args: RequestApprovalArgs,
): Promise<string | null> {
  try {
    const expiresAt =
      args.expiresInMinutes && args.expiresInMinutes > 0
        ? new Date(Date.now() + args.expiresInMinutes * 60_000).toISOString()
        : null

    const { data, error } = await db
      .from('agent_approvals')
      .insert({
        account_id: args.accountId,
        agent_id: args.agentId,
        agent_name_snapshot: args.agentName,
        task_id: args.taskId,
        contact_id: args.contactId,
        kind: args.kind,
        summary: args.summary.slice(0, 500),
        payload: args.payload,
        expires_at: expiresAt,
      })
      .select('id')
      .single()

    if (error) throw error
    return (data as { id: string }).id
  } catch (err) {
    console.error('[agents] could not request approval:', err)
    return null
  }
}

/**
 * The action an approved request should execute.
 *
 * Prefers the human's edit over the agent's original, which is the
 * whole point of allowing an edit — and keeps `payload` untouched so
 * the audit trail still shows what the agent actually proposed.
 */
export function effectivePayload(
  approval: AgentApproval,
): Record<string, unknown> {
  return approval.editedPayload ?? approval.payload
}

/**
 * Has this approval gone stale?
 *
 * Checked at execution time rather than by a sweeper job: a row that
 * expired thirty seconds ago and a row that expired yesterday are the
 * same thing to the runner, and a sweeper is one more moving part to
 * operate for a question that is a timestamp comparison.
 */
export function isExpired(approval: AgentApproval, now = new Date()): boolean {
  if (!approval.expiresAt) return false
  return new Date(approval.expiresAt).getTime() <= now.getTime()
}

/**
 * Atomically take an approved action for execution.
 *
 * The `executed_at IS NULL` filter is the latch: two runners (or one
 * runner retrying a half-failed task) race on the same UPDATE and
 * exactly one gets a row back. The other gets null and does nothing,
 * which is the difference between "approve" meaning *once* and
 * meaning *at least once* — and for a customer-facing message, at
 * least once is a bug with a person on the other end of it.
 */
export async function claimApprovedAction(
  db: SupabaseClient,
  taskId: string,
): Promise<AgentApproval | null> {
  const { data, error } = await db
    .from('agent_approvals')
    .update({ executed_at: new Date().toISOString() })
    .eq('task_id', taskId)
    .eq('status', 'approved')
    .is('executed_at', null)
    .select(APPROVAL_COLUMNS)
    .maybeSingle()

  if (error) throw error
  return data ? mapApprovalRow(data as ApprovalRow) : null
}

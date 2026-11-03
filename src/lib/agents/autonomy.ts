// ============================================================
// How far an agent may go on its own.
//
// Pure and synchronous — no database, no model call. Every "may this
// agent do X" question in the app resolves here, so the policy is one
// file to read and one file to test, rather than a scattering of
// `if (agent.autonomy > 2)` checks that drift apart.
// ============================================================

/**
 * 1 assisted      — proposes everything, a human approves everything.
 * 2 semi          — keeps the CRM up to date on its own; anything a
 *                   customer would see stops for approval.
 * 3 autonomous    — runs the commercial motion inside the configured
 *                   limits. Money and contracts still stop.
 * 4 orchestrating — plans its own queue and delegates to other agents.
 */
export type Autonomy = 1 | 2 | 3 | 4

export const AUTONOMY_LEVELS: readonly Autonomy[] = [1, 2, 3, 4] as const

/** Every action an agent can attempt. The runner names one per step. */
export type ActionKind =
  | 'create_lead'
  | 'update_crm'
  | 'create_deal'
  | 'move_stage'
  | 'log_activity'
  | 'send_message'
  | 'schedule_meeting'
  | 'delegate_task'
  | 'send_proposal'
  | 'give_discount'
  | 'close_deal'
  | 'delete_data'

/**
 * Minimum autonomy at which an action runs unattended.
 *
 * `null` means "never unattended" — no autonomy level clears it. Those
 * are the three where a wrong call costs money or is irreversible:
 * discounts, closing a deal, deleting data. An agent may still *ask*
 * for them, which is the point of the approvals queue; it just cannot
 * decide alone, no matter how the operator sets the dial.
 *
 * The split at level 3 is the important one. Everything at or below 2
 * only touches the account's own records — if it is wrong, you edit
 * the row. From 3 up the agent speaks to a customer, and that cannot
 * be edited after the fact.
 */
const UNATTENDED_AT: Record<ActionKind, Autonomy | null> = {
  // Record-keeping: reversible, invisible to the customer.
  create_lead: 2,
  update_crm: 2,
  create_deal: 2,
  move_stage: 2,
  log_activity: 2,

  // Customer-facing: not reversible.
  send_message: 3,
  schedule_meeting: 3,

  // Coordination: only the level that is meant to run a queue.
  delegate_task: 4,

  // Commercially binding.
  send_proposal: 4,

  // Never unattended, at any level.
  give_discount: null,
  close_deal: null,
  delete_data: null,
}

export interface AgentPolicy {
  autonomy: Autonomy
  /** Tool allow-list. An action whose tool is absent cannot run at all. */
  tools: string[]
  /** Actions pinned below the autonomy ceiling — always ask. */
  requireApprovalFor: string[]
}

export type Decision =
  | { allowed: true; needsApproval: false }
  | { allowed: true; needsApproval: true; reason: ApprovalReason }
  | { allowed: false; reason: 'tool_not_granted' }

export type ApprovalReason =
  | 'autonomy_below_threshold'
  | 'never_unattended'
  | 'pinned_by_operator'

/**
 * May this agent perform this action right now, and does a human have
 * to see it first?
 *
 * Three outcomes, not two. "Not allowed" and "allowed but needs a
 * human" are different things: the first is a misconfiguration the
 * operator should fix (the agent was never given the tool), the second
 * is the system working as designed. Collapsing them into a boolean is
 * how you end up with an approvals queue full of actions the agent was
 * never supposed to attempt.
 */
export function decide(policy: AgentPolicy, action: ActionKind): Decision {
  // The tool allow-list is a hard gate and is checked first: an agent
  // without `messaging` cannot send a message even with a human
  // standing by to approve it. Otherwise a researcher at autonomy 1
  // would quietly become a sender the moment someone clicked Approve.
  if (!hasToolFor(policy.tools, action)) {
    return { allowed: false, reason: 'tool_not_granted' }
  }

  if (policy.requireApprovalFor.includes(action)) {
    return { allowed: true, needsApproval: true, reason: 'pinned_by_operator' }
  }

  const threshold = UNATTENDED_AT[action]
  if (threshold === null) {
    return { allowed: true, needsApproval: true, reason: 'never_unattended' }
  }
  if (policy.autonomy < threshold) {
    return {
      allowed: true,
      needsApproval: true,
      reason: 'autonomy_below_threshold',
    }
  }

  return { allowed: true, needsApproval: false }
}

/**
 * Which tool an action needs. Several actions share one — granting
 * `crm` is granting the whole record-keeping group, which is how an
 * operator thinks about it ("this agent can update the CRM"), rather
 * than twelve checkboxes that are always ticked together.
 */
const TOOL_FOR_ACTION: Record<ActionKind, string> = {
  create_lead: 'crm',
  update_crm: 'crm',
  create_deal: 'pipeline',
  move_stage: 'pipeline',
  log_activity: 'crm',
  send_message: 'messaging',
  schedule_meeting: 'calendar',
  delegate_task: 'delegation',
  send_proposal: 'proposals',
  give_discount: 'proposals',
  close_deal: 'pipeline',
  delete_data: 'crm',
}

export function toolForAction(action: ActionKind): string {
  return TOOL_FOR_ACTION[action]
}

function hasToolFor(tools: string[], action: ActionKind): boolean {
  return tools.includes(TOOL_FOR_ACTION[action])
}

/** Narrow an arbitrary number into a valid level, clamping out of range. */
export function toAutonomy(value: unknown): Autonomy {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return 1
  if (n <= 1) return 1
  if (n >= 4) return 4
  return n as Autonomy
}

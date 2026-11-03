// ============================================================
// Shared types for the agent team.
//
// An agent is a persona + routing rules that borrows the account's
// provider credentials from `ai_configs`. It never holds a key of its
// own — see the header of migration 044 for why.
// ============================================================

/** Live operational state, written by the runner — not the operator's switch. */
export type AgentStatus =
  | 'idle'
  | 'working'
  | 'researching'
  | 'talking'
  | 'analyzing'
  | 'waiting_reply'
  | 'waiting_approval'
  | 'paused'
  | 'error'

/** One agent, as stored. Mirrors the `agents` table. */
export interface Agent {
  id: string
  accountId: string
  name: string
  /** Job title: prospector | researcher | sdr | … | manager | custom. */
  role: string
  avatarUrl: string | null
  /** One sentence: what this agent is for. */
  objective: string | null
  /** 1 assisted … 4 orchestrating. See lib/agents/autonomy.ts. */
  autonomy: number
  /** Capability allow-list. An action without its tool cannot run. */
  tools: string[]
  /** Channels it may speak on: whatsapp | instagram | email. */
  channels: string[]
  /** Actions pinned below the autonomy ceiling — always ask a human. */
  requireApprovalFor: string[]
  /** ISO weekdays: 1 = Monday … 7 = Sunday. */
  workDays: number[]
  workStart: string
  workEnd: string
  timezone: string
  /** Quotas as {metric: target}. */
  goals: Record<string, number>
  status: AgentStatus
  statusDetail: string | null
  statusChangedAt: string
  /** Lifetime provider spend attributed to this agent, in USD. */
  costUsd: number
  /** Free text; the UI offers presets but never constrains it. */
  department: string
  systemPrompt: string
  /** null → inherit `ai_configs.model`. */
  model: string | null
  keywords: string[]
  priority: number
  /** Takes any inbound no keyword matched. At most one per account. */
  isFallback: boolean
  isActive: boolean
  maxRepliesPerConversation: number
  /** Human this agent hands off to; null → the shared queue. */
  handoffAgentId: string | null
  createdAt: string
  updatedAt: string
}

/** How a run ended. `skipped` means the agent declined to act. */
export type AgentRunStatus =
  | 'running'
  | 'replied'
  | 'handoff'
  | 'skipped'
  | 'failed'

/** One recorded handling. Mirrors the `agent_runs` table. */
export interface AgentRun {
  id: string
  agentId: string | null
  agentName: string
  conversationId: string | null
  contactId: string | null
  status: AgentRunStatus
  trigger: string
  matchedKeyword: string | null
  inboundPreview: string | null
  outputPreview: string | null
  reason: string | null
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  durationMs: number | null
  startedAt: string
  finishedAt: string | null
}

/** What the router decided, and why. */
export interface AgentRouteResult {
  agent: Agent
  /** The keyword that won, or null when the fallback agent took it. */
  matchedKeyword: string | null
}

// ============================================================
// The work queue (migration 045).
// ============================================================

export type AgentTaskStatus =
  | 'queued'
  | 'blocked'
  | 'running'
  | 'waiting_approval'
  | 'done'
  | 'failed'
  | 'cancelled'

/** A unit of work that outlives the request that created it. */
export interface AgentTask {
  id: string
  accountId: string
  agentId: string | null
  /** Role to route to when `agentId` is null — "hand off to the SDR". */
  targetRole: string | null
  createdByAgentId: string | null
  kind: string
  title: string
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  contactId: string | null
  dealId: string | null
  conversationId: string | null
  status: AgentTaskStatus
  priority: number
  scheduledFor: string
  dependsOnTaskId: string | null
  attempts: number
  maxAttempts: number
  lastError: string | null
  totalTokens: number
  costUsd: number
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type AgentTaskStepStatus = 'running' | 'done' | 'failed' | 'skipped'

/** One visible step inside a running task. */
export interface AgentTaskStep {
  id: string
  taskId: string
  seq: number
  label: string
  status: AgentTaskStepStatus
  detail: string | null
  startedAt: string
  finishedAt: string | null
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'

/** An action parked for a human to approve, edit or reject. */
export interface AgentApproval {
  id: string
  agentId: string | null
  agentName: string
  taskId: string | null
  contactId: string | null
  kind: string
  summary: string
  payload: Record<string, unknown>
  editedPayload: Record<string, unknown> | null
  status: ApprovalStatus
  decidedBy: string | null
  decidedAt: string | null
  decisionNote: string | null
  expiresAt: string | null
  /** Set the moment the runner took this action for execution. */
  executedAt: string | null
  createdAt: string
}

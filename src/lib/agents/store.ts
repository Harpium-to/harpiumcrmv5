import type { SupabaseClient } from '@supabase/supabase-js'
import type { Agent, AgentRun, AgentRunStatus } from './types'

// ============================================================
// Reading agents and their runs.
//
// Row → domain mapping lives here so the snake_case/camelCase seam is
// crossed exactly once. Works with any client: the RLS-scoped SSR
// client from a dashboard route, or the service-role admin client from
// the inbound webhook (which has no auth.uid() for RLS to match).
// ============================================================

export const AGENT_COLUMNS =
  'id, account_id, name, role, avatar_url, objective, autonomy, tools, channels, require_approval_for, work_days, work_start, work_end, timezone, goals, status, status_detail, status_changed_at, cost_usd, department, system_prompt, model, keywords, priority, is_fallback, is_active, max_replies_per_conversation, handoff_agent_id, created_at, updated_at'

export const AGENT_RUN_COLUMNS =
  'id, agent_id, agent_name_snapshot, conversation_id, contact_id, status, trigger, matched_keyword, inbound_preview, output_preview, reason, prompt_tokens, completion_tokens, total_tokens, duration_ms, started_at, finished_at'

interface AgentRow {
  id: string
  account_id: string
  name: string
  role: string | null
  avatar_url: string | null
  objective: string | null
  autonomy: number | null
  tools: string[] | null
  channels: string[] | null
  require_approval_for: string[] | null
  work_days: number[] | null
  work_start: string | null
  work_end: string | null
  timezone: string | null
  goals: Record<string, number> | null
  status: string | null
  status_detail: string | null
  status_changed_at: string | null
  cost_usd: number | string | null
  department: string
  system_prompt: string
  model: string | null
  keywords: string[] | null
  priority: number
  is_fallback: boolean
  is_active: boolean
  max_replies_per_conversation: number
  handoff_agent_id: string | null
  created_at: string
  updated_at: string
}

export function mapAgentRow(row: AgentRow): Agent {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    // Every field below has a NOT NULL DEFAULT in migration 045, but
    // a client running against a database that has only had 044
    // applied still gets a usable Agent rather than a crash — the
    // operation screens degrade instead of going blank.
    role: row.role ?? 'custom',
    avatarUrl: row.avatar_url ?? null,
    objective: row.objective ?? null,
    autonomy: row.autonomy ?? 1,
    tools: row.tools ?? [],
    channels: row.channels ?? [],
    requireApprovalFor: row.require_approval_for ?? [],
    workDays: row.work_days ?? [1, 2, 3, 4, 5],
    workStart: row.work_start ?? '09:00',
    workEnd: row.work_end ?? '18:00',
    timezone: row.timezone ?? 'America/Sao_Paulo',
    goals: row.goals ?? {},
    status: (row.status ?? 'idle') as Agent['status'],
    statusDetail: row.status_detail ?? null,
    statusChangedAt: row.status_changed_at ?? row.created_at,
    // numeric(12,6) comes back as a string from PostgREST.
    costUsd: Number(row.cost_usd ?? 0),
    department: row.department,
    systemPrompt: row.system_prompt,
    model: row.model,
    // The column is NOT NULL DEFAULT '{}', but PostgREST hands back
    // null for an array column often enough (older rows, partial
    // selects) that defending here is cheaper than a crash in the
    // router's hot path.
    keywords: row.keywords ?? [],
    priority: row.priority,
    isFallback: row.is_fallback,
    isActive: row.is_active,
    maxRepliesPerConversation: row.max_replies_per_conversation,
    handoffAgentId: row.handoff_agent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

interface AgentRunRow {
  id: string
  agent_id: string | null
  agent_name_snapshot: string
  conversation_id: string | null
  contact_id: string | null
  status: string
  trigger: string
  matched_keyword: string | null
  inbound_preview: string | null
  output_preview: string | null
  reason: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  duration_ms: number | null
  started_at: string
  finished_at: string | null
}

export function mapAgentRunRow(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name_snapshot,
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    status: row.status as AgentRunStatus,
    trigger: row.trigger,
    matchedKeyword: row.matched_keyword,
    inboundPreview: row.inbound_preview,
    outputPreview: row.output_preview,
    reason: row.reason,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    durationMs: row.duration_ms,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}

/**
 * Every agent on the account, ordered the way the team screen shows
 * them: highest priority first, then oldest — the same tiebreak the
 * router uses, so the list reads top-down as "who answers first".
 */
export async function loadAgents(
  db: SupabaseClient,
  accountId: string,
): Promise<Agent[]> {
  const { data, error } = await db
    .from('agents')
    .select(AGENT_COLUMNS)
    .eq('account_id', accountId)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []).map((row) => mapAgentRow(row as AgentRow))
}

/**
 * Just the agents that can take a message. Filtered in SQL rather than
 * in `pickAgent` because the inbound webhook runs this on every
 * message and an account may have far more agents off than on.
 */
export async function loadActiveAgents(
  db: SupabaseClient,
  accountId: string,
): Promise<Agent[]> {
  const { data, error } = await db
    .from('agents')
    .select(AGENT_COLUMNS)
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []).map((row) => mapAgentRow(row as AgentRow))
}

/** The newest runs for the live monitor. */
export async function loadAgentRuns(
  db: SupabaseClient,
  accountId: string,
  limit = 50,
): Promise<AgentRun[]> {
  const { data, error } = await db
    .from('agent_runs')
    .select(AGENT_RUN_COLUMNS)
    .eq('account_id', accountId)
    .order('started_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200))

  if (error) throw error
  return (data ?? []).map((row) => mapAgentRunRow(row as AgentRunRow))
}

export interface AgentStats {
  /** Runs that actually produced a reply, today. */
  handledToday: number
  /** Runs that ended in a human handoff, today. */
  handoffToday: number
  /** Runs currently in flight, account-wide. */
  running: number
  /** Per-agent lifetime reply count, keyed by agent id. */
  handledByAgent: Record<string, number>
  /** Per-agent most recent run timestamp, keyed by agent id. */
  lastRunByAgent: Record<string, string>
}

/**
 * The numbers above the team grid.
 *
 * Deliberately one query over a bounded window rather than five
 * aggregate round trips: the monitor re-reads this whenever a run
 * lands over Realtime, so it has to stay cheap. The 500-row cap is
 * what bounds it — an account busy enough to exceed that in a day
 * wants the reporting screen, not this header.
 */
export async function loadAgentStats(
  db: SupabaseClient,
  accountId: string,
): Promise<AgentStats> {
  const since = new Date()
  since.setHours(0, 0, 0, 0)

  const { data, error } = await db
    .from('agent_runs')
    .select('agent_id, status, started_at')
    .eq('account_id', accountId)
    .order('started_at', { ascending: false })
    .limit(500)

  if (error) throw error

  const stats: AgentStats = {
    handledToday: 0,
    handoffToday: 0,
    running: 0,
    handledByAgent: {},
    lastRunByAgent: {},
  }

  const sinceIso = since.toISOString()
  for (const row of (data ?? []) as Array<{
    agent_id: string | null
    status: string
    started_at: string
  }>) {
    const today = row.started_at >= sinceIso
    if (row.status === 'running') stats.running += 1
    if (today && row.status === 'replied') stats.handledToday += 1
    if (today && row.status === 'handoff') stats.handoffToday += 1

    if (row.agent_id) {
      if (row.status === 'replied') {
        stats.handledByAgent[row.agent_id] =
          (stats.handledByAgent[row.agent_id] ?? 0) + 1
      }
      // Rows arrive newest-first, so the first sighting of an agent is
      // already its latest run.
      if (!stats.lastRunByAgent[row.agent_id]) {
        stats.lastRunByAgent[row.agent_id] = row.started_at
      }
    }
  }

  return stats
}

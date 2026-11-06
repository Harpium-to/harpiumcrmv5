import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiUsage } from '@/lib/ai/types'
import type { Agent, AgentRunStatus } from './types'

// ============================================================
// Recording what an agent did.
//
// Two calls bracket the provider round trip: `startAgentRun` writes a
// `running` row before the model is asked anything, `finishAgentRun`
// closes it after. The alternative — one write at the end — loses
// every run that times out or crashes mid-flight, which are exactly
// the ones someone goes looking for. It is also what lets the live
// monitor show an agent as busy while it is thinking, instead of the
// reply appearing from nowhere a few seconds later.
//
// NOTHING HERE THROWS. These run inside the WhatsApp webhook's
// `after()` block; a failed log write must never affect the customer's
// reply or the 200 we owe Meta. Every function swallows its own error
// and leaves a breadcrumb.
// ============================================================

/**
 * How much of a message the feed stores. The monitor answers "which
 * agent took this, and roughly what was said" — the full text already
 * lives in the inbox, and copying it here would duplicate customer
 * content into a second table with a second retention story.
 */
const PREVIEW_LIMIT = 180

export function preview(text: string | null | undefined): string | null {
  if (!text) return null
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (!trimmed) return null
  return trimmed.length > PREVIEW_LIMIT
    ? `${trimmed.slice(0, PREVIEW_LIMIT - 1)}…`
    : trimmed
}

export interface StartRunArgs {
  accountId: string
  agent: Agent
  conversationId: string
  contactId: string | null
  /** The keyword that routed here; null when the fallback agent took it. */
  matchedKeyword: string | null
  /** The customer message being answered. Truncated before storage. */
  inbound: string | null
}

export interface RunHandle {
  /** null when the insert failed — `finishAgentRun` then no-ops. */
  id: string | null
  /** `performance.now()` at start, for the duration measurement. */
  startedAt: number
}

/** Open a run. Returns a handle to close it with. */
export async function startAgentRun(
  db: SupabaseClient,
  args: StartRunArgs,
): Promise<RunHandle> {
  const startedAt = performance.now()
  try {
    const { data, error } = await db
      .from('agent_runs')
      .insert({
        account_id: args.accountId,
        agent_id: args.agent.id,
        agent_name_snapshot: args.agent.name,
        conversation_id: args.conversationId,
        contact_id: args.contactId,
        status: 'running',
        trigger: 'inbound_message',
        matched_keyword: args.matchedKeyword,
        inbound_preview: preview(args.inbound),
      })
      .select('id')
      .single()

    if (error) throw error
    return { id: (data as { id: string }).id, startedAt }
  } catch (err) {
    console.error('[agents] could not open run:', err)
    return { id: null, startedAt }
  }
}

export interface FinishRunArgs {
  status: Exclude<AgentRunStatus, 'running'>
  /** The reply that was sent. Truncated before storage. */
  output?: string | null
  /** For `skipped` / `failed`: which gate stopped it. */
  reason?: string | null
  usage?: AiUsage | null
}

/** Close a run opened by `startAgentRun`. */
export async function finishAgentRun(
  db: SupabaseClient,
  handle: RunHandle,
  args: FinishRunArgs,
): Promise<void> {
  if (!handle.id) return
  try {
    const { error } = await db
      .from('agent_runs')
      .update({
        status: args.status,
        output_preview: preview(args.output),
        reason: args.reason ?? null,
        prompt_tokens: args.usage?.promptTokens ?? null,
        completion_tokens: args.usage?.completionTokens ?? null,
        total_tokens: args.usage?.totalTokens ?? null,
        duration_ms: Math.round(performance.now() - handle.startedAt),
        finished_at: new Date().toISOString(),
      })
      .eq('id', handle.id)
    if (error) throw error
  } catch (err) {
    console.error('[agents] could not close run:', err)
  }
}

/**
 * Record a run that never reached the provider — the agent was routed
 * to, then a gate (a human already owns the thread, the reply cap is
 * spent, a deterministic automation claimed the message) stood it
 * down.
 *
 * Written as a single finished row rather than start-then-finish:
 * there is no in-flight window to represent, and a `running` row that
 * closes microseconds later would flicker in the live feed.
 */
export async function recordSkippedRun(
  db: SupabaseClient,
  args: StartRunArgs & { reason: string },
): Promise<void> {
  await recordInstantRun(db, { ...args, status: 'skipped' })
}

/**
 * Same single-row shape as `recordSkippedRun`, for a decision that is
 * not a stand-down: hitting the reply cap hands the thread to a human
 * (`handoff`) without ever asking the model, and the monitor should
 * count it as a handoff, not as a skip.
 */
export async function recordInstantRun(
  db: SupabaseClient,
  args: StartRunArgs & { status: 'skipped' | 'handoff'; reason: string },
): Promise<void> {
  try {
    const { error } = await db.from('agent_runs').insert({
      account_id: args.accountId,
      agent_id: args.agent.id,
      agent_name_snapshot: args.agent.name,
      conversation_id: args.conversationId,
      contact_id: args.contactId,
      status: args.status,
      trigger: 'inbound_message',
      matched_keyword: args.matchedKeyword,
      inbound_preview: preview(args.inbound),
      reason: args.reason,
      duration_ms: 0,
      finished_at: new Date().toISOString(),
    })
    if (error) throw error
  } catch (err) {
    console.error(`[agents] could not record ${args.status} run:`, err)
  }
}

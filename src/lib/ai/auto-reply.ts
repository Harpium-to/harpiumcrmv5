import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import type { AiConfig } from './types'
import { loadActiveAgents } from '@/lib/agents/store'
import { pickAgent } from '@/lib/agents/routing'
import {
  finishAgentRun,
  recordSkippedRun,
  startAgentRun,
  type StartRunArgs,
} from '@/lib/agents/runtime'
import type { Agent } from '@/lib/agents/types'
import { sendChannelText } from '@/lib/channels/send-text'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * TWO MODES, ONE PATH
 *   Accounts with at least one *active* agent run in agent mode: the
 *   message is routed to an agent, that agent's persona, model, reply
 *   cap and handoff target are used, and every decision — including
 *   the decision not to answer — is written to `agent_runs` for the
 *   live monitor.
 *
 *   Accounts with no active agents keep the original single-assistant
 *   behaviour exactly, gated on `ai_configs.auto_reply_enabled`. That
 *   switch is deliberately NOT consulted in agent mode: an agent's own
 *   `is_active` is its switch, and requiring both would mean a team
 *   that looks enabled on the agents screen but silently never answers.
 *
 * Eligibility gates (any → no reply):
 *   - AI off for the account, or nobody to answer
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config) return

    // The team, if there is one. Loaded before anything else because
    // its emptiness is what decides which mode we're in.
    let agents: Agent[] = []
    try {
      agents = await loadActiveAgents(db, accountId)
    } catch (err) {
      // A missing `agents` table (migration 044 not applied yet) must
      // degrade to the single-assistant path, not take auto-reply down.
      console.error('[ai auto-reply] could not load agents:', err)
    }
    const agentMode = agents.length > 0
    if (!agentMode && !config.autoReplyEnabled) return

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select(
        'assigned_agent_id, ai_autoreply_disabled, ai_reply_count, agent_id',
      )
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return
    const inbound = latestUserMessage(messages)

    // ---- Who answers ----
    //
    // Routing happens before the eligibility gates, not after, so that
    // a message nobody answers still names the agent that *would*
    // have. "Why didn't the sales agent reply to this?" is the whole
    // reason the run log exists, and it is unanswerable if the gates
    // return before anyone is identified.
    let agent: Agent | null = null
    let matchedKeyword: string | null = null

    if (agentMode) {
      // A thread sticks to the agent that already owns it. Re-routing
      // every turn would let "quero comprar" land on sales and the
      // follow-up "quanto custa?" land somewhere else mid-conversation.
      const owner = conv.agent_id
        ? agents.find((a) => a.id === conv.agent_id)
        : undefined

      if (owner) {
        agent = owner
      } else {
        const route = pickAgent(agents, inbound)
        if (!route) return // nobody claims it — leave the thread to a human
        agent = route.agent
        matchedKeyword = route.matchedKeyword
      }
    }

    /** Close out a routed-but-not-answered message in the monitor. */
    const skip = async (reason: string) => {
      if (!agent) return
      const runArgs: StartRunArgs & { reason: string } = {
        accountId,
        agent,
        conversationId,
        contactId,
        matchedKeyword,
        inbound,
        reason,
      }
      await recordSkippedRun(db, runArgs)
    }

    // ---- Eligibility ----

    // Deterministic, user-configured responders win over the LLM — the
    // caller already excludes messages a Flow consumed. Message-level
    // automations (`new_message_received` / `keyword_match`) are
    // dispatched independently for this same inbound and may send their
    // own reply, so if the account has any active one we stand down to
    // avoid double-texting the customer. (Relationship triggers like
    // `first_inbound_message` don't count — they're not per-message
    // auto-responders.)
    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) {
      await skip('automation_owns_message')
      return
    }

    if (conv.assigned_agent_id) {
      await skip('human_assigned') // a human owns this thread
      return
    }
    if (conv.ai_autoreply_disabled) {
      await skip('handed_off') // handed off / turned off here
      return
    }

    // In agent mode the cap is the agent's own — a chatty support bot
    // and a two-reply sales bot are different budgets.
    const maxReplies = agent
      ? agent.maxRepliesPerConversation
      : config.autoReplyMaxPerConversation
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound).
    if (conv.ai_reply_count >= maxReplies) {
      await skip('reply_cap_reached')
      return
    }

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      await skip('rate_limited')
      return
    }

    // ---- Generate ----

    // Open the run before the provider call so the monitor can show the
    // agent as busy while it thinks, and so a call that never returns
    // still leaves a trace.
    const run = agent
      ? await startAgentRun(db, {
          accountId,
          agent,
          conversationId,
          contactId,
          matchedKeyword,
          inbound,
        })
      : null

    try {
      // Ground the reply in the account's knowledge base (best-effort).
      const knowledge = await retrieveKnowledge(db, accountId, config, inbound)

      const systemPrompt = buildSystemPrompt({
        userPrompt: composePrompt(config, agent),
        mode: 'auto_reply',
        knowledge,
      })

      // An agent may run on its own model (a cheap one for the FAQ, a
      // stronger one for sales) while still using the account's key.
      const callConfig: AiConfig =
        agent?.model && agent.model !== config.model
          ? { ...config, model: agent.model }
          : config

      const { text, handoff, usage } = await generateReply({
        config: callConfig,
        systemPrompt,
        messages,
      })

      // Record token spend on the account's BYO key. Fire-and-forget so
      // it never adds latency to the customer-facing send: `logAiUsage`
      // swallows its own errors, so the floating promise can't reject.
      // Logged regardless of handoff — the provider call happened
      // either way.
      void logAiUsage(db, {
        accountId,
        conversationId,
        mode: 'auto_reply',
        provider: callConfig.provider,
        model: callConfig.model,
        usage,
      })

      if (handoff || !text) {
        // The model can't (or shouldn't) answer — stop auto-replying on
        // this thread and hand it to a human. We (a) pause the bot here
        // (sticky until re-enabled), (b) route the conversation to the
        // configured handoff target — null leaves it in the shared
        // queue — and (c) leave a short internal note so whoever picks
        // it up has context. Assigning fires the
        // `on_conversation_assigned` trigger, which notifies the agent.
        const summary = buildHandoffSummary({
          messages,
          replyCount: conv.ai_reply_count ?? 0,
        })
        const update: Record<string, unknown> = {
          ai_autoreply_disabled: true,
          ai_handoff_summary: summary,
        }
        // An agent's own handoff target wins; the account-level one is
        // the default for agents that don't name someone.
        const handoffTarget = agent?.handoffAgentId ?? config.handoffAgentId
        // Only set the assignee when a target is configured AND the
        // thread isn't already owned — never stomp an existing human
        // assignment.
        if (handoffTarget && !conv.assigned_agent_id) {
          update.assigned_agent_id = handoffTarget
        }
        await db.from('conversations').update(update).eq('id', conversationId)
        if (run) {
          await finishAgentRun(db, run, { status: 'handoff', usage })
        }
        return
      }

      // Atomically claim a reply slot: the cap check + increment happen
      // in one UPDATE, so concurrent inbounds can never overshoot the
      // cap. If another inbound just took the last slot, `claimed` is
      // false and we skip the send. (We consume a slot slightly before
      // the send lands — fail-safe: under-reply rather than
      // over-reply.)
      const { data: claimed, error: claimErr } = await db.rpc(
        'claim_ai_reply_slot',
        {
          conversation_id: conversationId,
          max_replies: maxReplies,
        },
      )
      if (claimErr) {
        // A real error here (vs. losing the cap race) is almost always a
        // deploy issue — e.g. `claim_ai_reply_slot` not EXECUTE-able by
        // the service role, or the migration not applied. Log it loudly:
        // a silent return makes "auto-reply never fires" undiagnosable.
        console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
        if (run) {
          await finishAgentRun(db, run, {
            status: 'failed',
            reason: 'claim_slot_failed',
            usage,
          })
        }
        return
      }
      if (claimed !== true) {
        // Lost the per-conversation cap race.
        if (run) {
          await finishAgentRun(db, run, {
            status: 'skipped',
            reason: 'reply_cap_reached',
            usage,
          })
        }
        return
      }

      await sendChannelText({
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        text,
        aiGenerated: true,
      })

      if (agent) {
        // Stamp the thread so the next inbound stays with this agent,
        // and so the inbox can show who is answering. Best-effort: the
        // customer already has their reply, and a failed stamp only
        // costs a re-route next turn.
        await db
          .from('conversations')
          .update({ agent_id: agent.id })
          .eq('id', conversationId)
      }
      if (run) {
        await finishAgentRun(db, run, {
          status: 'replied',
          output: text,
          usage,
        })
      }
    } catch (err) {
      // The provider call (or the send) blew up. Close the run as
      // failed so it doesn't sit in the monitor as perpetually
      // `running`, then rethrow into the outer handler which owns the
      // "never throw" contract.
      if (run) {
        await finishAgentRun(db, run, {
          status: 'failed',
          reason: err instanceof Error ? err.message : 'unknown_error',
        })
      }
      throw err
    }
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}

/**
 * The business context and the agent's role, in that order.
 *
 * They answer different questions — the account prompt says what the
 * company is, the agent prompt says who is speaking — and an agent
 * that loses the account's context would cheerfully invent the
 * business around itself. Labelled so the model reads the second block
 * as its own brief rather than as more facts about the company.
 */
function composePrompt(config: AiConfig, agent: Agent | null): string | null {
  const business = config.systemPrompt?.trim() || null
  if (!agent) return business
  const role = agent.systemPrompt.trim()
  if (!role) return business
  const block = `Your specific role in this conversation:\n${role}`
  return business ? `${business}\n\n${block}` : block
}

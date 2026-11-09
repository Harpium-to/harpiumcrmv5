import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import {
  DEFAULT_HANDOFF_NOTICE,
  buildHandoffSummary,
  type HandoffReason,
} from './handoff'
import { describeReplyFailure } from './reply-failure'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import type { AiConfig, AiUsage } from './types'
import { loadActiveAgents } from '@/lib/agents/store'
import { agentsForChannel, pickAgent } from '@/lib/agents/routing'
import {
  finishAgentRun,
  recordInstantRun,
  recordSkippedRun,
  startAgentRun,
  type RunHandle,
  type StartRunArgs,
} from '@/lib/agents/runtime'
import type { Agent } from '@/lib/agents/types'
import { channelOf, sendChannelText } from '@/lib/channels/send-text'
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
 * TWO MODES, ONE PATH — chosen per channel
 *   A thread whose channel (`conversations.channel`) is covered by at
 *   least one *active* agent runs in agent mode: the message is routed
 *   to one of those agents, its persona, model, reply cap and handoff
 *   target are used, and every decision — including the decision not
 *   to answer — is written to `agent_runs` for the live monitor. An
 *   agent covers the channels ticked on it, and an empty list covers
 *   none (see `speaksOn`).
 *
 *   Every other thread keeps the original single-assistant behaviour
 *   exactly, gated on `ai_configs.auto_reply_enabled` — including an
 *   Instagram DM on an account whose agents are all WhatsApp-only.
 *   That switch is deliberately NOT consulted in agent mode: an
 *   agent's own `is_active` is its switch, and requiring both would
 *   mean a team that looks enabled on the agents screen but silently
 *   never answers.
 *
 * Eligibility gates (any → no reply):
 *   - AI off for the account, or nobody to answer
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached — which is itself a
 *     handoff, not a silent stop: the first message past the cap
 *     pauses the bot and routes the thread to a human with a note
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

    // The whole team, if there is one. Which of it may answer *this*
    // thread depends on the thread's channel, narrowed below.
    let team: Agent[] = []
    try {
      team = await loadActiveAgents(db, accountId)
    } catch (err) {
      // A missing `agents` table (migration 044 not applied yet) must
      // degrade to the single-assistant path, not take auto-reply down.
      console.error('[ai auto-reply] could not load agents:', err)
    }
    // Nobody could answer on any channel — skip the thread reads.
    if (team.length === 0 && !config.autoReplyEnabled) return

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select(
        'assigned_agent_id, ai_autoreply_disabled, ai_reply_count, agent_id',
      )
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return

    // Agent mode is decided per channel: the agents that speak on this
    // thread's channel, and only them, are the team for it. With none,
    // the thread falls back to the single assistant and its switch.
    //
    // The channel is read on its own (`channelOf`) rather than in the
    // select above so a database without migration 047 degrades to
    // WhatsApp instead of failing the whole read.
    const agents =
      team.length > 0
        ? agentsForChannel(team, await channelOf(conversationId, db))
        : []
    const agentMode = agents.length > 0
    if (!agentMode && !config.autoReplyEnabled) return

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
      // `agents` is already narrowed to this channel, so an owner that
      // no longer speaks on it is not found and the thread re-routes.
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

    /**
     * Stop auto-replying on this thread and hand it to a human: (a)
     * pause the bot here (sticky until someone hits "Resume AI"), (b)
     * route the conversation to the handoff target — null leaves it in
     * the shared queue — and (c) leave a short internal note so
     * whoever picks it up has context. Assigning fires the
     * `on_conversation_assigned` trigger, which notifies the agent.
     *
     * The write only lands while the bot is still on
     * (`ai_autoreply_disabled = false`), so two inbounds racing past
     * the cap — or a human hitting "Take over" mid-generation — hand
     * off once, not twice. Returns whether *this* call flipped it.
     */
    const handOff = async (
      reason: HandoffReason,
      replyCount: number,
    ): Promise<boolean> => {
      const update: Record<string, unknown> = {
        ai_autoreply_disabled: true,
        ai_handoff_summary: buildHandoffSummary({
          messages,
          replyCount,
          reason,
        }),
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
      const { data, error } = await db
        .from('conversations')
        .update(update)
        .eq('id', conversationId)
        .eq('ai_autoreply_disabled', false)
        .select('id')
      if (error) {
        console.error('[ai auto-reply] handoff update failed:', error)
        return false
      }
      return Array.isArray(data) && data.length > 0
    }

    /**
     * The reply budget is spent: hand off instead of going quiet.
     *
     * The settings screen promises exactly this ("ao atingir o limite,
     * pausa e direciona a conversa com uma nota"), and the old
     * behaviour — record a skip and return — left the customer
     * unanswered with nobody told. Only the first message past the cap
     * gets here: the handoff sets `ai_autoreply_disabled`, so later
     * ones stop at the `handed_off` gate above.
     *
     * `run` is the open run when the cap was discovered at the atomic
     * claim (after generating); null when the cheap pre-check caught it.
     */
    const handOffAtCap = async (
      replyCount: number,
      run: RunHandle | null,
      usage: AiUsage | null = null,
    ) => {
      const flipped = await handOff('reply_cap', replyCount)
      // Lost the race to another path that already paused the bot (or
      // the write failed): this message is simply over the cap.
      const outcome = flipped
        ? ({ status: 'handoff', reason: 'reply_cap_reached' } as const)
        : ({ status: 'skipped', reason: 'reply_cap_reached' } as const)
      if (run) {
        await finishAgentRun(db, run, { ...outcome, usage })
      } else if (agent) {
        await recordInstantRun(db, {
          accountId,
          agent,
          conversationId,
          contactId,
          matchedKeyword,
          inbound,
          ...outcome,
        })
      }
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
    // below (this read can race a concurrent inbound). Reaching it is a
    // handoff, not a silent skip — see `handOffAtCap`.
    if (conv.ai_reply_count >= maxReplies) {
      await handOffAtCap(conv.ai_reply_count, null)
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
        // this thread and hand it to a human (see `handOff`).
        const flipped = await handOff('model', conv.ai_reply_count ?? 0)
        if (!flipped) {
          // Someone paused the bot while the model was thinking (a
          // human hit "Take over") — it was already handed off, and the
          // human now speaks for the business.
          if (run) {
            await finishAgentRun(db, run, {
              status: 'skipped',
              reason: 'handed_off',
              usage,
            })
          }
          return
        }

        // Tell the customer before going quiet — a silent handoff left
        // them writing to nobody. The model's own words when it wrote
        // any ("o Marcelo monta sua proposta"), a neutral default
        // otherwise. Sent only after the pause landed, so a human who
        // took over mid-generation is never talked over, and not
        // counted against the reply cap: it is the bot's last word on
        // this thread, not another turn.
        const notice = text || DEFAULT_HANDOFF_NOTICE
        try {
          await sendChannelText({
            accountId,
            userId: configOwnerUserId,
            conversationId,
            contactId,
            text: notice,
            aiGenerated: true,
          })
        } catch (err) {
          // The thread is paused either way. Record why the customer
          // got nothing, so the inbox banner can say it and what to fix.
          console.error('[ai auto-reply] handoff notice failed:', err)
          if (run) {
            await finishAgentRun(db, run, {
              status: 'failed',
              reason: describeReplyFailure(err),
              usage,
            })
          }
          return
        }
        if (run) {
          await finishAgentRun(db, run, {
            status: 'handoff',
            output: notice,
            usage,
          })
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
        // Lost the per-conversation cap race: another inbound took the
        // last slot while this one was generating. The budget is spent
        // either way, so this is the same handoff as the pre-check.
        await handOffAtCap(maxReplies, run, usage)
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
      //
      // The reason leads with a stable code (`whatsapp_not_in_allowed_
      // list: (#131030) …`) so the inbox banner can tell the operator,
      // in their language, that the customer got nothing and what to
      // fix — the raw text alone only ever reached the monitor.
      if (run) {
        await finishAgentRun(db, run, {
          status: 'failed',
          reason: describeReplyFailure(err),
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

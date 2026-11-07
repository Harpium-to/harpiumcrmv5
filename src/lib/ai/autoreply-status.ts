import { speaksOn } from '@/lib/agents/routing'

// ============================================================
// Is the AI auto-reply live on this thread — as the inbox sees it?
//
// The inbox banner decides from `GET /api/ai/config`; the dispatcher
// (`dispatchInboundToAiReply`) decides from the database. They must
// agree, or the operator either never sees "Take over" on a thread the
// bot is answering, or sees it on one the bot will never touch. Kept
// pure and next to the dispatcher so a test can hold the two together.
//
// The answer is per thread, not per account, because agent mode is
// decided per channel: an account whose agents are all WhatsApp-only
// answers Instagram DMs with the single assistant, or not at all.
// ============================================================

/** Channel of a thread that predates migration 047 (and its default). */
export const DEFAULT_THREAD_CHANNEL = 'whatsapp'

/** The fields of `GET /api/ai/config` this decision reads. */
export interface AiConfigSnapshot {
  configured?: boolean
  has_key?: boolean
  is_active?: boolean
  auto_reply_enabled?: boolean
  /** Channels covered by at least one active agent, merged. */
  agent_channels?: string[]
}

export interface AutoReplyStatus {
  /** The bot may answer inbound messages on this thread. */
  autoReplyOn: boolean
  /** It answers through agents, logging every decision in `agent_runs`. */
  agentMode: boolean
}

export function autoReplyStatusFromConfig(
  config: AiConfigSnapshot | null | undefined,
  /** `conversations.channel`; absent before migration 047. */
  channel: string | null | undefined,
): AutoReplyStatus {
  // Mirrors `loadAiConfig`: no row, no key or the master switch off
  // means no AI at all.
  const ready = !!(config?.configured && config.has_key && config.is_active)
  // Past that the two modes have different switches. When an active
  // agent speaks on this thread's channel, the agent's own `is_active`
  // is the switch and `auto_reply_enabled` is not read; otherwise that
  // switch is it — the same split `dispatchInboundToAiReply` makes.
  const agentMode =
    ready &&
    speaksOn(config?.agent_channels ?? [], channel || DEFAULT_THREAD_CHANNEL)
  return {
    autoReplyOn: agentMode || (ready && !!config?.auto_reply_enabled),
    agentMode,
  }
}

// ============================================================
// Is the AI auto-reply live on this account — as the inbox sees it?
//
// The inbox banner decides from `GET /api/ai/config`; the dispatcher
// (`dispatchInboundToAiReply`) decides from the database. They must
// agree, or the operator either never sees "Take over" on a thread the
// bot is answering, or sees it on one the bot will never touch. Kept
// pure and next to the dispatcher so a test can hold the two together.
// ============================================================

/** The fields of `GET /api/ai/config` this decision reads. */
export interface AiConfigSnapshot {
  configured?: boolean
  has_key?: boolean
  is_active?: boolean
  auto_reply_enabled?: boolean
  /** At least one active agent on the account. */
  agent_mode?: boolean
}

export interface AutoReplyStatus {
  /** The bot may answer inbound messages on this account. */
  autoReplyOn: boolean
  /** It answers through agents, logging every decision in `agent_runs`. */
  agentMode: boolean
}

export function autoReplyStatusFromConfig(
  config: AiConfigSnapshot | null | undefined,
): AutoReplyStatus {
  // Mirrors `loadAiConfig`: no row, no key or the master switch off
  // means no AI at all.
  const ready = !!(config?.configured && config.has_key && config.is_active)
  // Past that the two modes have different switches. With an active
  // agent the agent's own `is_active` is the switch and
  // `auto_reply_enabled` is not read; without one, that switch is it.
  const agentMode = ready && !!config?.agent_mode
  return {
    autoReplyOn: agentMode || (ready && !!config?.auto_reply_enabled),
    agentMode,
  }
}

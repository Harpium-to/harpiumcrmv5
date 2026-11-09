import type { ChatMessage } from './types'

/** Longest the quoted customer message runs before we ellipsize it —
 *  keeps the internal note to a glanceable one-liner. */
const MAX_QUOTE_LEN = 160

/**
 * What the customer is told when the bot hands off without writing a
 * message of its own (the model answered with the bare marker, or
 * nothing at all). Handing off in silence leaves the customer talking
 * to nobody, so there is always something to send. Promises no time:
 * the hand-off may land outside business hours.
 */
export const DEFAULT_HANDOFF_NOTICE =
  'Vou passar sua conversa para alguém da nossa equipe, que continua o atendimento com você por aqui.'

/**
 * Build the short internal note the auto-reply bot leaves on a
 * conversation when it hands off to a human. Deterministic — composed
 * from context we already have (no extra LLM call / token spend), so it
 * can't fail or add latency to the handoff.
 *
 * Reads as, e.g.:
 *   "🤖 A IA passou a conversa para a equipe depois de 2 respostas.
 *    Última mensagem do cliente: “posso falar com o gerente?”"
 *
 * `replyCount` is the bot's auto-reply tally for the thread (0 when it
 * bailed on the very first inbound without answering).
 *
 * `reason` says why, when it wasn't the model's own call: `reply_cap`
 * → "…depois de 10 respostas (limite da conversa)." The default
 * (`model`) leaves the why out.
 */
export type HandoffReason = 'model' | 'reply_cap'

export function buildHandoffSummary(args: {
  messages: ChatMessage[]
  replyCount: number
  reason?: HandoffReason
}): string {
  const { messages, replyCount, reason = 'model' } = args

  const lastCustomer = [...messages]
    .reverse()
    .find((m) => m.role === 'user' && m.content.trim())

  const replies =
    replyCount === 0
      ? 'sem responder'
      : `depois de ${replyCount} ${replyCount === 1 ? 'resposta' : 'respostas'}`

  const why = reason === 'reply_cap' ? ' (limite da conversa)' : ''

  const base = `🤖 A IA passou a conversa para a equipe ${replies}${why}.`

  if (!lastCustomer) return base

  const quote = truncate(lastCustomer.content.trim(), MAX_QUOTE_LEN)
  return `${base} Última mensagem do cliente: “${quote}”`
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ')
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, max - 1).trimEnd()}…`
}

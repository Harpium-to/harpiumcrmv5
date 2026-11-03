import type { Agent, AgentRouteResult } from './types'

// ============================================================
// Which agent answers this message.
//
// Pure and synchronous: the caller loads the account's agents, this
// decides. Keeping the decision free of I/O is what makes routing
// testable without a database, and it is the part most likely to need
// tuning once real conversations hit it.
// ============================================================

/**
 * Fold a string to its matching form: lower case, accents stripped.
 *
 * Accent stripping is not optional for Portuguese. Operators type
 * keywords the way they think of them ("orçamento", "preço") while
 * customers type them however their keyboard felt that day
 * ("orcamento", "preco"). Comparing the folded forms makes both
 * match, in both directions, with no instruction to the operator.
 */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    // Strip combining marks — the NFD decomposition puts every accent
    // in this range as a separate code point.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** Escape a keyword for safe inclusion in a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Does `text` contain `keyword` as a whole word (or phrase)?
 *
 * Whole-word rather than substring: a keyword like "ar" would
 * otherwise fire on "comprar" and "agendar", and an operator debugging
 * that has no way to see why. Multi-word keywords ("segunda via") work
 * unchanged — the boundaries apply to the ends of the phrase.
 *
 * Each boundary is applied only when that end of the keyword is
 * actually a word character. `\b` asserts a *transition*, so pinning
 * one against punctuation inverts the test: `\bR$\b` demands a word
 * character right after the `$` and so never fires on "R$ 500".
 * Keywords like "R$", "2ª" or "(promo)" are rare but they fail
 * silently, which is the worst way for routing to be wrong.
 */
export function matchesKeyword(text: string, keyword: string): boolean {
  const needle = fold(keyword)
  if (!needle) return false
  // \b and \w are ASCII-only, which is exactly right here: both sides
  // have already been folded to unaccented ASCII by `fold`.
  const open = /^\w/.test(needle) ? '\\b' : ''
  const close = /\w$/.test(needle) ? '\\b' : ''
  const re = new RegExp(`${open}${escapeRegExp(needle)}${close}`)
  return re.test(fold(text))
}

/**
 * Pick the agent that should handle `text`.
 *
 * Order:
 *   1. The highest-priority active agent with a matching keyword.
 *      Ties break on the older agent, so the choice is stable across
 *      deploys and reorderings rather than depending on row order.
 *   2. The account's fallback agent, if it is active.
 *   3. Nobody — the caller leaves the thread to a human.
 *
 * Returns the matched keyword alongside the agent so the run log can
 * record *why* this agent was chosen; the fallback path reports null.
 */
export function pickAgent(
  agents: Agent[],
  text: string,
): AgentRouteResult | null {
  const active = agents.filter((a) => a.isActive)
  if (active.length === 0) return null

  let best: AgentRouteResult | null = null
  let bestAgent: Agent | null = null

  for (const agent of active) {
    const hit = agent.keywords.find((kw) => matchesKeyword(text, kw))
    if (!hit) continue

    if (
      !bestAgent ||
      agent.priority > bestAgent.priority ||
      (agent.priority === bestAgent.priority &&
        agent.createdAt < bestAgent.createdAt)
    ) {
      bestAgent = agent
      best = { agent, matchedKeyword: hit }
    }
  }

  if (best) return best

  const fallback = active.find((a) => a.isFallback)
  return fallback ? { agent: fallback, matchedKeyword: null } : null
}

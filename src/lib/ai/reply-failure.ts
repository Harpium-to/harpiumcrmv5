// ============================================================
// Why an AI auto-reply failed, in terms an operator can act on.
//
// A failed run used to leave only the raw provider text in
// `agent_runs.reason` — "(#131030) Recipient phone number not in
// allowed list" — visible on the agents monitor and nowhere near the
// conversation that went unanswered. This module turns the error into
// a small, stable code the inbox can translate (pt/en via next-intl)
// and pair with what to do next.
//
// Pure and dependency-free on purpose: the server classifies the
// thrown error when the run closes, and the inbox banner (a client
// component) parses the stored reason back. Both sides import this.
// ============================================================

export const REPLY_FAILURE_CODES = [
  /** Meta 131030 — the customer is not on the test app's recipient list. */
  'whatsapp_not_in_allowed_list',
  /** Meta 131047 — more than 24h since the customer last wrote. */
  'whatsapp_window_closed',
  /** Meta 133010 — the business number is not registered on Cloud API. */
  'whatsapp_number_not_registered',
  /** The AI provider rejected the account's API key. */
  'ai_invalid_key',
  /** The AI provider account has no credit / quota left. */
  'ai_no_credit',
  /** Anything else — shown with the raw detail. */
  'unknown',
] as const

export type ReplyFailureCode = (typeof REPLY_FAILURE_CODES)[number]

const KNOWN = new Set<string>(REPLY_FAILURE_CODES)

const META_CODES: Record<number, ReplyFailureCode> = {
  131030: 'whatsapp_not_in_allowed_list',
  131047: 'whatsapp_window_closed',
  133010: 'whatsapp_number_not_registered',
}

/**
 * Prose fallbacks, for errors that lost their structured code (a
 * reason stored as text, a wrapper that re-threw a plain Error). Meta
 * prefixes its messages with "(#<code>)", so the number alone usually
 * matches; the phrases cover the rest.
 */
const WHATSAPP_RULES: Array<[RegExp, ReplyFailureCode]> = [
  [/\b131030\b|not in (the )?allowed list/i, 'whatsapp_not_in_allowed_list'],
  [/\b131047\b|re-?engagement message/i, 'whatsapp_window_closed'],
  [/\b133010\b|account not registered/i, 'whatsapp_number_not_registered'],
]

const AI_RULES: Array<[RegExp, ReplyFailureCode]> = [
  // Before the key rule: OpenAI reports an empty balance as a 429
  // "exceeded your current quota", Anthropic as a 400 "credit balance
  // is too low" — neither is a bad key, and the fix is different.
  [
    /insufficient[_ ]quota|exceeded your (current )?quota|credit balance|billing/i,
    'ai_no_credit',
  ],
  [
    /rejected the api key|invalid[_ ]api[_ ]key|incorrect api key|invalid x-api-key/i,
    'ai_invalid_key',
  ],
]

function firstMatch(
  rules: Array<[RegExp, ReplyFailureCode]>,
  message: string,
): ReplyFailureCode | null {
  for (const [re, code] of rules) {
    if (re.test(message)) return code
  }
  return null
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return String(err)
}

/** Classify a thrown error (or a stored reason string). */
export function classifyReplyFailure(err: unknown): ReplyFailureCode {
  const message = messageOf(err)

  // MetaApiError — branch on Meta's own number when it is there, and
  // never let a Meta error fall through to the AI rules (a Meta text
  // that happens to say "billing" is not an empty AI balance).
  const metaCode =
    err && typeof err === 'object'
      ? (err as { metaCode?: unknown }).metaCode
      : undefined
  if (metaCode !== undefined) {
    if (typeof metaCode === 'number' && META_CODES[metaCode]) {
      return META_CODES[metaCode]
    }
    return firstMatch(WHATSAPP_RULES, message) ?? 'unknown'
  }

  const byText =
    firstMatch(WHATSAPP_RULES, message) ?? firstMatch(AI_RULES, message)
  if (byText) return byText

  // AiError carries a string code. Checked after the text rules so a
  // 429 whose body says "quota" lands on `ai_no_credit`, not on a
  // generic rate limit.
  if (err && typeof err === 'object') {
    const aiCode = (err as { code?: unknown }).code
    if (aiCode === 'invalid_key') return 'ai_invalid_key'
  }

  return 'unknown'
}

/**
 * The `agent_runs.reason` for a failed run: the stable code, then the
 * raw message for whoever is debugging from the monitor.
 *   "whatsapp_not_in_allowed_list: (#131030) Recipient phone number…"
 */
export function describeReplyFailure(err: unknown): string {
  const code = classifyReplyFailure(err)
  const message = messageOf(err).trim() || 'unknown_error'
  return `${code}: ${message}`
}

export interface ParsedReplyFailure {
  code: ReplyFailureCode
  /** The raw provider / Meta text, for the "technical detail" line. */
  detail: string | null
}

/**
 * Read a stored `agent_runs.reason` back. Rows written before the code
 * prefix existed (or by another path, e.g. `claim_slot_failed`) are
 * classified from their text instead.
 */
export function parseReplyFailure(
  reason: string | null | undefined,
): ParsedReplyFailure {
  const raw = (reason ?? '').trim()
  if (!raw) return { code: 'unknown', detail: null }

  const m = /^([a-z_]+):\s*([\s\S]*)$/.exec(raw)
  if (m && KNOWN.has(m[1])) {
    return { code: m[1] as ReplyFailureCode, detail: m[2].trim() || null }
  }
  return { code: classifyReplyFailure(raw), detail: raw }
}

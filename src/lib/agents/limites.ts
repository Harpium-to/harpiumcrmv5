// ============================================================
// The limits an agent working on its own never crosses.
//
// Pure: times in, verdict out. The queries that feed them live next to
// their callers (ferramentas.ts, rondas.ts); keeping the arithmetic here
// makes "would it message her twice today?" a test, not a hope.
// See docs/plano-agentes-ativos.md, Fase 2 and decisions 3 and 4.
// ============================================================

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** Messages an agent may send on its own initiative to one contact. */
export const PROACTIVE_LIMITS = { perDay: 1, perWeek: 3 } as const

export type ProactiveLimit = 'dia' | 'semana'

/**
 * Has this contact already had all the unprompted messages it may get?
 * `sentAt` are the moments of earlier proactive sends (any agent).
 * Rolling windows: "a day" is the last 24 hours, "a week" the last 7
 * days, so a message at 23:59 and another at 00:01 count as the same day.
 */
export function proactiveLimitReached(
  sentAt: string[],
  now: Date,
): ProactiveLimit | null {
  const t = now.getTime()
  const times = sentAt
    .map((s) => new Date(s).getTime())
    .filter((n) => Number.isFinite(n) && n <= t)
  const lastDay = times.filter((n) => t - n < DAY).length
  if (lastDay >= PROACTIVE_LIMITS.perDay) return 'dia'
  const lastWeek = times.filter((n) => t - n < 7 * DAY).length
  if (lastWeek >= PROACTIVE_LIMITS.perWeek) return 'semana'
  return null
}

/**
 * Is the conversation outside the 24-hour customer service window?
 *
 * On the official WhatsApp API (and on Instagram) a business may send
 * free text only within 24 hours of the customer's last message; past
 * that, only an approved template goes through. No message from the
 * customer at all counts as outside.
 */
export function outsideServiceWindow(
  lastCustomerMessageAt: string | null,
  now: Date,
): boolean {
  if (!lastCustomerMessageAt) return true
  const at = new Date(lastCustomerMessageAt).getTime()
  if (!Number.isFinite(at)) return true
  return now.getTime() - at >= DAY
}

/** Tokens spent by an agent's tasks still count for 24 hours. */
export const TOKEN_WINDOW_MS = DAY

export const DEFAULT_DAILY_TOKEN_CAP = 300_000

/** Has the agent used up its day? */
export function tokenCapReached(spent: number, cap: number | null | undefined): boolean {
  const limit = cap && cap > 0 ? cap : DEFAULT_DAILY_TOKEN_CAP
  return spent >= limit
}

// ============================================================
// The 24h customer-service window, as the composer needs it.
//
// It is a rule of Meta's official API: free text (and media) only
// within 24h of the customer's last message; outside it, only an
// approved template. A conversation the team opened ("Nova conversa")
// has no customer message at all, so it starts closed.
//
// The QR-code path (UAZAPI) has no such rule — it sends like a phone —
// so there the window never closes.
// ============================================================

import { differenceInMinutes } from 'date-fns'

export type WindowRule = 'meta' | 'none'

export type SessionWindow =
  | { state: 'open'; minutesLeft: number | null }
  | { state: 'no_customer_message' }
  | { state: 'expired' }

interface MessageLike {
  sender_type: string
  created_at: string
}

export function sessionWindow(
  messages: readonly MessageLike[],
  rule: WindowRule,
  now: Date = new Date(),
): SessionWindow {
  if (rule === 'none') return { state: 'open', minutesLeft: null }

  let last: MessageLike | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].sender_type === 'customer') {
      last = messages[i]
      break
    }
  }
  if (!last) return { state: 'no_customer_message' }

  const minutesLeft = 24 * 60 - differenceInMinutes(now, new Date(last.created_at))
  if (minutesLeft <= 0) return { state: 'expired' }
  return { state: 'open', minutesLeft }
}

/** Only a template can go out. */
export function isWindowClosed(w: SessionWindow): boolean {
  return w.state !== 'open'
}

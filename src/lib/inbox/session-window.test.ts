import { describe, expect, it } from 'vitest'

import { isWindowClosed, sessionWindow } from './session-window'

const NOW = new Date('2026-11-25T12:00:00Z')
const msg = (sender_type: string, hoursAgo: number) => ({
  sender_type,
  created_at: new Date(NOW.getTime() - hoursAgo * 3600_000).toISOString(),
})

describe('sessionWindow', () => {
  it('official API: a conversation the customer never wrote in is closed (template only)', () => {
    expect(sessionWindow([], 'meta', NOW)).toEqual({ state: 'no_customer_message' })
    expect(sessionWindow([msg('agent', 1)], 'meta', NOW)).toEqual({ state: 'no_customer_message' })
    expect(isWindowClosed(sessionWindow([], 'meta', NOW))).toBe(true)
  })

  it('official API: open for 24h after the last customer message', () => {
    const w = sessionWindow([msg('customer', 30), msg('customer', 2), msg('agent', 1)], 'meta', NOW)
    expect(w).toEqual({ state: 'open', minutesLeft: 22 * 60 })
    expect(sessionWindow([msg('customer', 24)], 'meta', NOW)).toEqual({ state: 'expired' })
    expect(sessionWindow([msg('customer', 23.5)], 'meta', NOW)).toEqual({ state: 'open', minutesLeft: 30 })
  })

  it('QR code: the window never closes', () => {
    expect(sessionWindow([], 'none', NOW)).toEqual({ state: 'open', minutesLeft: null })
    expect(sessionWindow([msg('agent', 1)], 'none', NOW).state).toBe('open')
    expect(sessionWindow([msg('customer', 72)], 'none', NOW).state).toBe('open')
  })
})

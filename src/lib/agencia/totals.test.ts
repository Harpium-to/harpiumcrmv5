import { describe, expect, it } from 'vitest'

import { parseAccountTotals, parseMessageStats } from './totals'

describe('parseAccountTotals', () => {
  it('reads the jsonb array, NUMERIC values that arrive as strings included', () => {
    const t = parseAccountTotals([
      { account_id: 'a', contacts: 1501, open_conversations: 3, open_unassigned: 1, open_deals: 2, open_deal_value: '1200.50' },
      { contacts: 9 },
    ])
    expect([...t.keys()]).toEqual(['a'])
    expect(t.get('a')).toEqual({
      contacts: 1501,
      openConversations: 3,
      openUnassigned: 1,
      openDeals: 2,
      openDealValue: 1200.5,
    })
  })

  it('anything but an array is no totals', () => {
    expect(parseAccountTotals(null).size).toBe(0)
  })
})

describe('parseMessageStats', () => {
  it('reads days and CRMs', () => {
    const s = parseMessageStats({
      daily: [{ day: '2026-11-04', incoming: 467, outgoing: 233 }],
      by_account: [{ account_id: 'a', messages: 700, last_at: '2026-11-04T10:00:00Z' }],
    })
    expect(s.daily.get('2026-11-04')).toEqual({ incoming: 467, outgoing: 233 })
    expect(s.byAccount.get('a')).toEqual({ messages: 700, lastAt: '2026-11-04T10:00:00Z' })
  })

  it('an empty result is empty maps, not an error', () => {
    const s = parseMessageStats({ daily: [], by_account: [] })
    expect(s.daily.size + s.byAccount.size).toBe(0)
  })
})

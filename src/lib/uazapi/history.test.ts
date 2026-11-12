import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeDb, type Row } from '@/lib/leads/fake-db.test-helper'

const h = vi.hoisted(() => ({
  chats: [] as Record<string, unknown>[],
  messages: {} as Record<string, Record<string, unknown>[]>,
}))

vi.mock('./api', () => ({
  findUazapiChats: async (_srv: unknown, page: { limit: number; offset: number }) => {
    const chats = h.chats.slice(page.offset, page.offset + page.limit)
    const next = page.offset + chats.length
    return { chats, nextOffset: next < h.chats.length ? next : null }
  },
  findUazapiMessages: async (_srv: unknown, chatid: string) => h.messages[chatid] ?? [],
}))

const { chatFromUazapi, historyRows, importHistoryChat, importHistoryPage } = await import('./history')

const ACC = { id: 'acc-1', ownerUserId: 'owner-1' }
const SRV = { baseUrl: 'https://x.uazapi.com', token: 't' }
const ANA = '5563999990000@s.whatsapp.net'

const msg = (id: string, at: string, over: Record<string, unknown> = {}) => ({
  messageid: id,
  chatid: ANA,
  sender: ANA,
  senderName: 'Ana',
  fromMe: false,
  isGroup: false,
  messageType: 'Conversation',
  text: `texto ${id}`,
  messageTimestamp: Date.parse(at),
  ...over,
})

function world(over: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return { contacts: [], conversations: [], messages: [], ...over }
}

beforeEach(() => {
  h.chats = []
  h.messages = {}
})

describe('chatFromUazapi', () => {
  it('takes 1:1 chats by number, with the LID and the best name', () => {
    expect(
      chatFromUazapi({
        wa_chatid: ANA,
        wa_chatlid: '20066104033409@lid',
        wa_contactName: 'Ana Silva',
        wa_name: 'Ana',
      }),
    ).toEqual({ chatid: ANA, phone: '5563999990000', lid: '20066104033409', name: 'Ana Silva' })
  })

  it('skips groups, Status, channels and LID-only chats', () => {
    expect(chatFromUazapi({ wa_chatid: '123@g.us', wa_isGroup: true })).toBeNull()
    expect(chatFromUazapi({ wa_chatid: 'status@broadcast' })).toBeNull()
    expect(chatFromUazapi({ wa_chatid: '123@newsletter' })).toBeNull()
    expect(chatFromUazapi({ wa_chatid: '20066104033409@lid' })).toBeNull()
  })
})

describe('historyRows', () => {
  it('orders oldest first, keeps both sides, labels media, drops what it cannot place', () => {
    const rows = historyRows([
      msg('m3', '2026-11-10T12:00:00Z', { fromMe: true, sender: '5511000000000@s.whatsapp.net', text: 'Oi Ana' }),
      msg('m2', '2026-11-09T12:00:00Z', { messageType: 'ImageMessage', text: 'olha' }),
      msg('m1', '2026-11-08T12:00:00Z'),
      msg('m1', '2026-11-08T12:00:00Z'), // repeated in the page
      msg('', '2026-11-07T12:00:00Z'), // no id
      msg('m0', 'not-a-date'), // no date
      msg('r1', '2026-11-08T13:00:00Z', { reaction: 'm1', text: '👍' }),
    ])
    expect(rows.map((r) => [r.message_id, r.sender_type, r.content_text, r.created_at])).toEqual([
      ['m1', 'customer', 'texto m1', '2026-11-08T12:00:00.000Z'],
      ['m2', 'customer', '[foto] olha', '2026-11-09T12:00:00.000Z'],
      ['m3', 'agent', 'Oi Ana', '2026-11-10T12:00:00.000Z'],
    ])
  })
})

describe('importHistoryChat', () => {
  it('creates contact and conversation and copies the messages with their dates', async () => {
    h.messages[ANA] = [msg('m2', '2026-11-09T12:00:00Z'), msg('m1', '2026-11-08T12:00:00Z')]
    const t = world()
    const r = await importHistoryChat(fakeDb(t), ACC, SRV, chatFromUazapi({ wa_chatid: ANA, wa_contactName: 'Ana' })!)
    expect(r).toEqual({ imported: 2, contactCreated: true })
    expect(t.contacts[0]).toMatchObject({ phone: '+5563999990000', name: 'Ana' })
    expect(t.messages.map((m) => [m.message_id, m.created_at])).toEqual([
      ['m1', '2026-11-08T12:00:00.000Z'],
      ['m2', '2026-11-09T12:00:00.000Z'],
    ])
    expect(t.conversations[0]).toMatchObject({
      last_message_text: 'texto m2',
      last_message_at: '2026-11-09T12:00:00.000Z',
    })
    // A copy, not news: nothing unread, nothing reopened.
    expect(t.conversations[0].unread_count).toBeUndefined()
  })

  it('skips what the webhook already stored and never moves the preview back', async () => {
    h.messages[ANA] = [msg('new', '2026-11-11T22:41:00Z'), msg('old', '2026-11-01T10:00:00Z')]
    const t = world({
      contacts: [{ id: 'c1', account_id: ACC.id, phone: '+5563999990000', phone_normalized: '5563999990000', name: 'Ana' }],
      conversations: [
        { id: 'cv1', account_id: ACC.id, contact_id: 'c1', last_message_text: 'Oi', last_message_at: '2026-11-11T22:41:00Z', created_at: '2026-11-11T22:41:00Z' },
      ],
      messages: [{ id: 'x', conversation_id: 'cv1', message_id: 'new', content_text: 'Oi' }],
    })
    const r = await importHistoryChat(fakeDb(t), ACC, SRV, chatFromUazapi({ wa_chatid: ANA })!)
    expect(r).toEqual({ imported: 1, contactCreated: false })
    expect(t.messages.map((m) => m.message_id).sort()).toEqual(['new', 'old'])
    expect(t.conversations[0]).toMatchObject({ last_message_text: 'Oi', last_message_at: '2026-11-11T22:41:00Z' })

    // Running again changes nothing.
    const again = await importHistoryChat(fakeDb(t), ACC, SRV, chatFromUazapi({ wa_chatid: ANA })!)
    expect(again.imported).toBe(0)
    expect(t.messages).toHaveLength(2)
  })

  it('fixes a contact saved under its LID instead of creating another', async () => {
    h.messages[ANA] = [msg('m1', '2026-11-08T12:00:00Z')]
    const t = world({
      contacts: [{ id: 'c-lid', account_id: ACC.id, phone: '+20066104033409', phone_normalized: '20066104033409', name: 'Ana' }],
    })
    await importHistoryChat(
      fakeDb(t),
      ACC,
      SRV,
      chatFromUazapi({ wa_chatid: ANA, wa_chatlid: '20066104033409@lid' })!,
    )
    expect(t.contacts).toHaveLength(1)
    expect(t.contacts[0].phone).toBe('+5563999990000')
  })

  it('makes no contact for a chat with nothing to copy', async () => {
    h.messages[ANA] = [msg('r1', '2026-11-08T13:00:00Z', { reaction: 'm1' })]
    const t = world()
    const r = await importHistoryChat(fakeDb(t), ACC, SRV, chatFromUazapi({ wa_chatid: ANA })!)
    expect(r.imported).toBe(0)
    expect(t.contacts).toHaveLength(0)
  })
})

describe('importHistoryPage', () => {
  it('walks the chats a page at a time, skipping groups', async () => {
    const BIA = '5511988887777@s.whatsapp.net'
    h.chats = [
      { wa_chatid: ANA, wa_contactName: 'Ana' },
      { wa_chatid: '123@g.us', wa_isGroup: true },
      { wa_chatid: BIA, wa_contactName: 'Bia' },
    ]
    h.messages[ANA] = [msg('a1', '2026-11-08T12:00:00Z')]
    h.messages[BIA] = [msg('b1', '2026-11-09T12:00:00Z', { chatid: BIA, sender: BIA })]
    const t = world()
    const r = await importHistoryPage(fakeDb(t), ACC, SRV, 0)
    expect(r).toEqual({ chats: 2, imported: 2, contactsCreated: 2, nextOffset: null })
    expect(t.contacts.map((c) => c.name).sort()).toEqual(['Ana', 'Bia'])
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------
// Storing a message that arrived on the QR-code connection (D1): media,
// button taps, redeliveries, and what the engines are told.
// ---------------------------------------------------------------------

const h = vi.hoisted(() => ({
  existingContact: null as { id: string; name: string | null } | null,
}))

vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: async () => h.existingContact,
  isUniqueViolation: () => false,
}))

import { ingestUazapiInbound } from './inbound'
import type { UazapiInboundMessage } from './parse'

interface World {
  conversationExists: boolean
  dupe: boolean
  priorCustomerMessages: number
  unread: number
}

function fakeAdmin(world: World) {
  const inserts: { table: string; row: Record<string, unknown> }[] = []
  const updates: { table: string; row: Record<string, unknown> }[] = []
  const admin = {
    from(table: string) {
      let op: 'select' | 'insert' | 'update' = 'select'
      let head = false
      let wantsUnread = false
      const answer = () => {
        if (table === 'contacts' && op === 'insert') return { data: { id: 'ct-new' }, error: null }
        if (table === 'conversations' && op === 'insert') return { data: { id: 'conv-new' }, error: null }
        if (table === 'conversations' && wantsUnread) return { data: { unread_count: world.unread }, error: null }
        if (table === 'conversations') {
          return { data: world.conversationExists ? [{ id: 'conv-1' }] : [], error: null }
        }
        if (table === 'messages' && head) return { count: world.priorCustomerMessages, error: null }
        if (table === 'messages' && op === 'select') {
          return { data: world.dupe ? [{ id: 'old' }] : [], error: null }
        }
        return { data: null, error: null }
      }
      const b = {
        select: (cols?: string, o?: { head?: boolean }) => {
          head = Boolean(o?.head)
          wantsUnread = cols === 'unread_count'
          return b
        },
        eq: () => b,
        order: () => b,
        limit: async () => answer(),
        insert: (row: Record<string, unknown>) => {
          op = 'insert'
          inserts.push({ table, row })
          return b
        },
        update: (row: Record<string, unknown>) => {
          op = 'update'
          updates.push({ table, row })
          return b
        },
        single: async () => answer(),
        maybeSingle: async () => answer(),
        then: (res: (v: unknown) => unknown) => Promise.resolve(answer()).then(res),
      }
      return b
    },
  }
  return { admin: admin as never, inserts, updates }
}

const ACCOUNT = { id: 'acct-1', ownerUserId: 'owner-1' }
const msg = (over: Partial<UazapiInboundMessage> = {}): UazapiInboundMessage => ({
  counterpartPhone: '5511888888888',
  counterpartLid: null,
  sentAt: null,
  text: 'Oi',
  externalId: 'WA1',
  name: 'Maria',
  fromMe: false,
  mediaKind: null,
  interactiveReplyId: null,
  ...over,
})
const world = (over: Partial<World> = {}): World => ({
  conversationExists: true,
  dupe: false,
  priorCustomerMessages: 3,
  unread: 2,
  ...over,
})
const messageRow = (inserts: { table: string; row: Record<string, unknown> }[]) =>
  inserts.find((i) => i.table === 'messages')?.row

describe('ingestUazapiInbound', () => {
  beforeEach(() => {
    h.existingContact = { id: 'ct-1', name: 'Maria' }
  })

  it('stores a text and counts it as unread', async () => {
    const { admin, inserts, updates } = fakeAdmin(world())
    const r = await ingestUazapiInbound(admin, ACCOUNT, msg())
    expect(r).toEqual({
      contactId: 'ct-1',
      conversationId: 'conv-1',
      contactCreated: false,
      isFirstInbound: false,
      contentType: 'text',
    })
    expect(messageRow(inserts)).toMatchObject({
      sender_type: 'customer',
      content_type: 'text',
      content_text: 'Oi',
      media_url: null,
      message_id: 'WA1',
    })
    expect(updates.at(-1)?.row).toMatchObject({ status: 'open', unread_count: 3, last_message_text: 'Oi' })
  })

  it('keeps a photo at our URL, with its caption', async () => {
    const resolveMedia = vi.fn().mockResolvedValue('https://storage/account-acct-1/x.jpg')
    const { admin, inserts } = fakeAdmin(world())
    const r = await ingestUazapiInbound(
      admin,
      ACCOUNT,
      msg({ mediaKind: 'image', text: 'olha' }),
      { resolveMedia },
    )
    expect(resolveMedia).toHaveBeenCalledWith('WA1')
    expect(r?.contentType).toBe('image')
    expect(messageRow(inserts)).toMatchObject({
      content_type: 'image',
      content_text: 'olha',
      media_url: 'https://storage/account-acct-1/x.jpg',
    })
  })

  it('a file it could not keep still shows up, as text saying what arrived', async () => {
    const { admin, inserts, updates } = fakeAdmin(world())
    await ingestUazapiInbound(admin, ACCOUNT, msg({ mediaKind: 'audio', text: '' }), {
      resolveMedia: async () => null,
    })
    expect(messageRow(inserts)).toMatchObject({
      content_type: 'text',
      content_text: '[áudio]',
      media_url: null,
    })
    expect(updates.at(-1)?.row).toMatchObject({ last_message_text: '[áudio]' })
  })

  it('stores a button tap with the id flows match on', async () => {
    const { admin, inserts } = fakeAdmin(world())
    const r = await ingestUazapiInbound(
      admin,
      ACCOUNT,
      msg({ text: 'Manhã', interactiveReplyId: 'manha' }),
    )
    expect(r?.contentType).toBe('interactive')
    expect(messageRow(inserts)).toMatchObject({
      content_type: 'interactive',
      content_text: 'Manhã',
      interactive_reply_id: 'manha',
    })
  })

  it('a redelivery stores nothing, downloads nothing and tells the engines nothing', async () => {
    const resolveMedia = vi.fn()
    const { admin, inserts } = fakeAdmin(world({ dupe: true }))
    const r = await ingestUazapiInbound(admin, ACCOUNT, msg({ mediaKind: 'image' }), {
      resolveMedia,
    })
    expect(r).toBeNull()
    expect(resolveMedia).not.toHaveBeenCalled()
    expect(messageRow(inserts)).toBeUndefined()
  })

  it('reports a new contact and their first message', async () => {
    h.existingContact = null
    const { admin } = fakeAdmin(world({ conversationExists: false, priorCustomerMessages: 0 }))
    const r = await ingestUazapiInbound(admin, ACCOUNT, msg())
    expect(r).toMatchObject({
      contactId: 'ct-new',
      conversationId: 'conv-new',
      contactCreated: true,
      isFirstInbound: true,
    })
  })

  it('what the operator typed on the phone is the team’s message, not unread', async () => {
    const { admin, inserts, updates } = fakeAdmin(world())
    const r = await ingestUazapiInbound(admin, ACCOUNT, msg({ fromMe: true, name: null }))
    expect(r?.isFirstInbound).toBe(false)
    expect(messageRow(inserts)).toMatchObject({ sender_type: 'agent' })
    expect(updates.at(-1)?.row).not.toHaveProperty('unread_count')
    expect(updates.at(-1)?.row).not.toHaveProperty('status')
  })
})

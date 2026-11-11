import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------
// One outbound message on the unofficial path (D1): what reaches the
// gateway, and what lands in the thread.
// ---------------------------------------------------------------------

const h = vi.hoisted(() => ({
  uazapiCfg: null as Record<string, unknown> | null,
  evolutionCfg: null as Record<string, unknown> | null,
  sendUazapiText: vi.fn(),
  sendUazapiMedia: vi.fn(),
  sendUazapiMenu: vi.fn(),
  sendEvolutionText: vi.fn(),
  adminUpdates: [] as { table: string; row: unknown; filters: Record<string, unknown> }[],
}))

vi.mock('@/lib/uazapi/config', () => ({
  getUazapiConfig: async () => h.uazapiCfg,
  isUazapiReady: (c: Record<string, unknown> | null) =>
    Boolean(c?.enabled && c.base_url && c.instance_token),
}))
vi.mock('@/lib/evolution/config', () => ({
  getEvolutionConfig: async () => h.evolutionCfg,
  isEvolutionReady: (c: Record<string, unknown> | null) => Boolean(c?.enabled),
}))
vi.mock('@/lib/uazapi/api', () => ({
  sendUazapiText: h.sendUazapiText,
  sendUazapiMedia: h.sendUazapiMedia,
  sendUazapiMenu: h.sendUazapiMenu,
}))
vi.mock('@/lib/evolution/api', () => ({ sendEvolutionText: h.sendEvolutionText }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (s: string) => `plain:${s}` }))
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {}
      let row: unknown = null
      const b = {
        update: (r: unknown) => {
          row = r
          return b
        },
        eq: (k: string, v: unknown) => {
          filters[k] = v
          return b
        },
        then: (res: (v: { error: null }) => unknown) => {
          h.adminUpdates.push({ table, row, filters })
          return Promise.resolve({ error: null }).then(res)
        },
      }
      return b
    },
  }),
}))

import { sendUnofficialToConversation, UnofficialSendError } from './unofficial-send'

/** Just enough of a Supabase client for this sender. */
function fakeDb(opts: { parent?: { message_id: string | null } | null } = {}) {
  const inserts: { table: string; row: Record<string, unknown> }[] = []
  const updates: { table: string; row: Record<string, unknown> }[] = []
  const db = {
    from(table: string) {
      let op: 'select' | 'insert' | 'update' = 'select'
      const answer = () => {
        if (op === 'insert') return { data: { id: 'msg-1' }, error: null }
        if (table === 'conversations') {
          return { data: { id: 'conv-1', contact: { id: 'ct-1', phone: '+55 (11) 99999-0000' } }, error: null }
        }
        if (table === 'messages') return { data: opts.parent ?? null, error: null }
        return { data: null, error: null }
      }
      const b = {
        select: () => b,
        eq: () => b,
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
        maybeSingle: async () => answer(),
        single: async () => answer(),
        then: (res: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(res),
      }
      return b
    },
  }
  return { db: db as never, inserts, updates }
}

const BASE = { accountId: 'acct-1', conversationId: 'conv-1' }

describe('sendUnofficialToConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.adminUpdates = []
    h.uazapiCfg = { enabled: true, base_url: 'https://srv.uazapi', instance_token: 'tok' }
    h.evolutionCfg = null
    h.sendUazapiText.mockResolvedValue({ externalId: 'WA1' })
    h.sendUazapiMedia.mockResolvedValue({ externalId: 'WA2' })
    h.sendUazapiMenu.mockResolvedValue({ externalId: 'WA3' })
  })

  it('sends text to the digits of the contact’s phone and records it in the thread', async () => {
    const { db, inserts, updates } = fakeDb()
    const r = await sendUnofficialToConversation(db, {
      ...BASE,
      provider: 'uazapi',
      content: { kind: 'text', text: 'Olá!' },
      senderType: 'agent',
    })
    expect(r).toEqual({ messageId: 'msg-1', externalId: 'WA1' })
    expect(h.sendUazapiText).toHaveBeenCalledWith(
      { baseUrl: 'https://srv.uazapi', token: 'plain:tok' },
      '5511999990000',
      'Olá!',
      { replyId: null },
    )
    expect(inserts[0].row).toMatchObject({
      conversation_id: 'conv-1',
      sender_type: 'agent',
      content_type: 'text',
      content_text: 'Olá!',
      message_id: 'WA1',
      status: 'sent',
    })
    expect(updates[0].row).toMatchObject({ last_message_text: 'Olá!' })
  })

  it('a person answering pauses the bot; the bot answering does not', async () => {
    await sendUnofficialToConversation(fakeDb().db, {
      ...BASE,
      provider: 'uazapi',
      content: { kind: 'text', text: 'oi' },
      senderType: 'agent',
    })
    expect(h.adminUpdates).toEqual([
      expect.objectContaining({
        table: 'flow_runs',
        row: expect.objectContaining({ status: 'paused_by_agent' }),
        filters: { account_id: 'acct-1', contact_id: 'ct-1', status: 'active' },
      }),
    ])

    h.adminUpdates = []
    await sendUnofficialToConversation(fakeDb().db, {
      ...BASE,
      provider: 'uazapi',
      content: { kind: 'text', text: 'oi' },
      senderType: 'bot',
      aiGenerated: true,
    })
    expect(h.adminUpdates).toEqual([])
  })

  it('sends a recorded voice note as media and keeps its URL on the message', async () => {
    const { db, inserts, updates } = fakeDb()
    await sendUnofficialToConversation(db, {
      ...BASE,
      provider: 'uazapi',
      content: { kind: 'media', mediaKind: 'audio', url: 'https://cdn/x.ogg' },
      senderType: 'agent',
    })
    expect(h.sendUazapiMedia).toHaveBeenCalledWith(
      expect.anything(),
      '5511999990000',
      expect.objectContaining({ kind: 'audio', url: 'https://cdn/x.ogg' }),
    )
    expect(inserts[0].row).toMatchObject({
      content_type: 'audio',
      media_url: 'https://cdn/x.ogg',
      content_text: null,
    })
    expect(updates[0].row).toMatchObject({ last_message_text: '[audio]' })
  })

  it('sends buttons as a UAZAPI menu and keeps the payload for the thread', async () => {
    const { db, inserts } = fakeDb()
    const payload = {
      kind: 'buttons' as const,
      body: 'Confirma?',
      buttons: [
        { id: 'sim', title: 'Sim' },
        { id: 'nao', title: 'Não' },
      ],
    }
    await sendUnofficialToConversation(db, {
      ...BASE,
      provider: 'uazapi',
      content: { kind: 'interactive', payload },
      senderType: 'bot',
    })
    expect(h.sendUazapiMenu).toHaveBeenCalledWith(
      expect.anything(),
      '5511999990000',
      { type: 'button', text: 'Confirma?', choices: ['Sim|sim', 'Não|nao'] },
      { replyId: null },
    )
    expect(inserts[0].row).toMatchObject({
      content_type: 'interactive',
      content_text: 'Confirma?',
      interactive_payload: payload,
    })
  })

  it('quotes the WhatsApp id of the message being answered', async () => {
    const { db, inserts } = fakeDb({ parent: { message_id: 'WA-PARENT' } })
    await sendUnofficialToConversation(db, {
      ...BASE,
      provider: 'uazapi',
      content: { kind: 'text', text: 'isso' },
      senderType: 'agent',
      replyToMessageId: 'parent-uuid',
    })
    expect(h.sendUazapiText).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'isso', {
      replyId: 'WA-PARENT',
    })
    expect(inserts[0].row).toMatchObject({ reply_to_message_id: 'parent-uuid' })
  })

  it('refuses to quote a message that is not in this thread', async () => {
    const { db, inserts } = fakeDb({ parent: null })
    await expect(
      sendUnofficialToConversation(db, {
        ...BASE,
        provider: 'uazapi',
        content: { kind: 'text', text: 'x' },
        senderType: 'agent',
        replyToMessageId: 'someone-elses',
      }),
    ).rejects.toMatchObject({ code: 'bad_request', status: 400 })
    expect(h.sendUazapiText).not.toHaveBeenCalled()
    expect(inserts).toEqual([])
  })

  it('refuses when the QR-code connection is not ready, and stores nothing', async () => {
    h.uazapiCfg = { enabled: false, base_url: 'https://srv.uazapi', instance_token: 'tok' }
    const { db, inserts } = fakeDb()
    const err = await sendUnofficialToConversation(db, {
      ...BASE,
      provider: 'uazapi',
      content: { kind: 'text', text: 'x' },
      senderType: 'agent',
    }).catch((e) => e)
    expect(err).toBeInstanceOf(UnofficialSendError)
    expect(err).toMatchObject({ code: 'not_connected' })
    expect(inserts).toEqual([])
  })

  it('Evolution sends text, and says plainly it cannot send media', async () => {
    h.evolutionCfg = { enabled: true, base_url: 'https://evo', api_key: 'k', instance: 'i' }
    h.sendEvolutionText.mockResolvedValue({ externalId: 'EVO1' })
    await sendUnofficialToConversation(fakeDb().db, {
      ...BASE,
      provider: 'evolution',
      content: { kind: 'text', text: 'oi' },
      senderType: 'bot',
    })
    expect(h.sendEvolutionText).toHaveBeenCalledWith(
      { baseUrl: 'https://evo', apiKey: 'plain:k', instance: 'i' },
      '5511999990000',
      'oi',
    )

    await expect(
      sendUnofficialToConversation(fakeDb().db, {
        ...BASE,
        provider: 'evolution',
        content: { kind: 'media', mediaKind: 'image', url: 'https://cdn/a.jpg' },
        senderType: 'agent',
      }),
    ).rejects.toMatchObject({ code: 'unsupported' })
  })
})

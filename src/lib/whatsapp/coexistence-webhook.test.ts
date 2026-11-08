import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  describeMessage,
  handleCoexistenceChange,
  historyStatus,
  isCoexistenceWebhookField,
  isPlaceholderName,
  parseAccountUpdate,
  parseEchoes,
  parseHistory,
  parseStateSync,
  type CoexConfig,
} from './coexistence-webhook'

// ---- a tiny in-memory Supabase ---------------------------------------

type Row = Record<string, unknown>

function memoryDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {}
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }))
  let nextId = 1

  const from = (table: string) => {
    const state = {
      op: 'select' as 'select' | 'insert' | 'update',
      filters: [] as [string, string, unknown][],
      payload: null as Row | Row[] | null,
      limit: Infinity,
      single: false,
    }
    const matches = (r: Row) =>
      state.filters.every(([kind, col, val]) => {
        if (kind === 'eq') return r[col] === val
        if (kind === 'in') return (val as unknown[]).includes(r[col])
        if (kind === 'like') return String(r[col] ?? '').endsWith(String(val).replace(/^%/, ''))
        return true
      })
    const run = () => {
      const rows = (tables[table] ??= [])
      if (state.op === 'insert') {
        const list = Array.isArray(state.payload) ? state.payload : [state.payload as Row]
        const inserted = list.map((r) => ({ id: `${table}-${nextId++}`, ...r }))
        rows.push(...inserted)
        return { data: state.single ? inserted[0] : inserted, error: null }
      }
      if (state.op === 'update') {
        rows.filter(matches).forEach((r) => Object.assign(r, state.payload))
        return { data: null, error: null }
      }
      const found = rows.filter(matches).slice(0, state.limit)
      return state.single ? { data: found[0] ?? null, error: null } : { data: found, error: null }
    }
    const builder = {
      select: () => builder,
      insert: (payload: Row | Row[]) => {
        state.op = 'insert'
        state.payload = payload
        return builder
      },
      update: (payload: Row) => {
        state.op = 'update'
        state.payload = payload
        return builder
      },
      eq: (col: string, val: unknown) => {
        state.filters.push(['eq', col, val])
        return builder
      },
      in: (col: string, val: unknown[]) => {
        state.filters.push(['in', col, val])
        return builder
      },
      like: (col: string, val: string) => {
        state.filters.push(['like', col, val])
        return builder
      },
      order: () => builder,
      limit: (n: number) => {
        state.limit = n
        return builder
      },
      single: () => {
        state.single = true
        return Promise.resolve(run())
      },
      maybeSingle: () => {
        state.single = true
        return Promise.resolve(run())
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    }
    return builder
  }
  return { db: { from } as unknown as SupabaseClient, tables }
}

const CONFIG: CoexConfig = { account_id: 'acc-1', user_id: 'owner-1' }
const BUSINESS = '556333330000'
const CUSTOMER = '5563999990000'

function configRow(extra: Row = {}): Row {
  return { account_id: 'acc-1', phone_number_id: 'PN1', waba_id: 'WABA1', status: 'connected', ...extra }
}

const loadConfig = async (id: string) => (id === 'PN1' ? CONFIG : null)

function change(field: string, value: Row, entryId = 'WABA1') {
  return { field, value: { messaging_product: 'whatsapp', ...value }, entryId }
}

const metadata = { display_phone_number: BUSINESS, phone_number_id: 'PN1' }

// ---- parsing ------------------------------------------------------------

describe('isCoexistenceWebhookField', () => {
  it('takes the four coexistence fields and nothing else', () => {
    for (const f of ['smb_message_echoes', 'history', 'smb_app_state_sync', 'account_update']) {
      expect(isCoexistenceWebhookField(f)).toBe(true)
    }
    expect(isCoexistenceWebhookField('messages')).toBe(false)
    expect(isCoexistenceWebhookField('message_template_status_update')).toBe(false)
  })
})

describe('parseEchoes', () => {
  it('the customer is the recipient; the profile name comes along when sent', () => {
    const echoes = parseEchoes({
      metadata,
      contacts: [{ wa_id: CUSTOMER, profile: { name: 'Ana' } }],
      message_echoes: [
        { from: BUSINESS, to: CUSTOMER, id: 'wamid.1', timestamp: '1762500000', type: 'text', text: { body: 'Oi' } },
        { from: BUSINESS, to: '', id: 'wamid.2', type: 'text' },
      ],
    })
    expect(echoes).toHaveLength(1)
    expect(echoes[0]).toMatchObject({ customerPhone: CUSTOMER, customerName: 'Ana' })
  })
})

describe('parseHistory', () => {
  it('splits who sent what, clamps progress and spots a declined history', () => {
    const [chunk] = parseHistory(
      {
        metadata,
        history: [
          {
            metadata: { phase: 0, chunk_order: 1, progress: 140 },
            threads: [
              {
                id: CUSTOMER,
                messages: [
                  { from: CUSTOMER, id: 'h1', timestamp: '1', type: 'text', text: { body: 'Olá' } },
                  { from: BUSINESS, to: CUSTOMER, id: 'h2', timestamp: '2', type: 'text' },
                  { id: '', from: CUSTOMER },
                ],
              },
            ],
          },
        ],
      },
      BUSINESS,
    )
    expect(chunk.progress).toBe(100)
    expect(chunk.declined).toBe(false)
    expect(chunk.threads[0].messages.map((m) => [m.message.id, m.fromBusiness])).toEqual([
      ['h1', false],
      ['h2', true],
    ])

    const [declined] = parseHistory(
      { history: [{ errors: [{ code: 2593109, title: 'History sync declined' }] }] },
      BUSINESS,
    )
    expect(declined).toMatchObject({ declined: true, error: null, threads: [] })
  })

  it('reports another error with its message', () => {
    const [chunk] = parseHistory({ history: [{ errors: [{ code: 1, message: 'boom' }] }] }, null)
    expect(chunk).toMatchObject({ declined: false, error: 'boom' })
  })
})

describe('parseStateSync', () => {
  it('reads contact adds and removes, with the best name', () => {
    expect(
      parseStateSync({
        state_sync: [
          { type: 'contact', action: 'add', contact: { full_name: 'Ana Souza', first_name: 'Ana', phone_number: '+55 63 99999-0000' } },
          { type: 'contact', action: 'remove', contact: { phone_number: '5563888880000' } },
          { type: 'other', action: 'add', contact: { phone_number: '1' } },
        ],
      }),
    ).toEqual([
      { phone: CUSTOMER, name: 'Ana Souza', action: 'add' },
      { phone: '5563888880000', name: null, action: 'remove' },
    ])
  })
})

describe('parseAccountUpdate', () => {
  it('maps the three connection events and ignores the rest', () => {
    expect(
      parseAccountUpdate('BIZ', { event: 'PARTNER_REMOVED', waba_info: { waba_id: 'WABA1' } }),
    ).toEqual({ wabaId: 'WABA1', status: 'disconnected', reason: 'partner_removed', coexistenceOnly: false })
    expect(parseAccountUpdate('WABA1', { event: 'ACCOUNT_OFFBOARDED' })).toEqual({
      wabaId: 'WABA1',
      status: 'disconnected',
      reason: 'account_offboarded',
      coexistenceOnly: true,
    })
    expect(parseAccountUpdate('WABA1', { event: 'ACCOUNT_RECONNECTED' })).toEqual({
      wabaId: 'WABA1',
      status: 'connected',
      reason: null,
      coexistenceOnly: true,
    })
    expect(parseAccountUpdate('WABA1', { event: 'VERIFIED_ACCOUNT' })).toBeNull()
  })
})

describe('describeMessage and friends', () => {
  it('maps media to the proxy and odd types to a short text', () => {
    expect(describeMessage({ type: 'image', image: { id: 'M1', caption: 'foto' } })).toEqual({
      contentType: 'image',
      contentText: 'foto',
      mediaUrl: '/api/whatsapp/media/M1',
    })
    expect(describeMessage({ type: 'sticker', sticker: { id: 'S1' } }).contentType).toBe('image')
    expect(describeMessage({ type: 'location', location: { latitude: 1, longitude: 2 } }).contentText).toBe('1,2')
    expect(describeMessage({ type: 'poll' })).toEqual({ contentType: 'text', contentText: '[poll]', mediaUrl: null })
  })

  it('history delivery states', () => {
    expect(historyStatus('READ', true)).toBe('read')
    expect(historyStatus('PLAYED', true)).toBe('read')
    expect(historyStatus('DELIVERED', true)).toBe('delivered')
    expect(historyStatus('ERROR', true)).toBe('failed')
    expect(historyStatus(undefined, true)).toBe('sent')
    expect(historyStatus('READ', false)).toBe('delivered')
  })

  it('a placeholder name is empty or the number itself', () => {
    expect(isPlaceholderName(null, CUSTOMER)).toBe(true)
    expect(isPlaceholderName('  ', CUSTOMER)).toBe(true)
    expect(isPlaceholderName(CUSTOMER, CUSTOMER)).toBe(true)
    expect(isPlaceholderName('+55 (63) 99999-0000', CUSTOMER)).toBe(true)
    expect(isPlaceholderName('Ana', CUSTOMER)).toBe(false)
    expect(isPlaceholderName('5511911112222', CUSTOMER)).toBe(false)
  })
})

// ---- handlers -------------------------------------------------------------

describe('smb_message_echoes', () => {
  const echo = (id: string, ts: string, body = 'Pode vir amanhã') =>
    change('smb_message_echoes', {
      metadata,
      contacts: [{ wa_id: CUSTOMER, profile: { name: 'Ana' } }],
      message_echoes: [{ from: BUSINESS, to: CUSTOMER, id, timestamp: ts, type: 'text', text: { body } }],
    })

  it('saves what the business sent from the phone and pauses the AI on that conversation', async () => {
    const { db, tables } = memoryDb({ whatsapp_config: [configRow()] })
    await handleCoexistenceChange(db, echo('wamid.E1', '1762500000'), loadConfig)

    expect(tables.contacts).toHaveLength(1)
    expect(tables.contacts[0]).toMatchObject({ phone: CUSTOMER, name: 'Ana', account_id: 'acc-1', user_id: 'owner-1' })
    expect(tables.messages).toHaveLength(1)
    expect(tables.messages[0]).toMatchObject({
      sender_type: 'agent',
      content_text: 'Pode vir amanhã',
      message_id: 'wamid.E1',
      status: 'sent',
      created_at: new Date(1762500000 * 1000).toISOString(),
    })
    expect(tables.conversations[0]).toMatchObject({
      ai_autoreply_disabled: true,
      unread_count: 0,
      last_message_text: 'Pode vir amanhã',
    })
  })

  it('a repeated delivery is saved once; an existing contact keeps its name', async () => {
    const { db, tables } = memoryDb({
      whatsapp_config: [configRow()],
      contacts: [{ id: 'c1', account_id: 'acc-1', phone: CUSTOMER, name: 'Ana (cliente VIP)' }],
    })
    await handleCoexistenceChange(db, echo('wamid.E1', '1762500000'), loadConfig)
    await handleCoexistenceChange(db, echo('wamid.E1', '1762500000'), loadConfig)
    expect(tables.messages).toHaveLength(1)
    expect(tables.contacts).toHaveLength(1)
    expect(tables.contacts[0].name).toBe('Ana (cliente VIP)')
  })

  it('an older echo does not replace the newer preview', async () => {
    const { db, tables } = memoryDb({ whatsapp_config: [configRow()] })
    await handleCoexistenceChange(db, echo('wamid.new', '1762500000', 'novo'), loadConfig)
    await handleCoexistenceChange(db, echo('wamid.old', '1762400000', 'antigo'), loadConfig)
    expect(tables.messages).toHaveLength(2)
    expect(tables.conversations[0].last_message_text).toBe('novo')
  })

  it('an unknown number writes nothing', async () => {
    const { db, tables } = memoryDb({ whatsapp_config: [configRow()] })
    const other = echo('wamid.X', '1762500000')
    await handleCoexistenceChange(
      db,
      { ...other, value: { ...other.value, metadata: { phone_number_id: 'OTHER' } } },
      loadConfig,
    )
    expect(tables.messages).toBeUndefined()
    expect(tables.contacts).toBeUndefined()
  })
})

describe('history', () => {
  const chunk = (progress: number, ids: [string, 'c' | 'b', number][]) =>
    change('history', {
      metadata,
      history: [
        {
          metadata: { phase: 0, chunk_order: 1, progress },
          threads: [
            {
              id: CUSTOMER,
              messages: ids.map(([id, who, ts]) => ({
                id,
                from: who === 'c' ? CUSTOMER : BUSINESS,
                ...(who === 'b' ? { to: CUSTOMER } : {}),
                timestamp: String(ts),
                type: 'text',
                text: { body: `msg ${id}` },
                history_context: { status: 'READ' },
              })),
            },
          ],
        },
      ],
    })

  it('imports both sides with their times, without duplicates, and records progress', async () => {
    const { db, tables } = memoryDb({
      whatsapp_config: [configRow({ history_sync_status: 'requested', history_sync_progress: 0 })],
    })
    await handleCoexistenceChange(
      db,
      chunk(40, [
        ['h1', 'c', 1700000000],
        ['h2', 'b', 1700000100],
      ]),
      loadConfig,
    )
    // Meta sends the same chunk again, plus a new one.
    await handleCoexistenceChange(
      db,
      chunk(80, [
        ['h2', 'b', 1700000100],
        ['h3', 'c', 1700000200],
      ]),
      loadConfig,
    )

    expect(tables.messages.map((m) => [m.message_id, m.sender_type, m.status])).toEqual([
      ['h1', 'customer', 'delivered'],
      ['h2', 'agent', 'read'],
      ['h3', 'customer', 'delivered'],
    ])
    expect(tables.messages[0].created_at).toBe(new Date(1700000000 * 1000).toISOString())
    expect(tables.conversations).toHaveLength(1)
    expect(tables.conversations[0]).toMatchObject({ last_message_text: 'msg h3' })
    // Old chats never count as unread, and never pause the AI.
    expect(tables.conversations[0].unread_count).toBeUndefined()
    expect(tables.conversations[0].ai_autoreply_disabled).toBeUndefined()
    expect(tables.whatsapp_config[0]).toMatchObject({
      history_sync_status: 'importing',
      history_sync_progress: 80,
    })
  })

  it('progress only moves forward, and 100 means done', async () => {
    const { db, tables } = memoryDb({
      whatsapp_config: [configRow({ history_sync_status: 'importing', history_sync_progress: 80 })],
    })
    await handleCoexistenceChange(db, chunk(60, [['a', 'c', 1]]), loadConfig)
    expect(tables.whatsapp_config[0].history_sync_progress).toBe(80)
    await handleCoexistenceChange(db, chunk(100, [['b', 'c', 2]]), loadConfig)
    expect(tables.whatsapp_config[0]).toMatchObject({
      history_sync_status: 'done',
      history_sync_progress: 100,
    })
    expect(tables.whatsapp_config[0].history_sync_finished_at).toEqual(expect.any(String))
  })

  it('a declined history is recorded as such', async () => {
    const { db, tables } = memoryDb({ whatsapp_config: [configRow({ history_sync_status: 'requested' })] })
    await handleCoexistenceChange(
      db,
      change('history', { metadata, history: [{ errors: [{ code: 2593109, title: 'declined' }] }] }),
      loadConfig,
    )
    expect(tables.whatsapp_config[0].history_sync_status).toBe('declined')
    expect(tables.messages).toBeUndefined()
  })

  it('a newer message already in the CRM keeps the conversation preview', async () => {
    const { db, tables } = memoryDb({
      whatsapp_config: [configRow()],
      contacts: [{ id: 'c1', account_id: 'acc-1', phone: CUSTOMER, name: 'Ana' }],
      conversations: [
        {
          id: 'conv-1',
          account_id: 'acc-1',
          contact_id: 'c1',
          last_message_text: 'recente',
          last_message_at: '2026-11-07T10:00:00.000Z',
        },
      ],
    })
    await handleCoexistenceChange(db, chunk(50, [['old', 'c', 1700000000]]), loadConfig)
    expect(tables.messages[0].conversation_id).toBe('conv-1')
    expect(tables.conversations[0].last_message_text).toBe('recente')
  })
})

describe('smb_app_state_sync', () => {
  it("fills names the CRM doesn't have, keeps the team's names, never deletes", async () => {
    const { db, tables } = memoryDb({
      whatsapp_config: [configRow()],
      contacts: [
        { id: 'c1', account_id: 'acc-1', phone: CUSTOMER, name: CUSTOMER },
        { id: 'c2', account_id: 'acc-1', phone: '5563888880000', name: 'Bruno (fornecedor)' },
      ],
    })
    await handleCoexistenceChange(
      db,
      change('smb_app_state_sync', {
        metadata,
        state_sync: [
          { type: 'contact', action: 'add', contact: { full_name: 'Ana Souza', phone_number: CUSTOMER } },
          { type: 'contact', action: 'add', contact: { full_name: 'Bruno', phone_number: '5563888880000' } },
          { type: 'contact', action: 'add', contact: { full_name: 'Carla', phone_number: '5563777770000' } },
          { type: 'contact', action: 'remove', contact: { phone_number: CUSTOMER } },
        ],
      }),
      loadConfig,
    )
    expect(tables.contacts.map((c) => [c.phone, c.name])).toEqual([
      [CUSTOMER, 'Ana Souza'],
      ['5563888880000', 'Bruno (fornecedor)'],
      ['5563777770000', 'Carla'],
    ])
    expect(tables.whatsapp_config[0].contacts_synced_at).toEqual(expect.any(String))
  })
})

describe('account_update', () => {
  it('marks the connection down with the reason, and back up on reconnect', async () => {
    const { db, tables } = memoryDb({
      whatsapp_config: [configRow(), { ...configRow(), account_id: 'acc-2', waba_id: 'WABA2' }],
    })
    await handleCoexistenceChange(
      db,
      change('account_update', { event: 'PARTNER_REMOVED', waba_info: { waba_id: 'WABA1' } }, 'BIZ1'),
      loadConfig,
    )
    expect(tables.whatsapp_config[0]).toMatchObject({
      status: 'disconnected',
      status_reason: 'partner_removed',
      connected_at: null,
    })
    expect(tables.whatsapp_config[1].status).toBe('connected')

    // Reconnecting is a coexistence event: a plain number stays as Meta left it.
    await handleCoexistenceChange(db, change('account_update', { event: 'ACCOUNT_RECONNECTED' }), loadConfig)
    expect(tables.whatsapp_config[0].status).toBe('disconnected')
    tables.whatsapp_config[0].connection_mode = 'coexistence'
    await handleCoexistenceChange(db, change('account_update', { event: 'ACCOUNT_RECONNECTED' }), loadConfig)
    expect(tables.whatsapp_config[0]).toMatchObject({ status: 'connected', status_reason: null })
  })

  it('leaving coexistence only touches numbers that were in coexistence', async () => {
    const { db, tables } = memoryDb({
      whatsapp_config: [
        configRow({ connection_mode: 'coexistence' }),
        { ...configRow(), account_id: 'acc-2', connection_mode: 'cloud' },
      ],
    })
    await handleCoexistenceChange(db, change('account_update', { event: 'ACCOUNT_OFFBOARDED' }), loadConfig)
    expect(tables.whatsapp_config[0]).toMatchObject({
      status: 'disconnected',
      status_reason: 'account_offboarded',
    })
    expect(tables.whatsapp_config[1].status).toBe('connected')
  })

  it('other account events change nothing', async () => {
    const { db, tables } = memoryDb({ whatsapp_config: [configRow()] })
    await handleCoexistenceChange(db, change('account_update', { event: 'VERIFIED_ACCOUNT' }), loadConfig)
    expect(tables.whatsapp_config[0]).toEqual(configRow())
  })
})

import { describe, expect, it } from 'vitest'

import { memoryDb } from '@/lib/testing/memory-supabase'
import { ingestUazapiInbound } from './inbound'
import type { UazapiInboundMessage } from './parse'

const ACC = 'acc-1'
const account = { id: ACC, ownerUserId: 'owner-1' }

function setup() {
  return memoryDb({
    seed: {
      accounts: [{ id: ACC, default_currency: 'BRL' }],
      pipelines: [{ id: 'p1', account_id: ACC, name: 'Vendas' }],
      pipeline_stages: [{ id: 's-first', pipeline_id: 'p1', name: 'Primeiro contato', position: 0 }],
    },
  })
}

const msg = (over: Partial<UazapiInboundMessage> = {}): UazapiInboundMessage => ({
  counterpartPhone: '5511999990000',
  counterpartLid: null,
  text: 'Bom dia!',
  externalId: 'wa-1',
  name: 'Ana',
  fromMe: false,
  mediaKind: null,
  interactiveReplyId: null,
  sentAt: null,
  ...over,
})

describe('ingestUazapiInbound → first-contact deal', () => {
  it('a new number writing puts the contact in the funnel', async () => {
    const db = setup()

    await ingestUazapiInbound(db.client, account, msg())

    expect(db.rows('deals')).toHaveLength(1)
    expect(db.rows('deals')[0]).toMatchObject({
      stage_id: 's-first',
      conversation_id: db.rows('conversations')[0].id,
      title: 'Ana',
    })
  })

  it('two messages arriving together from a new number make one deal', async () => {
    const db = setup()

    await Promise.all([
      ingestUazapiInbound(db.client, account, msg({ externalId: 'a' })),
      ingestUazapiInbound(db.client, account, msg({ externalId: 'b' })),
    ])

    expect(db.rows('conversations')).toHaveLength(1)
    expect(db.rows('deals')).toHaveLength(1)
  })

  it('the operator writing first from the phone opens no deal, nor does the reply', async () => {
    const db = setup()

    await ingestUazapiInbound(db.client, account, msg({ fromMe: true, externalId: 'out', name: null }))
    await ingestUazapiInbound(db.client, account, msg({ externalId: 'in' }))

    expect(db.rows('messages')).toHaveLength(2)
    expect(db.rows('deals')).toHaveLength(0)
  })

  it('a redelivered message adds no deal', async () => {
    const db = setup()

    await ingestUazapiInbound(db.client, account, msg())
    await ingestUazapiInbound(db.client, account, msg())

    expect(db.rows('messages')).toHaveLength(1)
    expect(db.rows('deals')).toHaveLength(1)
  })
})

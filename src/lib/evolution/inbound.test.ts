import { describe, expect, it } from 'vitest'

import { memoryDb, type Row } from '@/lib/testing/memory-supabase'
import { ingestEvolutionInbound } from './inbound'
import type { EvolutionInboundMessage } from './parse'

const ACC = 'acc-1'
const account = { id: ACC, ownerUserId: 'owner-1' }

const funnel = {
  accounts: [{ id: ACC, default_currency: 'BRL' }],
  pipelines: [{ id: 'p1', account_id: ACC, name: 'Vendas' }],
  pipeline_stages: [{ id: 's-first', pipeline_id: 'p1', name: 'Primeiro contato', position: 0 }],
}

function setup(extra: Record<string, Row[]> = {}) {
  return memoryDb({ seed: { ...funnel, ...extra } })
}

const msg = (over: Partial<EvolutionInboundMessage> = {}): EvolutionInboundMessage => ({
  fromPhone: '5511999990000',
  text: 'Oi, quero saber o preço',
  externalId: 'wamid-1',
  name: 'João',
  ...over,
})

describe('ingestEvolutionInbound → first-contact deal', () => {
  it('a new number writing puts the contact in the funnel at the first stage', async () => {
    const db = setup()

    await ingestEvolutionInbound(db.client, account, msg())

    expect(db.rows('deals')).toHaveLength(1)
    expect(db.rows('deals')[0]).toMatchObject({
      pipeline_id: 'p1',
      stage_id: 's-first',
      contact_id: db.rows('contacts')[0].id,
      conversation_id: db.rows('conversations')[0].id,
      title: 'João',
      status: 'open',
    })
  })

  it('two messages arriving together from a new number make one deal', async () => {
    const db = setup()

    await Promise.all([
      ingestEvolutionInbound(db.client, account, msg({ externalId: 'a' })),
      ingestEvolutionInbound(db.client, account, msg({ externalId: 'b' })),
    ])

    expect(db.rows('conversations')).toHaveLength(1)
    expect(db.rows('deals')).toHaveLength(1)
    expect(db.rows('messages')).toHaveLength(2)
  })

  it('later messages from the same person add no deal', async () => {
    const db = setup()

    await ingestEvolutionInbound(db.client, account, msg({ externalId: 'a' }))
    await ingestEvolutionInbound(db.client, account, msg({ externalId: 'b' }))

    expect(db.rows('deals')).toHaveLength(1)
  })

  it('a contact whose conversation already exists (team wrote first) gets no deal', async () => {
    const db = setup({
      contacts: [{ id: 'c1', account_id: ACC, name: 'João', phone: '+5511999990000' }],
      conversations: [{ id: 'conv1', account_id: ACC, contact_id: 'c1' }],
    })

    await ingestEvolutionInbound(db.client, account, msg())

    expect(db.rows('deals')).toHaveLength(0)
  })

  it('an imported contact writing for the first time is a first contact too', async () => {
    const db = setup({
      contacts: [{ id: 'c1', account_id: ACC, name: 'João da planilha', phone: '+5511999990000' }],
    })

    await ingestEvolutionInbound(db.client, account, msg())

    expect(db.rows('deals')).toHaveLength(1)
    expect(db.rows('deals')[0]).toMatchObject({ contact_id: 'c1', title: 'João da planilha' })
  })
})

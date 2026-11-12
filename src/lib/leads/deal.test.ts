import { describe, expect, it } from 'vitest'

import { DEFAULT_PIPELINE_NAME } from '@/lib/deals/default-pipeline'
import { leadOriginLabel } from './deal'
import { fakeDb, type Row } from './fake-db.test-helper'
import { ingestLead, reprocessLead } from './ingest'
import { normalizeLead } from './parse'

const ACC = { id: 'acc-1', ownerUserId: 'owner-1' }

const quiz = (over: Record<string, unknown> = {}) => ({
  versao: '1',
  origem: 'quiz-planejados',
  id_externo: 'sessao-7f3c',
  contato: { nome: 'Ana', telefone: '+5563999990000' },
  ...over,
})

/** An account with one funnel ("Vendas": Primeiro contato → Proposta). */
function world(over: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    accounts: [{ id: ACC.id, default_currency: 'BRL' }],
    contacts: [],
    leads: [],
    tags: [],
    contact_tags: [],
    custom_fields: [],
    contact_custom_values: [],
    contact_notes: [],
    conversations: [],
    pipelines: [{ id: 'p1', account_id: ACC.id, name: 'Vendas', created_at: '2026-01-01T00:00:00Z' }],
    pipeline_stages: [
      { id: 's-first', pipeline_id: 'p1', name: 'Primeiro contato', position: 0 },
      { id: 's-second', pipeline_id: 'p1', name: 'Proposta', position: 1 },
    ],
    deals: [],
    ...over,
  }
}

async function receive(t: Record<string, Row[]>, raw: Record<string, unknown>) {
  return ingestLead(fakeDb(t), ACC, normalizeLead(raw), raw)
}

describe('a received lead lands in the funnel', () => {
  it('a new lead becomes a card in the first stage of the first funnel', async () => {
    const t = world()
    const r = await receive(t, quiz())

    expect(t.deals).toHaveLength(1)
    expect(t.deals[0]).toMatchObject({
      account_id: ACC.id,
      user_id: ACC.ownerUserId,
      pipeline_id: 'p1',
      stage_id: 's-first',
      contact_id: r.contactId,
      conversation_id: null,
      title: 'Lead quiz-planejados · Ana',
      value: 0,
      currency: 'BRL',
      status: 'open',
    })
  })

  it('names where the lead came from: Meta, Google or the form', async () => {
    const meta = world()
    await receive(meta, quiz({ origem: 'meta' }))
    expect(meta.deals[0].title).toBe('Lead Meta · Ana')

    const google = world()
    await receive(google, quiz({ origem: 'google' }))
    expect(google.deals[0].title).toBe('Lead Google · Ana')
  })

  it('a lead with no name is titled with the phone', async () => {
    const t = world()
    await receive(t, quiz({ contato: { telefone: '+5563999990000' } }))
    expect(t.deals[0].title).toBe('Lead quiz-planejados · +5563999990000')
  })

  it('a second lead from the same person adds no second card', async () => {
    const t = world()
    await receive(t, quiz())
    await receive(t, quiz({ id_externo: 'sessao-outra', origem: 'meta' }))

    expect(t.leads).toHaveLength(2)
    expect(t.deals).toHaveLength(1)
  })

  it('a repeated delivery adds no second card', async () => {
    const t = world()
    await receive(t, quiz())
    await receive(t, quiz())

    expect(t.leads).toHaveLength(1)
    expect(t.deals).toHaveLength(1)
  })

  it('a contact already in the funnel (from WhatsApp, say) keeps the card it has', async () => {
    const t = world({
      contacts: [{ id: 'c1', account_id: ACC.id, phone: '+5563999990000', phone_normalized: '5563999990000', name: 'Ana' }],
      conversations: [{ id: 'conv-1', account_id: ACC.id, contact_id: 'c1' }],
      deals: [{ id: 'd1', account_id: ACC.id, contact_id: 'c1', pipeline_id: 'p1', stage_id: 's-second', status: 'open' }],
    })
    await receive(t, quiz())

    expect(t.deals).toHaveLength(1)
    expect(t.deals[0]).toMatchObject({ id: 'd1', stage_id: 's-second' })
  })

  it('a contact whose last deal was closed gets a new card', async () => {
    const t = world({
      contacts: [{ id: 'c1', account_id: ACC.id, phone: '+5563999990000', phone_normalized: '5563999990000', name: 'Ana' }],
      deals: [{ id: 'd-old', account_id: ACC.id, contact_id: 'c1', pipeline_id: 'p1', stage_id: 's-second', status: 'lost' }],
    })
    await receive(t, quiz())

    expect(t.deals).toHaveLength(2)
    expect(t.deals[1]).toMatchObject({ contact_id: 'c1', stage_id: 's-first', status: 'open' })
  })

  it('the card opens the conversation when the contact has already written', async () => {
    const t = world({
      contacts: [{ id: 'c1', account_id: ACC.id, phone: '+5563999990000', phone_normalized: '5563999990000', name: 'Ana' }],
      conversations: [{ id: 'conv-1', account_id: ACC.id, contact_id: 'c1' }],
    })
    await receive(t, quiz())

    expect(t.deals[0]).toMatchObject({ contact_id: 'c1', conversation_id: 'conv-1' })
  })

  it('an account with no funnel yet gets the default one', async () => {
    const t = world({ pipelines: [], pipeline_stages: [] })
    await receive(t, quiz())

    expect(t.pipelines).toHaveLength(1)
    expect(t.pipelines[0]).toMatchObject({ account_id: ACC.id, name: DEFAULT_PIPELINE_NAME })
    const first = t.pipeline_stages.find((s) => s.position === 0)
    expect(t.deals[0]).toMatchObject({ pipeline_id: t.pipelines[0].id, stage_id: first?.id })
  })

  it('a lead with no phone and no e-mail has no contact, so no card', async () => {
    const t = world()
    await receive(t, { nome: 'Sem contato', origem: 'site' })

    expect(t.leads).toHaveLength(1)
    expect(t.deals).toHaveLength(0)
  })

  it('reprocessing a lead that only now finds its contact puts it in the funnel', async () => {
    const raw = quiz()
    const t = world({
      leads: [{ id: 'old-1', account_id: ACC.id, source: 'other', raw, contact_id: null, created_at: '2026-11-10T12:00:00Z' }],
    })
    const db = fakeDb(t)
    const stored = { id: 'old-1', raw, contact_id: null, created_at: '2026-11-10T12:00:00Z' }
    const r = await reprocessLead(db, ACC, stored)

    expect(t.deals).toHaveLength(1)
    expect(t.deals[0]).toMatchObject({ contact_id: r.contactId, stage_id: 's-first' })

    // Reprocessed again, now with its contact: nothing new.
    await reprocessLead(db, ACC, { ...stored, contact_id: r.contactId })
    expect(t.deals).toHaveLength(1)
  })
})

describe('leadOriginLabel', () => {
  it('reads the origin the way the team calls it', () => {
    expect(leadOriginLabel({ source: 'meta', origin: 'meta' })).toBe('Meta')
    expect(leadOriginLabel({ source: 'google', origin: null })).toBe('Google')
    expect(leadOriginLabel({ source: 'quiz-planejados', origin: 'Quiz Planejados' })).toBe('Quiz Planejados')
    expect(leadOriginLabel({ source: 'site', origin: null })).toBe('site')
    expect(leadOriginLabel({ source: 'other', origin: null })).toBe('formulário')
  })
})

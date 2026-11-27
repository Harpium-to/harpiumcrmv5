import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ deal: [] as unknown[], event: [] as unknown[] }))
vi.mock('@/lib/leads/deal', () => ({
  openLeadDeal: vi.fn(async (...args: unknown[]) => {
    calls.deal.push(args)
    return 'created'
  }),
}))
vi.mock('@/lib/leads/events', () => ({
  dispatchLeadReceived: vi.fn(async (...args: unknown[]) => {
    calls.event.push(args)
  }),
}))

import { fakeDb, type Row } from '@/lib/leads/fake-db.test-helper'

import { handleProspectReply } from './prospect-reply'

const ACC = { id: 'acc-1', ownerUserId: 'owner-1' }

function world(mode = 'prospeccao'): Record<string, Row[]> {
  return {
    contacts: [{ id: 'c-1', account_id: ACC.id, phone: '+5562999990001', opted_out_at: null }],
    bulk_sends: [{ id: 'b-1', account_id: ACC.id, mode }],
    scheduled_messages: [
      { id: 's-1', account_id: ACC.id, contact_id: 'c-1', bulk_send_id: 'b-1', status: 'sent', replied_at: null },
      { id: 's-2', account_id: ACC.id, contact_id: 'c-1', bulk_send_id: 'b-1', status: 'scheduled', replied_at: null },
    ],
    leads: [
      {
        id: 'lead-1',
        account_id: ACC.id,
        contact_id: 'c-1',
        source: 'extrator-cnpj',
        created_at: '2026-11-17T12:00:00Z',
        raw: { versao: '1', origem: 'Extrator · CNPJ', contato: { nome: 'Clínica', telefone: '+5562999990001' } },
      },
    ],
    tags: [],
    contact_tags: [],
  }
}

beforeEach(() => {
  calls.deal = []
  calls.event = []
})

describe('handleProspectReply', () => {
  it('a reply opens the card, tags "respondeu" and fires "lead recebido" — once', async () => {
    const t = world()
    expect(await handleProspectReply(fakeDb(t), ACC, 'c-1', 'Oi, quero saber mais')).toBe('replied')
    expect(t.scheduled_messages[0].replied_at).toBeTruthy()
    expect(t.tags.map((x) => x.name)).toEqual(['respondeu'])
    expect(calls.deal).toHaveLength(1)
    expect(calls.deal[0]).toMatchObject([expect.anything(), ACC, 'c-1', { source: 'extrator-cnpj', origin: 'Extrator · CNPJ' }])
    expect(calls.event).toHaveLength(1)
    expect(await handleProspectReply(fakeDb(t), ACC, 'c-1', 'e o preço?')).toBe('already_replied')
    expect(calls.deal).toHaveLength(1)
  })

  it('SAIR marks the contact and cancels what was still waiting', async () => {
    const t = world()
    expect(await handleProspectReply(fakeDb(t), ACC, 'c-1', 'SAIR')).toBe('opted_out')
    expect(t.contacts[0].opted_out_at).toBeTruthy()
    expect(t.scheduled_messages[1].status).toBe('cancelled')
    expect(calls.deal).toHaveLength(0)
  })

  it('does nothing for an ordinary send, or a contact never prospected', async () => {
    expect(await handleProspectReply(fakeDb(world('normal')), ACC, 'c-1', 'SAIR')).toBe('not_prospect')
    expect(await handleProspectReply(fakeDb(world()), ACC, 'c-2', 'oi')).toBe('not_prospect')
  })
})

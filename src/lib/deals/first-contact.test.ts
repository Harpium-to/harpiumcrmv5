import { describe, expect, it, vi } from 'vitest'

import { memoryDb, type Row } from '@/lib/testing/memory-supabase'
import { DEFAULT_PIPELINE_NAME, DEFAULT_PIPELINE_STAGES } from './default-pipeline'
import { openFirstContactDeal } from './first-contact'

const ACC = 'acc-1'
const OTHER = 'acc-2'
const OWNER = 'owner-1'

const input = {
  accountId: ACC,
  ownerUserId: OWNER,
  contactId: 'c1',
  conversationId: 'conv1',
}

function setup(seed: Record<string, Row[]> = {}, failures: string[] = []) {
  return memoryDb({
    failures,
    seed: {
      accounts: [{ id: ACC, default_currency: 'BRL' }],
      contacts: [{ id: 'c1', account_id: ACC, name: 'Maria Souza', phone: '+5511999990000' }],
      conversations: [{ id: 'conv1', account_id: ACC, contact_id: 'c1' }],
      ...seed,
    },
  })
}

/** Two funnels; the older one ("Vendas") is the target. Stages are
 *  seeded out of order to prove the lowest position wins. */
const twoFunnels = {
  pipelines: [
    { id: 'p-vendas', account_id: ACC, name: 'Vendas' },
    { id: 'p-pos', account_id: ACC, name: 'Pós-venda' },
  ],
  pipeline_stages: [
    { id: 's-proposta', pipeline_id: 'p-vendas', name: 'Proposta', position: 1 },
    { id: 's-primeiro', pipeline_id: 'p-vendas', name: 'Primeiro contato', position: 0 },
    { id: 's-pos', pipeline_id: 'p-pos', name: 'Onboarding', position: 0 },
  ],
}

describe('openFirstContactDeal', () => {
  it('puts the contact in the oldest funnel, at its first stage', async () => {
    const db = setup(twoFunnels)

    await expect(openFirstContactDeal(db.client, input)).resolves.toBe('created')

    expect(db.rows('deals')).toHaveLength(1)
    expect(db.rows('deals')[0]).toMatchObject({
      account_id: ACC,
      user_id: OWNER,
      pipeline_id: 'p-vendas',
      stage_id: 's-primeiro',
      contact_id: 'c1',
      conversation_id: 'conv1',
      title: 'Maria Souza',
      value: 0,
      currency: 'BRL',
      status: 'open',
    })
  })

  it('does nothing when the contact already has an open deal, in any funnel', async () => {
    const db = setup({
      ...twoFunnels,
      deals: [
        { account_id: ACC, contact_id: 'c1', pipeline_id: 'p-pos', stage_id: 's-pos', status: 'open', title: 'x' },
      ],
    })

    await expect(openFirstContactDeal(db.client, input)).resolves.toBe('has_open_deal')
    expect(db.rows('deals')).toHaveLength(1)
  })

  it('still opens one when the contact only has won or lost deals', async () => {
    const db = setup({
      ...twoFunnels,
      deals: [
        { account_id: ACC, contact_id: 'c1', pipeline_id: 'p-vendas', stage_id: 's-proposta', status: 'won', title: 'a' },
        { account_id: ACC, contact_id: 'c1', pipeline_id: 'p-vendas', stage_id: 's-proposta', status: 'lost', title: 'b' },
      ],
    })

    await expect(openFirstContactDeal(db.client, input)).resolves.toBe('created')
    expect(db.rows('deals').filter((d) => d.status === 'open')).toHaveLength(1)
  })

  it('creates the default funnel when the account has none, and uses its first stage', async () => {
    const db = setup()

    await expect(openFirstContactDeal(db.client, input)).resolves.toBe('created')

    const pipelines = db.rows('pipelines')
    expect(pipelines).toHaveLength(1)
    expect(pipelines[0]).toMatchObject({ account_id: ACC, user_id: OWNER, name: DEFAULT_PIPELINE_NAME })

    const stages = db.rows('pipeline_stages')
    expect(stages.map((s) => s.name)).toEqual(DEFAULT_PIPELINE_STAGES.map((s) => s.name))

    const firstStage = stages.find((s) => s.position === 0)!
    expect(firstStage.name).toBe('Novo lead')
    expect(db.rows('deals')[0]).toMatchObject({
      pipeline_id: pipelines[0].id,
      stage_id: firstStage.id,
    })
  })

  it("ignores other accounts' funnels", async () => {
    const db = setup({
      pipelines: [{ id: 'p-foreign', account_id: OTHER, name: 'Deles' }],
      pipeline_stages: [{ id: 's-foreign', pipeline_id: 'p-foreign', name: 'X', position: 0 }],
    })

    await openFirstContactDeal(db.client, input)

    expect(db.rows('deals')[0].pipeline_id).not.toBe('p-foreign')
    expect(db.rows('pipelines').filter((p) => p.account_id === ACC)).toHaveLength(1)
  })

  it('skips an oldest funnel that has no stages', async () => {
    const db = setup({
      pipelines: [
        { id: 'p-vazio', account_id: ACC, name: 'Vazio' },
        { id: 'p-vendas', account_id: ACC, name: 'Vendas' },
      ],
      pipeline_stages: [{ id: 's-1', pipeline_id: 'p-vendas', name: 'Novo', position: 0 }],
    })

    await openFirstContactDeal(db.client, input)

    expect(db.rows('deals')[0]).toMatchObject({ pipeline_id: 'p-vendas', stage_id: 's-1' })
  })

  it('leaves alone an account whose funnels have no stages at all', async () => {
    const db = setup({ pipelines: [{ id: 'p-vazio', account_id: ACC, name: 'Vazio' }] })

    await expect(openFirstContactDeal(db.client, input)).resolves.toBe('no_stage')
    expect(db.rows('deals')).toHaveLength(0)
    // No second funnel seeded behind the account's back.
    expect(db.rows('pipelines')).toHaveLength(1)
  })

  it("refuses a contact from another account", async () => {
    const db = setup({
      ...twoFunnels,
      contacts: [{ id: 'c1', account_id: OTHER, name: 'Outro', phone: '+5511888880000' }],
    })

    await expect(openFirstContactDeal(db.client, input)).resolves.toBe('contact_not_found')
    expect(db.rows('deals')).toHaveLength(0)
  })

  it('titles the card with the phone when the contact has no name, or with the given title', async () => {
    const noName = setup({
      ...twoFunnels,
      contacts: [{ id: 'c1', account_id: ACC, name: '', phone: '+5511999990000' }],
    })
    await openFirstContactDeal(noName.client, input)
    expect(noName.rows('deals')[0].title).toBe('+5511999990000')

    const titled = setup(twoFunnels)
    await openFirstContactDeal(titled.client, { ...input, title: 'Contato do Instagram' })
    expect(titled.rows('deals')[0].title).toBe('Contato do Instagram')
  })

  it('never throws: a database error comes back as "error"', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = setup(twoFunnels, ['deals.insert'])

    await expect(openFirstContactDeal(db.client, input)).resolves.toBe('error')
    expect(spy).toHaveBeenCalled()
  })
})

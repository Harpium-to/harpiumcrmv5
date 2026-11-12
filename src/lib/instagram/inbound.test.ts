import { describe, expect, it } from 'vitest'

import { memoryDb } from '@/lib/testing/memory-supabase'
import { ingestInstagramInbound } from './inbound'
import type { InstagramInboundMessage } from './parse'

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

const dm = (over: Partial<InstagramInboundMessage> = {}): InstagramInboundMessage => ({
  igUserId: 'ig-business',
  fromId: 'igsid-123',
  text: 'Vocês atendem sábado?',
  externalId: 'mid-1',
  attachmentOnly: false,
  ...over,
})

describe('ingestInstagramInbound → first-contact deal', () => {
  it('a first DM puts the person in the funnel, titled after the channel', async () => {
    const db = setup()

    const result = await ingestInstagramInbound(db.client, account, dm())

    expect(result).not.toBeNull()
    expect(db.rows('deals')).toHaveLength(1)
    expect(db.rows('deals')[0]).toMatchObject({
      stage_id: 's-first',
      contact_id: result!.contactId,
      conversation_id: result!.conversationId,
      title: 'Contato do Instagram',
    })
  })

  it('a Meta retry of the same DM and later DMs add no deal', async () => {
    const db = setup()

    await ingestInstagramInbound(db.client, account, dm())
    await ingestInstagramInbound(db.client, account, dm())
    await ingestInstagramInbound(db.client, account, dm({ externalId: 'mid-2' }))

    expect(db.rows('messages')).toHaveLength(2)
    expect(db.rows('deals')).toHaveLength(1)
  })

  it('two DMs arriving together from a new person make one deal', async () => {
    const db = setup()

    await Promise.all([
      ingestInstagramInbound(db.client, account, dm({ externalId: 'a' })),
      ingestInstagramInbound(db.client, account, dm({ externalId: 'b' })),
    ])

    expect(db.rows('contacts')).toHaveLength(1)
    expect(db.rows('deals')).toHaveLength(1)
  })
})

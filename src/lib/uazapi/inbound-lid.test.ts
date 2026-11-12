import { describe, expect, it } from 'vitest'

import { fakeDb, type Row } from '@/lib/leads/fake-db.test-helper'
import { findOrCreateContact } from './inbound'

// A chat WhatsApp addressed by LID used to create a contact whose
// "phone" was the LID ("+20066104033409"); replies to it failed. The
// next message from that person carries both the number and the LID:
// the old contact gets its real number back instead of a second one
// being created.

const ACC = 'acc-1'
const LID = '20066104033409'
const PN = '5563992286787'

function world(contacts: Row[]): Record<string, Row[]> {
  return { contacts }
}

describe('findOrCreateContact — contacts saved under a LID', () => {
  it('gives the LID contact its real number and keeps it', async () => {
    const t = world([
      { id: 'c-lid', account_id: ACC, phone: `+${LID}`, phone_normalized: LID, name: 'Marcelo A.' },
    ])
    const r = await findOrCreateContact(fakeDb(t), ACC, 'owner', PN, 'Marcelo A.', LID)
    expect(r).toEqual({ id: 'c-lid', created: false })
    expect(t.contacts).toHaveLength(1)
    expect(t.contacts[0].phone).toBe(`+${PN}`)
  })

  it('replaces a placeholder name that was the LID itself', async () => {
    const t = world([{ id: 'c-lid', account_id: ACC, phone: `+${LID}`, phone_normalized: LID, name: `+${LID}` }])
    await findOrCreateContact(fakeDb(t), ACC, 'owner', PN, 'Marcelo', LID)
    expect(t.contacts[0]).toMatchObject({ phone: `+${PN}`, name: 'Marcelo' })
  })

  it('prefers a contact that already has the real number', async () => {
    const t = world([
      { id: 'c-pn', account_id: ACC, phone: `+${PN}`, phone_normalized: PN, name: 'Marcelo' },
      { id: 'c-lid', account_id: ACC, phone: `+${LID}`, phone_normalized: LID, name: 'Marcelo A.' },
    ])
    const r = await findOrCreateContact(fakeDb(t), ACC, 'owner', PN, 'Marcelo', LID)
    expect(r).toEqual({ id: 'c-pn', created: false })
    expect(t.contacts.find((c) => c.id === 'c-lid')?.phone).toBe(`+${LID}`)
  })

  it('never touches another CRM, and creates normally without a LID match', async () => {
    const t = world([{ id: 'other', account_id: 'acc-2', phone: `+${LID}`, phone_normalized: LID, name: 'X' }])
    const r = await findOrCreateContact(fakeDb(t), ACC, 'owner', PN, 'Marcelo', LID)
    expect(r?.created).toBe(true)
    expect(t.contacts.find((c) => c.id === 'other')?.phone).toBe(`+${LID}`)
    expect(t.contacts.filter((c) => c.account_id === ACC)).toHaveLength(1)
  })
})

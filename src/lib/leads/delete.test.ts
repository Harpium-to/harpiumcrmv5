import { describe, expect, it } from 'vitest'

import {
  cleanLeadIds,
  contactBornWithLead,
  deleteLeads,
  findTestContacts,
  MAX_DELETE,
} from './delete'
import { fakeDb, type Row } from './fake-db.test-helper'
import { noteMarker } from './note'

const ACC = 'acc-1'
const OTHER = 'acc-2'

const T0 = '2026-11-12T10:00:00.000Z'
const T0_PLUS_1S = '2026-11-12T10:00:01.000Z'
const LAST_MONTH = '2026-10-12T10:00:00.000Z'

/**
 * A test lead (contact born with it, nobody wrote), a real customer who
 * sent a lead later, and a lead from another account with the same id
 * shape — the three cases the delete must tell apart.
 */
function world(): Record<string, Row[]> {
  return {
    leads: [
      { id: 'lead-test', account_id: ACC, contact_id: 'c-test', created_at: T0_PLUS_1S },
      { id: 'lead-real', account_id: ACC, contact_id: 'c-real', created_at: T0_PLUS_1S },
      { id: 'lead-nocontact', account_id: ACC, contact_id: null, created_at: T0 },
      { id: 'lead-foreign', account_id: OTHER, contact_id: 'c-foreign', created_at: T0 },
    ],
    contacts: [
      { id: 'c-test', account_id: ACC, name: 'Teste', created_at: T0 },
      { id: 'c-real', account_id: ACC, name: 'Ana', created_at: LAST_MONTH },
      { id: 'c-foreign', account_id: OTHER, name: 'Outra conta', created_at: T0 },
    ],
    deals: [
      { id: 'd-test', account_id: ACC, contact_id: 'c-test', title: 'Lead Meta · Teste' },
      { id: 'd-real', account_id: ACC, contact_id: 'c-real', title: 'Ana' },
    ],
    conversations: [
      { id: 'conv-test', account_id: ACC, contact_id: 'c-test' },
      { id: 'conv-real', account_id: ACC, contact_id: 'c-real' },
    ],
    messages: [
      // An automation greeted the test lead; the lead never answered.
      { id: 'm1', conversation_id: 'conv-test', sender_type: 'bot' },
      { id: 'm2', conversation_id: 'conv-real', sender_type: 'customer' },
    ],
    contact_notes: [
      { id: 'n-test', account_id: ACC, contact_id: 'c-test', note_text: `Lead\n\n${noteMarker('lead-test')}` },
      { id: 'n-real-lead', account_id: ACC, contact_id: 'c-real', note_text: `Lead\n\n${noteMarker('lead-real')}` },
      { id: 'n-real-own', account_id: ACC, contact_id: 'c-real', note_text: 'Cliente prefere tarde.' },
    ],
  }
}

const ids = (rows: Row[]) => rows.map((r) => r.id).sort()

describe('contactBornWithLead', () => {
  it('counts a contact created right before its lead, or after it', () => {
    expect(contactBornWithLead(T0, T0_PLUS_1S)).toBe(true)
    expect(contactBornWithLead('2026-11-12T10:05:00.000Z', T0)).toBe(true)
  })

  it('does not count a contact that was already in the CRM', () => {
    expect(contactBornWithLead(LAST_MONTH, T0)).toBe(false)
    expect(contactBornWithLead('2026-11-12T09:57:00.000Z', T0)).toBe(false)
  })

  it('says no when a date is unreadable', () => {
    expect(contactBornWithLead('', T0)).toBe(false)
  })
})

describe('cleanLeadIds', () => {
  it('keeps distinct strings and caps the list', () => {
    expect(cleanLeadIds(['a', ' a ', 'b', '', 3, null])).toEqual(['a', 'b'])
    expect(cleanLeadIds('a')).toEqual([])
    const many = Array.from({ length: MAX_DELETE + 5 }, (_, i) => `id-${i}`)
    expect(cleanLeadIds(many)).toHaveLength(MAX_DELETE)
  })
})

describe('findTestContacts', () => {
  it('offers only the contact that came with the lead and never wrote', async () => {
    const t = world()
    const tests = await findTestContacts(fakeDb(t), ACC, [
      { id: 'lead-test', contact_id: 'c-test', created_at: T0_PLUS_1S },
      { id: 'lead-real', contact_id: 'c-real', created_at: T0_PLUS_1S },
      { id: 'lead-nocontact', contact_id: null, created_at: T0 },
    ])
    expect(tests).toEqual([{ contactId: 'c-test', name: 'Teste', leadIds: ['lead-test'] }])
  })

  it('keeps a contact born with the lead once the customer wrote', async () => {
    const t = world()
    t.messages.push({ id: 'm3', conversation_id: 'conv-test', sender_type: 'customer' })
    const tests = await findTestContacts(fakeDb(t), ACC, [
      { id: 'lead-test', contact_id: 'c-test', created_at: T0_PLUS_1S },
    ])
    expect(tests).toEqual([])
  })

  it('keeps a contact with another lead outside the selection', async () => {
    const t = world()
    t.leads.push({ id: 'lead-test-2', account_id: ACC, contact_id: 'c-test', created_at: T0 })
    const db = fakeDb(t)
    expect(
      await findTestContacts(db, ACC, [{ id: 'lead-test', contact_id: 'c-test', created_at: T0_PLUS_1S }]),
    ).toEqual([])
    // Both of its leads selected: it is a test contact again.
    expect(
      await findTestContacts(db, ACC, [
        { id: 'lead-test', contact_id: 'c-test', created_at: T0_PLUS_1S },
        { id: 'lead-test-2', contact_id: 'c-test', created_at: T0 },
      ]),
    ).toEqual([{ contactId: 'c-test', name: 'Teste', leadIds: ['lead-test', 'lead-test-2'] }])
  })

  it('never reaches a contact of another account', async () => {
    const t = world()
    const tests = await findTestContacts(fakeDb(t), ACC, [
      { id: 'lead-foreign', contact_id: 'c-foreign', created_at: T0 },
    ])
    expect(tests).toEqual([])
  })
})

describe('deleteLeads', () => {
  it('deletes the leads and their notes, and keeps contacts by default', async () => {
    const t = world()
    const r = await deleteLeads(fakeDb(t), ACC, ['lead-test', 'lead-real'])
    expect(r).toEqual({ leadsDeleted: 2, contactsDeleted: 0, contactsFailed: 0 })
    expect(ids(t.leads)).toEqual(['lead-foreign', 'lead-nocontact'])
    expect(ids(t.contacts)).toEqual(['c-foreign', 'c-real', 'c-test'])
    expect(ids(t.deals)).toEqual(['d-real', 'd-test'])
    // The notes the leads wrote go; the one a person wrote stays.
    expect(ids(t.contact_notes)).toEqual(['n-real-own'])
  })

  it('with deleteContacts, takes the test contact and its card, never the real one', async () => {
    const t = world()
    const r = await deleteLeads(fakeDb(t), ACC, ['lead-test', 'lead-real'], { deleteContacts: true })
    expect(r).toEqual({ leadsDeleted: 2, contactsDeleted: 1, contactsFailed: 0 })
    expect(ids(t.contacts)).toEqual(['c-foreign', 'c-real'])
    expect(ids(t.deals)).toEqual(['d-real'])
    // n-test is not deleted by hand: in the database it goes with its
    // contact (ON DELETE CASCADE), which this fake does not model.
    expect(ids(t.contact_notes)).toEqual(['n-real-own', 'n-test'])
  })

  it('ignores ids from another account', async () => {
    const t = world()
    const r = await deleteLeads(fakeDb(t), ACC, ['lead-foreign'], { deleteContacts: true })
    expect(r).toEqual({ leadsDeleted: 0, contactsDeleted: 0, contactsFailed: 0 })
    expect(ids(t.leads)).toContain('lead-foreign')
    expect(ids(t.contacts)).toContain('c-foreign')
  })

  it('deletes a lead that never had a contact', async () => {
    const t = world()
    const r = await deleteLeads(fakeDb(t), ACC, ['lead-nocontact'], { deleteContacts: true })
    expect(r).toEqual({ leadsDeleted: 1, contactsDeleted: 0, contactsFailed: 0 })
    expect(ids(t.leads)).not.toContain('lead-nocontact')
  })
})

import type { SupabaseClient } from '@supabase/supabase-js'

import { noteMarker } from './note'

// ============================================================
// Deleting received leads (mostly tests).
//
// Deleting a lead removes its row (the raw payload with it) and the
// note it left on the contact. The contact itself stays, unless the
// person also asked to delete *test contacts*, and the contact is one:
//
//   - it came into the CRM with these leads (it did not exist before);
//   - it has no other lead outside the ones being deleted;
//   - the customer never wrote a message.
//
// A test contact goes with its deals (the card the lead opened in the
// funnel), conversations, notes, tags and custom values. Anyone who
// ever wrote, or who was already in the CRM, is never touched here.
//
// Must be called with the service-role client, after checking that the
// caller is an admin of `accountId`. Every query is scoped to it.
// ============================================================

/** At most this many leads per call (the list shows 100). */
export const MAX_DELETE = 100

/**
 * A contact created up to this long before its first lead still came
 * in with it: the ingest creates the contact, then records the lead.
 */
const BORN_WITH_LEAD_MS = 2 * 60 * 1000

export interface LeadToDelete {
  id: string
  contact_id: string | null
  created_at: string
}

export interface TestContact {
  contactId: string
  name: string | null
  leadIds: string[]
}

export interface DeleteLeadsResult {
  leadsDeleted: number
  contactsDeleted: number
  /** Test contacts that could not be deleted (the leads still were). */
  contactsFailed: number
}

/**
 * Did the contact come into the CRM with this lead, rather than exist
 * before it? A contact a reprocess created later also counts.
 */
export function contactBornWithLead(contactCreatedAt: string, firstLeadAt: string): boolean {
  const contact = Date.parse(contactCreatedAt)
  const lead = Date.parse(firstLeadAt)
  if (!Number.isFinite(contact) || !Number.isFinite(lead)) return false
  return contact >= lead - BORN_WITH_LEAD_MS
}

/** Distinct, non-empty ids, capped. */
export function cleanLeadIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids = value.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
  return Array.from(new Set(ids.map((x) => x.trim()))).slice(0, MAX_DELETE)
}

/** The leads among `ids` that belong to the account. */
export async function loadLeadsToDelete(
  admin: SupabaseClient,
  accountId: string,
  ids: string[],
): Promise<LeadToDelete[]> {
  if (ids.length === 0) return []
  const { data, error } = await admin
    .from('leads')
    .select('id, contact_id, created_at')
    .eq('account_id', accountId)
    .in('id', ids)
  if (error) throw error
  return (data ?? []) as LeadToDelete[]
}

/** The contacts of `leads` that may go with them (see the top). */
export async function findTestContacts(
  admin: SupabaseClient,
  accountId: string,
  leads: LeadToDelete[],
): Promise<TestContact[]> {
  const byContact = new Map<string, LeadToDelete[]>()
  for (const lead of leads) {
    if (!lead.contact_id) continue
    const list = byContact.get(lead.contact_id) ?? []
    list.push(lead)
    byContact.set(lead.contact_id, list)
  }
  const contactIds = Array.from(byContact.keys())
  if (contactIds.length === 0) return []

  const { data: contacts, error: cErr } = await admin
    .from('contacts')
    .select('id, name, created_at')
    .eq('account_id', accountId)
    .in('id', contactIds)
  if (cErr) throw cErr

  // Every lead these contacts ever had: one outside the selection
  // means the contact is more than this test.
  const { data: allLeads, error: lErr } = await admin
    .from('leads')
    .select('id, contact_id')
    .eq('account_id', accountId)
    .in('contact_id', contactIds)
  if (lErr) throw lErr
  const selected = new Set(leads.map((l) => l.id))
  const hasOtherLead = new Set<string>()
  for (const row of (allLeads ?? []) as { id: string; contact_id: string }[]) {
    if (!selected.has(row.id)) hasOtherLead.add(row.contact_id)
  }

  const candidates: TestContact[] = []
  for (const c of (contacts ?? []) as { id: string; name: string | null; created_at: string }[]) {
    const own = byContact.get(c.id) ?? []
    if (own.length === 0 || hasOtherLead.has(c.id)) continue
    const firstLeadAt = own.map((l) => l.created_at).sort()[0]
    if (!contactBornWithLead(c.created_at, firstLeadAt)) continue
    candidates.push({ contactId: c.id, name: c.name, leadIds: own.map((l) => l.id) })
  }
  if (candidates.length === 0) return []

  // Last test, only for the few left: did the customer ever write?
  const { data: convs, error: vErr } = await admin
    .from('conversations')
    .select('id, contact_id')
    .eq('account_id', accountId)
    .in(
      'contact_id',
      candidates.map((c) => c.contactId),
    )
  if (vErr) throw vErr
  const contactOfConv = new Map<string, string>()
  for (const row of (convs ?? []) as { id: string; contact_id: string }[]) {
    contactOfConv.set(row.id, row.contact_id)
  }
  const wrote = new Set<string>()
  if (contactOfConv.size > 0) {
    const { data: inbound, error: mErr } = await admin
      .from('messages')
      .select('conversation_id')
      .in('conversation_id', Array.from(contactOfConv.keys()))
      .eq('sender_type', 'customer')
      .limit(1000)
    if (mErr) throw mErr
    for (const row of (inbound ?? []) as { conversation_id: string }[]) {
      const contactId = contactOfConv.get(row.conversation_id)
      if (contactId) wrote.add(contactId)
    }
  }

  return candidates.filter((c) => !wrote.has(c.contactId))
}

/**
 * Delete the leads in `ids` that belong to the account, the note each
 * left on its contact and, with `deleteContacts`, the test contacts.
 */
export async function deleteLeads(
  admin: SupabaseClient,
  accountId: string,
  ids: string[],
  options: { deleteContacts?: boolean } = {},
): Promise<DeleteLeadsResult> {
  const leads = await loadLeadsToDelete(admin, accountId, ids)
  if (leads.length === 0) return { leadsDeleted: 0, contactsDeleted: 0, contactsFailed: 0 }

  let contactsDeleted = 0
  let contactsFailed = 0
  const goneContacts = new Set<string>()

  if (options.deleteContacts) {
    const tests = await findTestContacts(admin, accountId, leads)
    const testIds = tests.map((t) => t.contactId)
    if (testIds.length > 0) {
      // The cards first: a deal outlives its contact (004, SET NULL)
      // and would stay in the funnel with no one behind it.
      const { error: dErr } = await admin
        .from('deals')
        .delete()
        .eq('account_id', accountId)
        .in('contact_id', testIds)
      const { error: cErr } = dErr
        ? { error: dErr }
        : await admin.from('contacts').delete().eq('account_id', accountId).in('id', testIds)
      if (cErr) {
        console.error('[leads delete] test contacts failed:', cErr.message)
        contactsFailed = testIds.length
      } else {
        contactsDeleted = testIds.length
        for (const id of testIds) goneContacts.add(id)
      }
    }
  }

  // The note each lead left on a contact that stays. (A deleted
  // contact took its notes with it.)
  const keptContacts = Array.from(
    new Set(
      leads
        .map((l) => l.contact_id)
        .filter((id): id is string => Boolean(id) && !goneContacts.has(id as string)),
    ),
  )
  if (keptContacts.length > 0) {
    try {
      await deleteLeadNotes(admin, accountId, keptContacts, leads.map((l) => l.id))
    } catch (err) {
      console.error('[leads delete] notes failed:', err)
    }
  }

  const { error } = await admin
    .from('leads')
    .delete()
    .eq('account_id', accountId)
    .in(
      'id',
      leads.map((l) => l.id),
    )
  if (error) throw error

  return { leadsDeleted: leads.length, contactsDeleted, contactsFailed }
}

async function deleteLeadNotes(
  admin: SupabaseClient,
  accountId: string,
  contactIds: string[],
  leadIds: string[],
): Promise<void> {
  const markers = leadIds.map(noteMarker)
  const { data, error } = await admin
    .from('contact_notes')
    .select('id, note_text')
    .eq('account_id', accountId)
    .in('contact_id', contactIds)
    .ilike('note_text', `%${noteMarker('')}%`)
  if (error) throw error
  const noteIds = ((data ?? []) as { id: string; note_text: string | null }[])
    .filter((n) => markers.some((m) => (n.note_text ?? '').includes(m)))
    .map((n) => n.id)
  if (noteIds.length === 0) return
  const { error: delErr } = await admin
    .from('contact_notes')
    .delete()
    .eq('account_id', accountId)
    .in('id', noteIds)
  if (delErr) throw delErr
}

import type { SupabaseClient } from '@supabase/supabase-js'

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import type { NormalizedLead } from './parse'

export interface IngestResult {
  leadId: string
  contactId: string | null
  contactCreated: boolean
}

/**
 * Persist a normalized lead and, when it carries a phone, upsert the
 * matching contact (reusing the shared phone-dedup so leads, the WhatsApp
 * webhook, and CSV import all agree on "same number"). Leads without a
 * phone are still stored — `contacts.phone` is NOT NULL, so they simply
 * don't create a contact until someone acts on them.
 *
 * Must be called with the service-role client (the webhook has no session).
 */
export async function ingestLead(
  admin: SupabaseClient,
  account: { id: string; ownerUserId: string },
  lead: NormalizedLead,
  raw: unknown,
): Promise<IngestResult> {
  let contactId: string | null = null
  let contactCreated = false

  if (lead.phone) {
    const existing = await findExistingContact(admin, account.id, lead.phone)
    if (existing) {
      contactId = existing.id
      // Backfill fields the existing contact is missing — never overwrite.
      const patch: Record<string, unknown> = {}
      if (lead.fullName && !existing.name) patch.name = lead.fullName
      if (lead.email && !existing.email) patch.email = lead.email
      if (lead.company && !existing.company) patch.company = lead.company
      if (Object.keys(patch).length > 0) {
        patch.updated_at = new Date().toISOString()
        await admin.from('contacts').update(patch).eq('id', existing.id)
      }
    } else {
      const { data, error } = await admin
        .from('contacts')
        .insert({
          account_id: account.id,
          // NOT NULL audit column — attribute system-created contacts to
          // the account owner, same as the WhatsApp webhook does.
          user_id: account.ownerUserId,
          phone: lead.phone,
          name: lead.fullName || lead.phone,
          email: lead.email,
          company: lead.company,
        })
        .select('id')
        .single()

      if (error) {
        // Lost a race against another insert of the same number — the
        // unique index (migration 022) rejected it; re-resolve instead.
        if (isUniqueViolation(error)) {
          const raced = await findExistingContact(admin, account.id, lead.phone)
          contactId = raced?.id ?? null
        } else {
          throw error
        }
      } else {
        contactId = data.id
        contactCreated = true
      }
    }
  }

  const { data: leadRow, error: leadErr } = await admin
    .from('leads')
    .insert({
      account_id: account.id,
      source: lead.source,
      external_id: lead.externalId,
      campaign: lead.campaign,
      form_name: lead.formName,
      full_name: lead.fullName,
      email: lead.email,
      phone: lead.phone,
      raw: (raw as object) ?? null,
      contact_id: contactId,
    })
    .select('id')
    .single()
  if (leadErr) throw leadErr

  return { leadId: leadRow.id, contactId, contactCreated }
}

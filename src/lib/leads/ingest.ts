import type { SupabaseClient } from '@supabase/supabase-js'

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import {
  assignImportedContactTags,
  resolveImportTagIds,
} from '@/lib/contacts/resolve-import-tags'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { openLeadDeal } from './deal'
import { buildLeadNote, noteMarker } from './note'
import { foldKey, leadTags, normalizeLead, type NormalizedLead } from './parse'

// ============================================================
// Writing a received lead into the CRM.
//
// Rules (docs/recebimento-universal-de-leads.md):
//   1. Same contact = same phone (normalized), or the same e-mail when
//      there is no phone. Found → update; not found → create.
//   2. An empty value never erases anything.
//   3. Every delivery is a row in `leads` (the contact's lead history),
//      even when the contact already existed.
//   4. Answers, extra fields, UTMs, route and consent → a note.
//   5. Tags (and the route tag, "rota-a") are applied, created if new.
//   6. `fields` fill the custom field with the same name; the rest → note.
//   7. The raw payload is stored on the lead row.
//   8. The same `id_externo` from the same origin within 24 h is not
//      written twice.
//   9. A lead with a contact gets a card in the funnel, unless the
//      contact already has an open one (deal.ts).
//
// Must be called with the service-role client (the webhook has no session).
// ============================================================

export interface LeadAccount {
  id: string
  ownerUserId: string
}

export type ContactStatus = 'criado' | 'atualizado'

export interface IngestResult {
  leadId: string
  contactId: string | null
  contactCreated: boolean
  contactStatus: ContactStatus | null
  /** True when this delivery repeated one already received (rule 8). */
  duplicate: boolean
}

/**
 * Where one incoming field key goes, chosen on the "de/para" screen:
 * `note`, `ignore`, `contact:<column>` or `custom:<custom_field_id>`.
 * Keys are folded with `foldKey`.
 */
export type FieldMappings = Record<string, string>

export interface IngestOptions {
  mappings?: FieldMappings
  /** The named ingest token the lead arrived with (migration 068). */
  tokenId?: string | null
}

/** Contact columns a field may be mapped to. */
export const MAPPABLE_CONTACT_COLUMNS = [
  'name',
  'email',
  'company',
  'city',
  'instagram',
  'website',
  'job_title',
  'segment',
] as const

const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000

interface ContactRow {
  id: string
  phone: string
  name?: string | null
  email?: string | null
  company?: string | null
  city?: string | null
  instagram?: string | null
  source?: string | null
  [key: string]: unknown
}

/** True when a lead has neither a phone nor an e-mail to identify it. */
export function lacksContactKey(lead: NormalizedLead): boolean {
  return !lead.phone && !lead.email
}

/**
 * Persist a normalized lead: resolve (or create) its contact, record
 * the delivery in `leads`, then write tags, custom fields and the note.
 */
export async function ingestLead(
  admin: SupabaseClient,
  account: LeadAccount,
  lead: NormalizedLead,
  raw: unknown,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const dup = await findRecentDuplicate(admin, account.id, lead)
  if (dup) {
    return {
      leadId: dup.id,
      contactId: dup.contact_id,
      contactCreated: false,
      contactStatus: dup.contact_id ? 'atualizado' : null,
      duplicate: true,
    }
  }

  const contact = await resolveContact(admin, account, lead, 'replace')

  const row: Record<string, unknown> = {
    account_id: account.id,
    source: lead.source,
    external_id: lead.externalId,
    campaign: lead.campaign,
    form_name: lead.formName,
    full_name: lead.fullName,
    email: lead.email,
    phone: lead.phone,
    raw: (raw as object) ?? null,
    contact_id: contact?.id ?? null,
  }
  if (options.tokenId) row.ingest_token_id = options.tokenId

  const { data: leadRow, error: leadErr } = await admin
    .from('leads')
    .insert(row)
    .select('id, created_at')
    .single()
  if (leadErr) throw leadErr

  if (contact) {
    await enrichContact(admin, account, contact.id, lead, {
      leadId: leadRow.id,
      receivedAt: new Date(leadRow.created_at ?? Date.now()),
      mappings: options.mappings ?? {},
    })
    // Rule 9: the lead lands in the funnel (deal.ts). After the contact
    // has the lead's name, so the card is titled with it.
    await openLeadDeal(admin, account, contact.id, lead)
  }

  return {
    leadId: leadRow.id,
    contactId: contact?.id ?? null,
    contactCreated: contact?.created ?? false,
    contactStatus: contact ? (contact.created ? 'criado' : 'atualizado') : null,
    duplicate: false,
  }
}

/** A lead with the same external id and origin received in the last 24 h. */
async function findRecentDuplicate(
  admin: SupabaseClient,
  accountId: string,
  lead: NormalizedLead,
): Promise<{ id: string; contact_id: string | null } | null> {
  if (!lead.externalId) return null
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString()
  const { data, error } = await admin
    .from('leads')
    .select('id, contact_id')
    .eq('account_id', accountId)
    .eq('source', lead.source)
    .eq('external_id', lead.externalId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    // Never block a lead because the duplicate check failed.
    console.error('[leads ingest] duplicate check failed:', error.message)
    return null
  }
  return (data as { id: string; contact_id: string | null } | null) ?? null
}

// ------------------------------------------------------------
// Contact
// ------------------------------------------------------------

/**
 * `replace`: a filled incoming value replaces the stored one (a new
 * lead is the freshest data). `backfill`: only empty columns are
 * filled — used when reprocessing old leads, which must not overwrite
 * newer data with older.
 */
type PatchMode = 'replace' | 'backfill'

async function resolveContact(
  admin: SupabaseClient,
  account: LeadAccount,
  lead: NormalizedLead,
  mode: PatchMode,
): Promise<{ id: string; created: boolean } | null> {
  if (lead.phone) {
    const existing = (await findExistingContact(admin, account.id, lead.phone)) as ContactRow | null
    if (existing) {
      await patchContact(admin, existing, lead, mode)
      return { id: existing.id, created: false }
    }

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
        city: lead.city,
        instagram: lead.instagram,
        source: lead.origin ?? (lead.source === 'other' ? null : lead.source),
      })
      .select('id')
      .single()

    if (error) {
      // Lost a race against another insert of the same number — the
      // unique index (migration 022) rejected it; re-resolve instead.
      if (isUniqueViolation(error)) {
        const raced = (await findExistingContact(admin, account.id, lead.phone)) as ContactRow | null
        if (!raced) return null
        await patchContact(admin, raced, lead, mode)
        return { id: raced.id, created: false }
      }
      throw error
    }
    return { id: data.id, created: true }
  }

  // No phone: `contacts.phone` is NOT NULL, so a new contact can't be
  // created — but an existing one with the same e-mail is updated.
  if (lead.email) {
    const existing = await findContactByEmail(admin, account.id, lead.email)
    if (existing) {
      await patchContact(admin, existing, lead, mode)
      return { id: existing.id, created: false }
    }
  }
  return null
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

async function findContactByEmail(
  admin: SupabaseClient,
  accountId: string,
  email: string,
): Promise<ContactRow | null> {
  const { data, error } = await admin
    .from('contacts')
    .select('*')
    .eq('account_id', accountId)
    .ilike('email', escapeLike(email))
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return (data as ContactRow | null) ?? null
}

/** The stored name is only a placeholder (empty, or the phone itself). */
function nameIsPlaceholder(contact: ContactRow): boolean {
  const name = (contact.name ?? '').trim()
  if (!name) return true
  const digits = normalizePhone(name)
  return digits.length >= 8 && digits === normalizePhone(contact.phone ?? '')
}

function changed(current: unknown, next: string | null, mode: PatchMode): boolean {
  if (!next) return false
  const cur = typeof current === 'string' ? current.trim() : ''
  if (mode === 'backfill') return cur === ''
  return cur.toLowerCase() !== next.trim().toLowerCase()
}

async function patchContact(
  admin: SupabaseClient,
  existing: ContactRow,
  lead: NormalizedLead,
  mode: PatchMode,
): Promise<void> {
  const patch: Record<string, unknown> = {}
  // The name a person typed in the CRM is never replaced by a form's —
  // only a placeholder name (the phone) gives way.
  if (lead.fullName && nameIsPlaceholder(existing)) patch.name = lead.fullName
  if (changed(existing.email, lead.email, mode)) patch.email = lead.email
  if (changed(existing.company, lead.company, mode)) patch.company = lead.company
  if (changed(existing.city, lead.city, mode)) patch.city = lead.city
  if (changed(existing.instagram, lead.instagram, mode)) patch.instagram = lead.instagram
  // First touch wins: the origin that brought the contact in stays.
  const origin = lead.origin ?? (lead.source === 'other' ? null : lead.source)
  if (origin && !(existing.source ?? '').trim()) patch.source = origin

  if (Object.keys(patch).length === 0) return
  patch.updated_at = new Date().toISOString()
  const { error } = await admin.from('contacts').update(patch).eq('id', existing.id)
  if (error) console.error('[leads ingest] contact update failed:', error.message)
}

// ------------------------------------------------------------
// Tags, custom fields, note
// ------------------------------------------------------------

interface EnrichArgs {
  leadId: string
  receivedAt: Date
  mappings: FieldMappings
}

/**
 * Tags, custom fields and the note for one lead on one contact. Each
 * part is independent: a failure is logged and the others still run,
 * because the lead row (with the raw payload) is already safe.
 */
export async function enrichContact(
  admin: SupabaseClient,
  account: LeadAccount,
  contactId: string,
  lead: NormalizedLead,
  args: EnrichArgs,
): Promise<void> {
  try {
    await applyTags(admin, account, contactId, lead)
  } catch (err) {
    console.error('[leads ingest] tags failed:', err)
  }

  let extraFields: Record<string, string> = {}
  try {
    extraFields = await applyFields(admin, account, contactId, lead, args.mappings)
  } catch (err) {
    console.error('[leads ingest] custom fields failed:', err)
    extraFields = { ...lead.fields }
  }

  try {
    await writeNote(admin, account, contactId, lead, args, extraFields)
  } catch (err) {
    console.error('[leads ingest] note failed:', err)
  }
}

async function applyTags(
  admin: SupabaseClient,
  account: LeadAccount,
  contactId: string,
  lead: NormalizedLead,
): Promise<void> {
  const tagNames = leadTags(lead)
  if (tagNames.length === 0) return
  const { tagIdByKey } = await resolveImportTagIds(admin, {
    accountId: account.id,
    userId: account.ownerUserId,
    tagNames,
    canCreateTags: true,
  })
  await assignImportedContactTags(admin, [{ contactId, tagNames }], tagIdByKey)
}

/**
 * Write `lead.fields` to custom fields (same name, or the de/para
 * choice) and contact columns mapped on the de/para screen. Returns the
 * fields left for the note.
 */
async function applyFields(
  admin: SupabaseClient,
  account: LeadAccount,
  contactId: string,
  lead: NormalizedLead,
  mappings: FieldMappings,
): Promise<Record<string, string>> {
  const entries = Object.entries(lead.fields)
  if (entries.length === 0) return {}

  const { data: defs, error } = await admin
    .from('custom_fields')
    .select('id, field_name')
    .eq('account_id', account.id)
  if (error) throw error

  const byName = new Map<string, string>()
  const ownIds = new Set<string>()
  for (const f of (defs ?? []) as { id: string; field_name: string }[]) {
    ownIds.add(f.id)
    const k = foldKey(f.field_name)
    if (k && !byName.has(k)) byName.set(k, f.id)
  }

  const leftover: Record<string, string> = {}
  const values = new Map<string, string>()
  const columnPatch: Record<string, string> = {}

  for (const [key, value] of entries) {
    const target = mappings[foldKey(key)]
    if (target === 'ignore') continue
    if (target === 'note') {
      leftover[key] = value
      continue
    }
    if (target?.startsWith('contact:')) {
      const col = target.slice('contact:'.length)
      if ((MAPPABLE_CONTACT_COLUMNS as readonly string[]).includes(col)) {
        columnPatch[col] = value
        continue
      }
    }
    if (target?.startsWith('custom:')) {
      const id = target.slice('custom:'.length)
      if (ownIds.has(id)) {
        values.set(id, value)
        continue
      }
    }
    const id = byName.get(foldKey(key))
    if (id) values.set(id, value)
    else leftover[key] = value
  }

  if (values.size > 0) {
    const rows = Array.from(values, ([custom_field_id, value]) => ({
      contact_id: contactId,
      custom_field_id,
      value,
    }))
    const { error: upErr } = await admin
      .from('contact_custom_values')
      .upsert(rows, { onConflict: 'contact_id,custom_field_id' })
    if (upErr) throw upErr
  }

  if (Object.keys(columnPatch).length > 0) {
    const { data: current } = await admin
      .from('contacts')
      .select('id, phone, name')
      .eq('id', contactId)
      .maybeSingle()
    if (columnPatch.name && current && !nameIsPlaceholder(current as ContactRow)) {
      delete columnPatch.name
    }
    if (Object.keys(columnPatch).length > 0) {
      await admin
        .from('contacts')
        .update({ ...columnPatch, updated_at: new Date().toISOString() })
        .eq('id', contactId)
        .eq('account_id', account.id)
    }
  }

  return leftover
}

async function writeNote(
  admin: SupabaseClient,
  account: LeadAccount,
  contactId: string,
  lead: NormalizedLead,
  args: EnrichArgs,
  extraFields: Record<string, string>,
): Promise<void> {
  const text = buildLeadNote({
    lead,
    leadId: args.leadId,
    receivedAt: args.receivedAt,
    extraFields,
  })
  if (!text) return

  // Reprocessing must not write the same note twice.
  const { data: existing } = await admin
    .from('contact_notes')
    .select('id')
    .eq('account_id', account.id)
    .eq('contact_id', contactId)
    .ilike('note_text', `%${escapeLike(noteMarker(args.leadId))}%`)
    .limit(1)
  if (existing && existing.length > 0) return

  const { error } = await admin.from('contact_notes').insert({
    account_id: account.id,
    contact_id: contactId,
    user_id: account.ownerUserId,
    note_text: text,
  })
  if (error) throw error
}

// ------------------------------------------------------------
// Reprocessing leads already stored
// ------------------------------------------------------------

export interface StoredLead {
  id: string
  raw: unknown
  contact_id: string | null
  created_at: string
  source?: string | null
}

export interface ReprocessResult {
  leadId: string
  contactId: string | null
  contactStatus: ContactStatus | null
}

/**
 * Run a stored lead through today's rules again, from its raw payload:
 * leads that arrived before the CRM understood their format get their
 * contact, tags, custom fields and note now. Safe to run twice — tags
 * and custom values upsert, the note is written once, and existing
 * contact data is only backfilled, never replaced.
 */
export async function reprocessLead(
  admin: SupabaseClient,
  account: LeadAccount,
  stored: StoredLead,
  mappings: FieldMappings = {},
): Promise<ReprocessResult> {
  const lead = normalizeLead(stored.raw)
  // The raw payload can't tell what the token added (a named token's
  // origin): an origin already stored is kept over "other".
  if (lead.source === 'other' && stored.source && stored.source !== 'other') {
    lead.source = stored.source
    lead.origin = lead.origin ?? stored.source
  }

  let contactId = stored.contact_id
  let contactStatus: ContactStatus | null = null
  if (!contactId) {
    const contact = await resolveContact(admin, account, lead, 'backfill')
    if (contact) {
      contactId = contact.id
      contactStatus = contact.created ? 'criado' : 'atualizado'
    }
  } else {
    const { data: current } = await admin
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .eq('account_id', account.id)
      .maybeSingle()
    if (current) {
      await patchContact(admin, current as ContactRow, lead, 'backfill')
      contactStatus = 'atualizado'
    } else {
      contactId = null
    }
  }

  // The list shows what the new reading understood (origin, name…);
  // a value the new reading lacks never blanks what was stored.
  const update: Record<string, unknown> = { source: lead.source }
  const columns: [string, string | null][] = [
    ['full_name', lead.fullName],
    ['email', lead.email],
    ['phone', lead.phone],
    ['campaign', lead.campaign],
    ['form_name', lead.formName],
    ['external_id', lead.externalId],
    ['contact_id', contactId],
  ]
  for (const [col, value] of columns) if (value) update[col] = value
  const { error: updErr } = await admin
    .from('leads')
    .update(update)
    .eq('id', stored.id)
    .eq('account_id', account.id)
  if (updErr) console.error('[leads reprocess] lead update failed:', updErr.message)

  if (contactId) {
    await enrichContact(admin, account, contactId, lead, {
      leadId: stored.id,
      receivedAt: new Date(stored.created_at),
      mappings,
    })
    // A lead that only now found its contact lands in the funnel, as it
    // would have on arrival (rule 9). One that already had a contact
    // went through that then.
    if (!stored.contact_id) await openLeadDeal(admin, account, contactId, lead)
  }
  return { leadId: stored.id, contactId, contactStatus }
}

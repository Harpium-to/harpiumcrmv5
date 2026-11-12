import type { SupabaseClient } from '@supabase/supabase-js'

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import {
  assignImportedContactTags,
  resolveImportTagIds,
} from '@/lib/contacts/resolve-import-tags'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { openLeadDeal } from './deal'
import { leadFieldEntries, type LeadFieldEntry } from './fields'
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
//   4. Answers, extra fields, UTMs, route and consent → a note (the
//      lead's history on the contact).
//   5. Tags (and the route tag, "rota-a") are applied, created if new.
//   6. Extra fields, answers, campaign, route and score fill custom
//      fields (fields.ts): the de/para choice, else the field with the
//      same name, else a new field named after it (migration 070).
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
  /** `backfill` when reprocessing: custom values only fill empty ones. */
  mode?: PatchMode
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
    extraFields = await applyFields(
      admin,
      account,
      contactId,
      lead,
      args.mappings,
      args.mode ?? 'replace',
    )
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

/** At most this many custom fields created by one lead. */
export const MAX_NEW_FIELDS_PER_LEAD = 40
/** At most this many custom fields created by leads in one account. */
export const MAX_LEAD_FIELDS_PER_ACCOUNT = 200

interface FieldDef {
  id: string
  field_name: string
  field_key?: string | null
  created_from?: string | null
}

/** Postgres / PostgREST telling that a column does not exist yet. */
function missingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42703' || error.code === 'PGRST204' || /column/i.test(error.message ?? '')
}

/** The account's custom fields, with 070's columns once it is applied. */
async function loadFieldDefs(admin: SupabaseClient, accountId: string): Promise<FieldDef[]> {
  const full = await admin
    .from('custom_fields')
    .select('id, field_name, field_key, created_from')
    .eq('account_id', accountId)
  if (!full.error) return (full.data ?? []) as FieldDef[]
  if (!missingColumn(full.error)) throw full.error
  const basic = await admin.from('custom_fields').select('id, field_name').eq('account_id', accountId)
  if (basic.error) throw basic.error
  return (basic.data ?? []) as FieldDef[]
}

/**
 * Create the custom field a lead needs. With migration 070, a field
 * another lead created a moment ago under the same key is reused (the
 * unique index refuses the twin). Returns null when it can't be made.
 */
async function createLeadField(
  admin: SupabaseClient,
  account: LeadAccount,
  entry: LeadFieldEntry,
): Promise<string | null> {
  const base = {
    account_id: account.id,
    user_id: account.ownerUserId,
    field_name: entry.label,
    field_type: 'text',
  }
  const first = await admin
    .from('custom_fields')
    .insert({ ...base, field_key: entry.key, created_from: 'lead' })
    .select('id')
    .single()
  if (!first.error && first.data) return (first.data as { id: string }).id

  if (first.error && isUniqueViolation(first.error)) {
    const { data } = await admin
      .from('custom_fields')
      .select('id')
      .eq('account_id', account.id)
      .eq('field_key', entry.key)
      .maybeSingle()
    return (data as { id: string } | null)?.id ?? null
  }

  if (missingColumn(first.error)) {
    // Before migration 070: the field still comes, without the guard.
    const plain = await admin.from('custom_fields').insert(base).select('id').single()
    if (!plain.error && plain.data) return (plain.data as { id: string }).id
    console.error('[leads ingest] could not create field:', plain.error?.message)
    return null
  }

  console.error('[leads ingest] could not create field:', first.error?.message)
  return null
}

/**
 * Write what the lead carries (extra fields, answers, campaign, route,
 * score — see fields.ts) to the contact's custom fields: the de/para
 * choice first, else the field with the same name, else a new field
 * named after it. Contact columns mapped on the de/para are written
 * too. Returns the extra fields left for the note's "Outros dados"
 * (answers, campaign and route already have their own lines there).
 *
 * `replace` (a new lead): a filled value replaces the stored one.
 * `backfill` (reprocessing): only empty values are filled.
 */
async function applyFields(
  admin: SupabaseClient,
  account: LeadAccount,
  contactId: string,
  lead: NormalizedLead,
  mappings: FieldMappings,
  mode: PatchMode,
): Promise<Record<string, string>> {
  const entries = leadFieldEntries(lead)
  if (entries.length === 0) return {}

  const defs = await loadFieldDefs(admin, account.id)
  const byName = new Map<string, string>()
  const ownIds = new Set<string>()
  let leadMade = 0
  for (const f of defs) {
    ownIds.add(f.id)
    if (f.created_from === 'lead') leadMade++
    const k = foldKey(f.field_name)
    if (k && !byName.has(k)) byName.set(k, f.id)
  }
  // A field a lead created and someone renamed ("Qual o seu faturamento
  // mensal?" → "Faturamento") keeps its key, so the answers still land
  // in it. The current name wins when both match.
  for (const f of defs) {
    if (f.field_key && !byName.has(f.field_key)) byName.set(f.field_key, f.id)
  }

  const leftover: Record<string, string> = {}
  const toNote = (entry: LeadFieldEntry) => {
    if (entry.origin === 'campo') leftover[entry.label] = entry.value
  }
  const values = new Map<string, string>()
  const columnPatch: Record<string, string> = {}
  const toCreate: LeadFieldEntry[] = []

  for (const entry of entries) {
    const target = mappings[entry.key]
    if (target === 'ignore') continue
    if (target === 'note') {
      toNote(entry)
      continue
    }
    if (target?.startsWith('contact:')) {
      const col = target.slice('contact:'.length)
      if ((MAPPABLE_CONTACT_COLUMNS as readonly string[]).includes(col)) {
        columnPatch[col] = entry.value
        continue
      }
    }
    if (target?.startsWith('custom:')) {
      const id = target.slice('custom:'.length)
      if (ownIds.has(id)) {
        values.set(id, entry.value)
        continue
      }
    }
    const id = byName.get(entry.key)
    if (id) values.set(id, entry.value)
    else toCreate.push(entry)
  }

  // The contact's own details (company, city, Instagram) live in its
  // columns, shown with the fields. An account that also keeps them as
  // custom fields ("Empresa", "Cidade") gets those filled too — never
  // created, which would split one piece of data in two.
  const details: [string, string | null][] = [
    ['Empresa', lead.company],
    ['Cidade', lead.city],
    ['Instagram', lead.instagram],
  ]
  for (const [label, value] of details) {
    const id = value ? byName.get(foldKey(label)) : undefined
    if (id && value && !values.has(id) && mappings[foldKey(label)] !== 'ignore') values.set(id, value)
  }

  // New fields, within the caps; the rest stays in the note.
  const room = Math.max(0, Math.min(MAX_NEW_FIELDS_PER_LEAD, MAX_LEAD_FIELDS_PER_ACCOUNT - leadMade))
  for (const [i, entry] of toCreate.entries()) {
    const id = i < room ? await createLeadField(admin, account, entry) : null
    if (id) {
      values.set(id, entry.value)
      byName.set(entry.key, id)
    } else {
      toNote(entry)
    }
  }

  if (values.size > 0) {
    if (mode === 'backfill') {
      const { data: current } = await admin
        .from('contact_custom_values')
        .select('custom_field_id, value')
        .eq('contact_id', contactId)
        .in('custom_field_id', Array.from(values.keys()))
      for (const row of (current ?? []) as { custom_field_id: string; value: string | null }[]) {
        if ((row.value ?? '').trim()) values.delete(row.custom_field_id)
      }
    }
    const rows = Array.from(values, ([custom_field_id, value]) => ({
      contact_id: contactId,
      custom_field_id,
      value,
    }))
    if (rows.length > 0) {
      const { error: upErr } = await admin
        .from('contact_custom_values')
        .upsert(rows, { onConflict: 'contact_id,custom_field_id' })
      if (upErr) throw upErr
    }
  }

  if (Object.keys(columnPatch).length > 0) {
    const { data: current } = await admin
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .maybeSingle()
    const row = current as ContactRow | null
    if (columnPatch.name && row && !nameIsPlaceholder(row)) delete columnPatch.name
    if (mode === 'backfill' && row) {
      for (const col of Object.keys(columnPatch)) {
        const cur = row[col]
        if (typeof cur === 'string' && cur.trim()) delete columnPatch[col]
      }
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
      mode: 'backfill',
    })
    // A lead that only now found its contact lands in the funnel, as it
    // would have on arrival (rule 9). One that already had a contact
    // went through that then.
    if (!stored.contact_id) await openLeadDeal(admin, account, contactId, lead)
  }
  return { leadId: stored.id, contactId, contactStatus }
}

import type { SupabaseClient } from '@supabase/supabase-js'

import { ingestLead, type IngestOptions, type IngestResult, type LeadAccount } from '@/lib/leads/ingest'
import { loadFieldMappings } from '@/lib/leads/mappings'
import { normalizeLead, type NormalizedLead } from '@/lib/leads/parse'

import { describeFilters } from './filters'
import { buildLeadPayload, listTag } from './lead'
import { phoneKeys } from './phone'
import { RESULT_COLUMNS, type ExtractionRow, type ResultRow } from './store'

// ============================================================
// "Enviar para o CRM": the marked rows of an extraction become
// contacts, through the CRM's own lead receiver (src/lib/leads) — but
// silently.
//
// A lead that arrives by itself opens a card in the funnel and fires
// "lead recebido" (automations, webhook, Agent SDR). Hundreds of cold
// leads at once must do neither: the funnel would fill up and the
// robot would write to all of them at once, outside the prospecting
// pace. So here:
//   - the contact, the lead row, the origin, the tags, the custom
//     fields and the note are written as always;
//   - no card (`skipDeal`): it opens when the lead replies;
//   - no "lead recebido": nothing here dispatches it.
//
// What is left out, and why, comes back to the screen:
//   - no phone (a contact needs one);
//   - on the block list now, whatever it was when extracted;
//   - already a contact — untouched, unless the person asked to
//     complete what is empty; then only empty columns and fields are
//     filled, and the contact does NOT get the list's tag, so someone
//     the company already talks to never enters a cold send.
// ============================================================

/** Rows sent in one call: the screen sends the list in batches. */
export const IMPORT_BATCH = 25

export interface ImportInput {
  resultIds: string[]
  listName: string
  completeExisting: boolean
}

export interface ImportOutcome {
  imported: number
  created: number
  completed: number
  skipped: { semTelefone: number; bloqueado: number; contato: number; jaEnviado: number; erro: number }
}

export class ImportError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'ImportError'
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Check what the screen sent. Pure. */
export function parseImportInput(body: unknown): ImportInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const ids = Array.isArray(b.result_ids)
    ? [...new Set(b.result_ids.filter((v): v is string => typeof v === 'string' && UUID.test(v)))]
    : []
  if (ids.length === 0) throw new ImportError('Marque pelo menos um lead.')
  if (ids.length > IMPORT_BATCH) throw new ImportError(`Até ${IMPORT_BATCH} leads por envio.`)
  const listName = typeof b.list_name === 'string' ? listTag(b.list_name) : ''
  if (listName.length < 2) throw new ImportError('Dê um nome à lista.')
  return { resultIds: ids, listName, completeExisting: b.complete_existing === true }
}

export interface ImportDeps {
  ingest: (
    admin: SupabaseClient,
    account: LeadAccount,
    lead: NormalizedLead,
    raw: unknown,
    options?: IngestOptions,
  ) => Promise<IngestResult>
}

const defaultDeps: ImportDeps = { ingest: ingestLead }

/** Service-role client; the route has already checked the role. */
export async function importResults(
  admin: SupabaseClient,
  account: LeadAccount,
  extraction: ExtractionRow,
  input: ImportInput,
  deps: ImportDeps = defaultDeps,
): Promise<ImportOutcome> {
  const outcome: ImportOutcome = {
    imported: 0,
    created: 0,
    completed: 0,
    skipped: { semTelefone: 0, bloqueado: 0, contato: 0, jaEnviado: 0, erro: 0 },
  }

  const { data, error } = await admin
    .from('lead_extraction_results')
    .select(RESULT_COLUMNS)
    .eq('account_id', account.id)
    .eq('extraction_id', extraction.id)
    .in('id', input.resultIds)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as ResultRow[]

  // What the CRM knows NOW: the row's status is from extraction time.
  const keys = [...new Set(rows.flatMap((r) => phoneKeys(r.phone)))]
  const blocked = new Set<string>()
  const contacts = new Map<string, string>()
  if (keys.length > 0) {
    const [b, c] = await Promise.all([
      admin.from('prospecting_blocklist').select('phone_normalized').eq('account_id', account.id).in('phone_normalized', keys),
      admin.from('contacts').select('id, phone_normalized').eq('account_id', account.id).in('phone_normalized', keys),
    ])
    for (const r of (b.data ?? []) as { phone_normalized: string }[]) blocked.add(r.phone_normalized)
    for (const r of (c.data ?? []) as { id: string; phone_normalized: string }[]) {
      contacts.set(r.phone_normalized, r.id)
    }
  }

  const search = describeFilters(extraction.source, extraction.filters)
  let mappings: IngestOptions['mappings'] | undefined

  for (const row of rows) {
    if (row.imported_at) {
      outcome.skipped.jaEnviado += 1
      continue
    }
    if (!row.phone) {
      outcome.skipped.semTelefone += 1
      continue
    }
    const rowKeys = phoneKeys(row.phone)
    if (rowKeys.some((k) => blocked.has(k))) {
      outcome.skipped.bloqueado += 1
      await admin.from('lead_extraction_results').update({ status: 'bloqueado' }).eq('id', row.id)
      continue
    }
    const existingId = rowKeys.map((k) => contacts.get(k)).find(Boolean) ?? null
    if (existingId && !input.completeExisting) {
      outcome.skipped.contato += 1
      await admin
        .from('lead_extraction_results')
        .update({ status: 'contato', matched_contact_id: existingId })
        .eq('id', row.id)
      continue
    }

    try {
      const payload = buildLeadPayload(row, {
        extractionId: extraction.id,
        extractionName: extraction.name,
        listName: input.listName,
        search,
        extractedAt: row.created_at,
      })
      // Someone the company already talks to stays out of the list.
      if (existingId) payload.etiquetas = []
      const lead = normalizeLead(payload)
      mappings ??= await loadFieldMappings(admin, account.id, lead.source)
      const result = await deps.ingest(admin, account, lead, payload, {
        mappings,
        skipDeal: true,
        patchMode: existingId ? 'backfill' : 'replace',
      })
      await admin
        .from('lead_extraction_results')
        .update({
          contact_id: result.contactId,
          lead_id: result.leadId,
          imported_at: new Date().toISOString(),
          ...(existingId ? { status: 'contato', matched_contact_id: existingId } : {}),
        })
        .eq('id', row.id)
      outcome.imported += 1
      if (result.contactCreated) {
        outcome.created += 1
        // Another row of this batch with the same number is the same contact.
        if (result.contactId) for (const k of rowKeys) contacts.set(k, result.contactId)
      } else {
        outcome.completed += 1
      }
    } catch (err) {
      console.error('[extrator] import failed for', row.id, err)
      outcome.skipped.erro += 1
    }
  }
  return outcome
}

// ------------------------------------------------------------
// The call list: one task per lead already in the CRM
// ------------------------------------------------------------

export const CALL_TASK_PREFIX = 'Ligar para '

/**
 * "Criar lista de ligação": a task per imported lead of the
 * extraction, for `assignedTo`, skipping whoever already has an open
 * call task. Returns how many were created.
 */
export async function createCallList(
  admin: SupabaseClient,
  accountId: string,
  extractionId: string,
  createdBy: string,
  assignedTo: string,
  dueAt: string | null,
): Promise<{ created: number; already: number }> {
  const { data, error } = await admin
    .from('lead_extraction_results')
    .select('contact_id, name')
    .eq('account_id', accountId)
    .eq('extraction_id', extractionId)
    .not('imported_at', 'is', null)
    .not('contact_id', 'is', null)
    .limit(2000)
  if (error) throw new Error(error.message)
  const leads = new Map<string, string>()
  for (const row of (data ?? []) as { contact_id: string; name: string }[]) leads.set(row.contact_id, row.name)
  if (leads.size === 0) return { created: 0, already: 0 }

  const ids = [...leads.keys()]
  const open = new Set<string>()
  for (let i = 0; i < ids.length; i += 300) {
    const { data: tasks } = await admin
      .from('contact_tasks')
      .select('contact_id')
      .eq('account_id', accountId)
      .is('done_at', null)
      .like('title', `${CALL_TASK_PREFIX}%`)
      .in('contact_id', ids.slice(i, i + 300))
    for (const t of (tasks ?? []) as { contact_id: string }[]) open.add(t.contact_id)
  }

  const rows = ids
    .filter((id) => !open.has(id))
    .map((id) => ({
      account_id: accountId,
      contact_id: id,
      title: `${CALL_TASK_PREFIX}${leads.get(id) ?? 'o lead'}`.slice(0, 200),
      due_at: dueAt,
      created_by: createdBy,
      assigned_to: assignedTo,
    }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error: insertError } = await admin.from('contact_tasks').insert(rows.slice(i, i + 500))
    if (insertError) throw new Error(insertError.message)
  }
  return { created: rows.length, already: open.size }
}

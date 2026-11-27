import type { SupabaseClient } from '@supabase/supabase-js'

import { classifyLead, loadCrmKnowledge } from './classify'
import { phoneKeys, phoneKind } from './phone'
import { cnpjSource } from './sources/cnpj'
import { mapsSource } from './sources/maps'
import type { SourceAdapter } from './sources/types'
import { isMissingTable, type ExtractionRow } from './store'
import type { ExtractedLead, ExtractionSource } from './types'

// ============================================================
// Running an extraction, one slice at a time.
//
// The host does not let a request run for minutes, so a job is a row
// that advances a slice per call: the open screen asks for the next
// slice while the person watches, and the scheduler that already runs
// the automations picks up whatever is left when they close it.
//
// A slice claims the job first (claimed_at), so the screen and the
// scheduler never run the same one twice.
// ============================================================

/** A claim older than this is a slice that died; the job is free again. */
export const CLAIM_STALE_MS = 90_000

export type SourceRegistry = Record<ExtractionSource, SourceAdapter<never>>

const defaultSources = {
  cnpj: cnpjSource,
  google_maps: mapsSource,
} as unknown as SourceRegistry

export function sourceOf(source: ExtractionSource, sources: SourceRegistry = defaultSources) {
  return sources[source] as unknown as SourceAdapter<unknown>
}

export interface RunDeps {
  sources: SourceRegistry
  now: () => number
}

const defaultDeps: RunDeps = { sources: defaultSources, now: () => Date.now() }

const COLUMNS =
  'id, account_id, created_by, name, source, filters, status, requested, fetched, found, cursor, claimed_at, cost_usd, error, finished_at, created_at, updated_at'

function resultRow(extraction: ExtractionRow, lead: ExtractedLead, status: string, contactId: string | null) {
  const keys = phoneKeys(lead.phone)
  return {
    account_id: extraction.account_id,
    extraction_id: extraction.id,
    source: lead.source,
    external_key: lead.externalKey,
    kind: lead.kind,
    name: lead.name.slice(0, 200),
    phone: lead.phone,
    phone_normalized: keys[0] ?? null,
    phone_kind: phoneKind(lead.phone),
    email: lead.email,
    website: lead.website,
    instagram: lead.instagram,
    address: lead.address,
    district: lead.district,
    city: lead.city,
    uf: lead.uf,
    cep: lead.cep,
    activity: lead.activity,
    extras: lead.extras,
    status,
    matched_contact_id: contactId,
  }
}

async function finish(
  admin: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<ExtractionRow | null> {
  const { data, error } = await admin
    .from('lead_extractions')
    .update({ ...patch, claimed_at: null })
    .eq('id', id)
    .select(COLUMNS)
    .maybeSingle()
  if (error) console.error('[extrator] job update failed:', error.message)
  return (data as ExtractionRow | null) ?? null
}

/**
 * Advance one extraction by one slice. Returns the job as it is now,
 * or null when someone else holds it (or it is over). Never throws: a
 * failure is written on the job, for the person.
 */
export async function runExtractionSlice(
  admin: SupabaseClient,
  extractionId: string,
  deps: RunDeps = defaultDeps,
): Promise<ExtractionRow | null> {
  const now = deps.now()
  const stale = new Date(now - CLAIM_STALE_MS).toISOString()
  const { data: claimed, error: claimError } = await admin
    .from('lead_extractions')
    .update({ status: 'running', claimed_at: new Date(now).toISOString() })
    .eq('id', extractionId)
    .in('status', ['queued', 'running'])
    .or(`claimed_at.is.null,claimed_at.lt."${stale}"`)
    .select(COLUMNS)
    .maybeSingle()
  if (claimError) {
    if (!isMissingTable(claimError)) console.error('[extrator] claim failed:', claimError.message)
    return null
  }
  const job = claimed as ExtractionRow | null
  if (!job) return null

  try {
    const remaining = job.requested - job.found
    if (remaining <= 0) {
      return await finish(admin, job.id, { status: 'done', finished_at: new Date(now).toISOString() })
    }
    const source = sourceOf(job.source, deps.sources)
    const availability = source.available()
    if (!availability.available) throw new Error(availability.reason)

    // Each source caps its own page: the CNPJ base pages, Maps asks once.
    const page = await source.fetchPage(job.filters, job.cursor ?? {}, remaining)
    if (page.waiting) {
      return await finish(admin, job.id, { cursor: page.cursor ?? job.cursor })
    }

    const leads = page.leads.slice(0, remaining)
    let inserted = 0
    if (leads.length > 0) {
      const known = await loadCrmKnowledge(admin, job.account_id, job.id, job.source, leads)
      const rows = leads.map((lead) => {
        const { status, matchedContactId } = classifyLead(lead, known)
        // A second row with the same number (a branch, say) is not new.
        if (status === 'novo') for (const key of phoneKeys(lead.phone)) known.extractedPhones.add(key)
        return resultRow(job, lead, status, matchedContactId)
      })
      const { data, error } = await admin
        .from('lead_extraction_results')
        .upsert(rows, { onConflict: 'extraction_id,external_key', ignoreDuplicates: true })
        .select('id')
      if (error) throw new Error(error.message)
      inserted = (data ?? []).length
    }

    const found = job.found + inserted
    // Over when the source has no more, the job has what it asked, or
    // the source's page had more than fit (the rest is left behind).
    const over = page.cursor === null || found >= job.requested || page.leads.length > leads.length
    return await finish(admin, job.id, {
      found,
      fetched: job.fetched + page.fetched,
      cost_usd: (Number(job.cost_usd) || 0) + page.costUsd,
      cursor: page.cursor ?? {},
      ...(over ? { status: 'done', finished_at: new Date(deps.now()).toISOString() } : {}),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha na extração.'
    console.error('[extrator] slice failed:', message)
    return await finish(admin, job.id, {
      status: 'failed',
      error: message.slice(0, 500),
      finished_at: new Date(deps.now()).toISOString(),
    })
  }
}

/**
 * The scheduler's side: advance the jobs still going, oldest first.
 * With a deadline, no slice starts after it (the one running finishes;
 * the rest go on next tick). Returns how many slices ran, or null when
 * it could not (migration 073 pending, or an error, logged). Never throws.
 */
export async function runPendingExtractions(
  admin: SupabaseClient,
  opts: { deadline?: number } = {},
  deps: RunDeps = defaultDeps,
): Promise<number | null> {
  try {
    const { data, error } = await admin
      .from('lead_extractions')
      .select('id')
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: true })
      .limit(5)
    if (error) {
      if (!isMissingTable(error)) console.error('[extrator] pending read failed:', error.message)
      return null
    }
    let slices = 0
    for (const row of (data ?? []) as { id: string }[]) {
      if (opts.deadline !== undefined && deps.now() > opts.deadline) break
      if (await runExtractionSlice(admin, row.id, deps)) slices += 1
    }
    return slices
  } catch (err) {
    console.error('[extrator] runPendingExtractions threw:', err)
    return null
  }
}

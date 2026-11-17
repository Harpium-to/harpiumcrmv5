// ============================================================
// Extractions in the database (migration 073). Server only.
//
// Reads done for a signed-in person go through their own client (RLS:
// members of the CRM). Writes go through the service role, after the
// route checked the role — the same model as the Quiz (072).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingTable } from '@/lib/leads/mappings'

import { dayKey } from '@/lib/bulk/plan'
import {
  DEFAULT_MONTHLY_LIMIT,
  UNUSED_RESULTS_DAYS,
  type ExtractionFilters,
  type ExtractionSource,
  type ExtractionStatus,
  type ExtraValue,
  type LeadKind,
  type PhoneKind,
  type ResultStatus,
} from './types'

export { isMissingTable }

export interface ExtractionRow {
  id: string
  account_id: string
  created_by: string | null
  name: string
  source: ExtractionSource
  filters: ExtractionFilters
  status: ExtractionStatus
  requested: number
  fetched: number
  found: number
  cursor: Record<string, unknown>
  claimed_at: string | null
  cost_usd: number | string
  error: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

export interface ExtractionTotals {
  kept: number
  novos: number
  contatos: number
  extraidos: number
  bloqueados: number
  sem_telefone: number
  importados: number
}

export const NO_TOTALS: ExtractionTotals = {
  kept: 0,
  novos: 0,
  contatos: 0,
  extraidos: 0,
  bloqueados: 0,
  sem_telefone: 0,
  importados: 0,
}

export interface ExtractionSummary {
  id: string
  name: string
  source: ExtractionSource
  status: ExtractionStatus
  requested: number
  found: number
  fetched: number
  costUsd: number
  error: string | null
  createdAt: string
  finishedAt: string | null
  filters: ExtractionFilters
  totals: ExtractionTotals
}

export interface ResultRow {
  id: string
  extraction_id: string
  source: ExtractionSource
  external_key: string
  kind: LeadKind
  name: string
  phone: string | null
  phone_normalized: string | null
  phone_kind: PhoneKind | null
  has_whatsapp: boolean | null
  email: string | null
  website: string | null
  instagram: string | null
  address: string | null
  district: string | null
  city: string | null
  uf: string | null
  cep: string | null
  activity: string | null
  extras: Record<string, ExtraValue>
  status: ResultStatus
  matched_contact_id: string | null
  contact_id: string | null
  lead_id: string | null
  imported_at: string | null
  enriched_at: string | null
  created_at: string
}

const EXTRACTION_COLUMNS =
  'id, account_id, created_by, name, source, filters, status, requested, fetched, found, cursor, claimed_at, cost_usd, error, finished_at, created_at, updated_at'

export const RESULT_COLUMNS =
  'id, extraction_id, source, external_key, kind, name, phone, phone_normalized, phone_kind, has_whatsapp, email, website, instagram, address, district, city, uf, cep, activity, extras, status, matched_contact_id, contact_id, lead_id, imported_at, enriched_at, created_at'

export function summarize(row: ExtractionRow, totals?: ExtractionTotals): ExtractionSummary {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    status: row.status,
    requested: row.requested,
    found: row.found,
    fetched: row.fetched,
    costUsd: Number(row.cost_usd) || 0,
    error: row.error,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    filters: row.filters,
    totals: totals ?? NO_TOTALS,
  }
}

async function totalsOf(
  db: SupabaseClient,
  accountId: string,
  ids: string[],
): Promise<Map<string, ExtractionTotals>> {
  const out = new Map<string, ExtractionTotals>()
  if (ids.length === 0) return out
  const { data, error } = await db
    .from('lead_extraction_totals')
    .select('extraction_id, kept, novos, contatos, extraidos, bloqueados, sem_telefone, importados')
    .eq('account_id', accountId)
    .in('extraction_id', ids)
  if (error) {
    console.error('[extrator] totals read failed:', error.message)
    return out
  }
  for (const row of (data ?? []) as (ExtractionTotals & { extraction_id: string })[]) {
    const { extraction_id, ...totals } = row
    out.set(extraction_id, totals)
  }
  return out
}

/** The CRM's latest extractions. null = migration 073 pending. */
export async function listExtractions(
  db: SupabaseClient,
  accountId: string,
): Promise<ExtractionSummary[] | null> {
  const { data, error } = await db
    .from('lead_extractions')
    .select(EXTRACTION_COLUMNS)
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) {
    if (isMissingTable(error)) return null
    throw new Error(error.message)
  }
  const rows = (data ?? []) as ExtractionRow[]
  const totals = await totalsOf(
    db,
    accountId,
    rows.map((r) => r.id),
  )
  return rows.map((row) => summarize(row, totals.get(row.id)))
}

export async function getExtraction(
  db: SupabaseClient,
  accountId: string,
  id: string,
): Promise<ExtractionRow | null> {
  const { data, error } = await db
    .from('lead_extractions')
    .select(EXTRACTION_COLUMNS)
    .eq('account_id', accountId)
    .eq('id', id)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error)) return null
    throw new Error(error.message)
  }
  return (data as ExtractionRow | null) ?? null
}

export async function getExtractionSummary(
  db: SupabaseClient,
  accountId: string,
  id: string,
): Promise<ExtractionSummary | null> {
  const row = await getExtraction(db, accountId, id)
  if (!row) return null
  const totals = await totalsOf(db, accountId, [id])
  return summarize(row, totals.get(id))
}

export async function createExtraction(
  admin: SupabaseClient,
  input: {
    accountId: string
    userId: string
    name: string
    source: ExtractionSource
    filters: ExtractionFilters
    requested: number
  },
): Promise<ExtractionRow> {
  const { data, error } = await admin
    .from('lead_extractions')
    .insert({
      account_id: input.accountId,
      created_by: input.userId,
      name: input.name,
      source: input.source,
      filters: input.filters,
      requested: input.requested,
    })
    .select(EXTRACTION_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return data as ExtractionRow
}

export const RESULT_PAGE = 100

export interface ResultQuery {
  status?: ResultStatus | 'importados' | 'pendentes'
  search?: string
  page?: number
}

/** One page of an extraction's results, oldest first (the source's order). */
export async function listResults(
  db: SupabaseClient,
  accountId: string,
  extractionId: string,
  query: ResultQuery = {},
): Promise<{ rows: ResultRow[]; total: number }> {
  const page = Math.max(0, Math.floor(query.page ?? 0))
  let request = db
    .from('lead_extraction_results')
    .select(RESULT_COLUMNS, { count: 'exact' })
    .eq('account_id', accountId)
    .eq('extraction_id', extractionId)
  if (query.status === 'importados') request = request.not('imported_at', 'is', null)
  else if (query.status === 'pendentes') request = request.is('imported_at', null)
  else if (query.status) request = request.eq('status', query.status)
  const search = (query.search ?? '').replace(/[%_\\,()]/g, ' ').trim().slice(0, 60)
  if (search) request = request.ilike('name', `%${search}%`)
  const { data, error, count } = await request
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(page * RESULT_PAGE, page * RESULT_PAGE + RESULT_PAGE - 1)
  if (error) throw new Error(error.message)
  return { rows: (data ?? []) as ResultRow[], total: count ?? 0 }
}

// ------------------------------------------------------------
// The monthly ceiling and the terms of use
// ------------------------------------------------------------

export interface ExtractorSettings {
  monthlyLimit: number
  /** The agency set a ceiling of its own (else the default). */
  customLimit: boolean
  termsAcceptedAt: string | null
}

export async function loadSettings(db: SupabaseClient, accountId: string): Promise<ExtractorSettings> {
  const { data, error } = await db
    .from('lead_extractor_settings')
    .select('monthly_limit, terms_accepted_at')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error && !isMissingTable(error)) console.error('[extrator] settings read failed:', error.message)
  const row = (data ?? null) as { monthly_limit: number | null; terms_accepted_at: string | null } | null
  return {
    monthlyLimit: row?.monthly_limit ?? DEFAULT_MONTHLY_LIMIT,
    customLimit: row?.monthly_limit != null,
    termsAcceptedAt: row?.terms_accepted_at ?? null,
  }
}

/** The first instant of the current month, in Brasília time. */
export function monthStart(now: number): string {
  const [year, month] = dayKey(now).split('-')
  return new Date(`${year}-${month}-01T00:00:00-03:00`).toISOString()
}

/**
 * Leads this CRM extracted this month. A job still going counts for
 * what it asked, so two at once cannot pass the ceiling together.
 */
export async function monthlyUsage(db: SupabaseClient, accountId: string, now = Date.now()): Promise<number> {
  const { data, error } = await db
    .from('lead_extractions')
    .select('status, requested, found')
    .eq('account_id', accountId)
    .gte('created_at', monthStart(now))
  if (error) {
    if (isMissingTable(error)) return 0
    throw new Error(error.message)
  }
  let used = 0
  for (const row of (data ?? []) as { status: ExtractionStatus; requested: number; found: number }[]) {
    used += row.status === 'queued' || row.status === 'running' ? Math.max(row.requested, row.found) : row.found
  }
  return used
}

export async function acceptTerms(admin: SupabaseClient, accountId: string, userId: string): Promise<string> {
  const at = new Date().toISOString()
  const { error } = await admin
    .from('lead_extractor_settings')
    .upsert(
      { account_id: accountId, terms_accepted_at: at, terms_accepted_by: userId },
      { onConflict: 'account_id' },
    )
  if (error) throw new Error(error.message)
  return at
}

/** The agency's ceiling for a CRM; null puts the default back. */
export async function setMonthlyLimit(
  admin: SupabaseClient,
  accountId: string,
  limit: number | null,
): Promise<void> {
  const { error } = await admin
    .from('lead_extractor_settings')
    .upsert({ account_id: accountId, monthly_limit: limit }, { onConflict: 'account_id' })
  if (error) throw new Error(error.message)
}

/**
 * Results that never went to the CRM, older than the keeping period.
 * Returns how many were deleted, or null when it could not run. Never
 * throws: it shares the scheduler with the automations.
 */
export async function cleanUpUnusedResults(admin: SupabaseClient, now = Date.now()): Promise<number | null> {
  try {
    const before = new Date(now - UNUSED_RESULTS_DAYS * 86_400_000).toISOString()
    const { data, error } = await admin
      .from('lead_extraction_results')
      .delete()
      .is('imported_at', null)
      .lt('created_at', before)
      .select('id')
    if (error) {
      if (!isMissingTable(error)) console.error('[extrator] clean-up failed:', error.message)
      return null
    }
    return (data ?? []).length
  } catch (err) {
    console.error('[extrator] clean-up threw:', err)
    return null
  }
}

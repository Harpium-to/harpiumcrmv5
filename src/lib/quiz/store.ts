// ============================================================
// Quizzes in the database (migration 072). Server only.
//
// Reads done for a signed-in person go through their own client (RLS:
// members of the CRM). Writes, and everything the public page needs,
// go through the service role — after the route checked the role, or
// after the visit's data was validated.
// ============================================================

import { randomBytes } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingTable } from '@/lib/leads/mappings'
import { isValidSlug, proposeSlug } from './slug'
import { sanitizeDefinition } from './validate'
import type { QuizDefinition, QuizStatus } from './types'

export { isMissingTable }

export const MIGRATION_PENDING =
  'O Quiz ainda não está ativo neste CRM (falta aplicar a migration 072).'

export interface QuizRow {
  id: string
  account_id: string
  name: string
  slug: string
  status: QuizStatus
  draft: unknown
  published: unknown
  published_at: string | null
  created_at: string
  updated_at: string
}

export interface QuizTotals {
  visits: number
  started: number
  completed: number
  leads: number
}

export interface QuizSummary {
  id: string
  name: string
  slug: string
  status: QuizStatus
  publishedAt: string | null
  updatedAt: string
  /** The draft differs from what is live. */
  unpublishedChanges: boolean
  totals: QuizTotals
}

const NO_TOTALS: QuizTotals = { visits: 0, started: 0, completed: 0, leads: 0 }

const COLUMNS =
  'id, account_id, name, slug, status, draft, published, published_at, created_at, updated_at'

function sameDefinition(a: unknown, b: unknown): boolean {
  return JSON.stringify(sanitizeDefinition(a)) === JSON.stringify(sanitizeDefinition(b))
}

export function summarize(row: QuizRow, totals?: QuizTotals): QuizSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    unpublishedChanges: row.published != null && !sameDefinition(row.draft, row.published),
    totals: totals ?? NO_TOTALS,
  }
}

/** The CRM's quizzes with their numbers. null = migration 072 pending. */
export async function listQuizzes(
  db: SupabaseClient,
  accountId: string,
): Promise<QuizSummary[] | null> {
  const { data, error } = await db
    .from('quizzes')
    .select(COLUMNS)
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
  if (error) {
    if (isMissingTable(error)) return null
    throw new Error(error.message)
  }
  const { data: totalRows, error: totalsErr } = await db
    .from('quiz_session_totals')
    .select('quiz_id, visits, started, completed, leads')
    .eq('account_id', accountId)
  if (totalsErr) console.error('[quiz] totals read failed:', totalsErr.message)
  const totals = new Map<string, QuizTotals>()
  for (const row of (totalRows ?? []) as (QuizTotals & { quiz_id: string })[]) {
    totals.set(row.quiz_id, {
      visits: row.visits,
      started: row.started,
      completed: row.completed,
      leads: row.leads,
    })
  }
  return ((data ?? []) as QuizRow[]).map((row) => summarize(row, totals.get(row.id)))
}

export async function getQuiz(
  db: SupabaseClient,
  accountId: string,
  id: string,
): Promise<QuizRow | null> {
  const { data, error } = await db
    .from('quizzes')
    .select(COLUMNS)
    .eq('account_id', accountId)
    .eq('id', id)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error)) return null
    throw new Error(error.message)
  }
  return (data as QuizRow | null) ?? null
}

export class SlugTakenError extends Error {
  constructor() {
    super('Esse endereço já está em uso. Escolha outro.')
    this.name = 'SlugTakenError'
  }
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505'
}

/** A new quiz, as a draft, at an address derived from its name. */
export async function createQuiz(
  admin: SupabaseClient,
  input: { accountId: string; userId: string; name: string; definition: QuizDefinition },
): Promise<QuizRow> {
  // The random tail makes a clash unlikely; try again if it happens.
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await admin
      .from('quizzes')
      .insert({
        account_id: input.accountId,
        name: input.name,
        slug: proposeSlug(input.name, randomBytes(3).toString('hex')),
        draft: input.definition,
        created_by: input.userId,
      })
      .select(COLUMNS)
      .single()
    if (!error) return data as QuizRow
    if (!isUniqueViolation(error)) throw new Error(error.message)
  }
  throw new Error('Não consegui gerar um endereço livre. Tente de novo.')
}

export interface QuizPatch {
  name?: string
  slug?: string
  draft?: QuizDefinition
  status?: QuizStatus
  /** Copy the draft to the live definition. */
  publish?: boolean
}

export async function updateQuiz(
  admin: SupabaseClient,
  accountId: string,
  id: string,
  patch: QuizPatch,
): Promise<QuizRow | null> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.slug !== undefined) {
    if (!isValidSlug(patch.slug)) throw new Error('Endereço inválido.')
    row.slug = patch.slug
  }
  if (patch.draft !== undefined) row.draft = patch.draft
  if (patch.status !== undefined) row.status = patch.status
  if (patch.publish) {
    if (patch.draft === undefined) throw new Error('Publicar pede a definição.')
    row.published = patch.draft
    row.published_at = new Date().toISOString()
    row.status = 'published'
    row.partial_lead = patch.draft.settings.partialLead === true
  }
  if (Object.keys(row).length === 0) return getQuiz(admin, accountId, id)

  const { data, error } = await admin
    .from('quizzes')
    .update(row)
    .eq('account_id', accountId)
    .eq('id', id)
    .select(COLUMNS)
    .maybeSingle()
  if (error) {
    if (isUniqueViolation(error)) throw new SlugTakenError()
    throw new Error(error.message)
  }
  return (data as QuizRow | null) ?? null
}

export async function deleteQuiz(
  admin: SupabaseClient,
  accountId: string,
  id: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('quizzes')
    .delete()
    .eq('account_id', accountId)
    .eq('id', id)
    .select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

// ------------------------------------------------------------
// The public side
// ------------------------------------------------------------

export interface PublishedQuiz {
  id: string
  accountId: string
  name: string
  slug: string
  definition: QuizDefinition
}

/**
 * The quiz a public link opens: only one that is published right now.
 * A draft, a paused quiz and an address nobody uses all read as null,
 * so the page never says which of the three it is.
 */
export async function loadPublishedQuiz(
  admin: SupabaseClient,
  slug: string,
): Promise<PublishedQuiz | null> {
  if (!isValidSlug(slug)) return null
  const { data, error } = await admin
    .from('quizzes')
    .select('id, account_id, name, slug, status, published')
    .eq('slug', slug)
    .maybeSingle()
  if (error) {
    if (!isMissingTable(error)) console.error('[quiz] public read failed:', error.message)
    return null
  }
  const row = data as Pick<QuizRow, 'id' | 'account_id' | 'name' | 'slug' | 'status' | 'published'> | null
  if (!row || row.status !== 'published' || row.published == null) return null
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    slug: row.slug,
    definition: sanitizeDefinition(row.published),
  }
}

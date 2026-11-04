// ============================================================
// Niche templates — reads for the agency console (migration 053).
// Service-role only, like the rest of src/lib/agencia. Before 053 the
// tables don't exist: lists come back null and the UI says so.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingTable } from '@/lib/auth/account-context'
import { isAgencyAccessLevel, type AgencyAccessLevel } from './crm'
import { templateCounts, type TemplateCounts } from './templates'

export interface TemplateRow {
  id: string
  slug: string
  name: string
  niche: string | null
  description: string | null
  suggestedAccess: AgencyAccessLevel
  builtIn: boolean
  active: boolean
  content: unknown
  counts: TemplateCounts
  updatedAt: string
}

const COLUMNS =
  'id, slug, name, niche, description, suggested_access, built_in, active, content, updated_at'

function toRow(r: Record<string, unknown>): TemplateRow {
  return {
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name),
    niche: typeof r.niche === 'string' ? r.niche : null,
    description: typeof r.description === 'string' ? r.description : null,
    suggestedAccess: isAgencyAccessLevel(r.suggested_access) ? r.suggested_access : 'metrics',
    builtIn: r.built_in === true,
    active: r.active === true,
    content: r.content,
    counts: templateCounts(r.content),
    updatedAt: String(r.updated_at),
  }
}

/** All templates, built-in first then by name. null before 053. */
export async function listTemplates(admin: SupabaseClient): Promise<TemplateRow[] | null> {
  const { data, error } = await admin
    .from('crm_templates')
    .select(COLUMNS)
    .order('built_in', { ascending: false })
    .order('name', { ascending: true })
  if (error) {
    if (isMissingTable(error)) return null
    throw error
  }
  return (data ?? []).map((r) => toRow(r as Record<string, unknown>))
}

export async function getTemplate(
  admin: SupabaseClient,
  id: string,
): Promise<TemplateRow | null> {
  const { data, error } = await admin
    .from('crm_templates')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error)) return null
    throw error
  }
  return data ? toRow(data as Record<string, unknown>) : null
}

export interface TemplateApplication {
  templateName: string
  appliedAt: string
  summary: Record<string, unknown>
}

export async function listTemplateApplications(
  admin: SupabaseClient,
  accountId: string,
): Promise<TemplateApplication[]> {
  const { data, error } = await admin
    .from('crm_template_applications')
    .select('template_name, applied_at, summary')
    .eq('account_id', accountId)
    .order('applied_at', { ascending: false })
  if (error) {
    if (isMissingTable(error)) return []
    throw error
  }
  return (data ?? []).map((r) => ({
    templateName: r.template_name,
    appliedAt: r.applied_at,
    summary: (r.summary ?? {}) as Record<string, unknown>,
  }))
}

/** URL-safe, unique enough: "clinica-da-casa-3f9a1c". */
export function templateSlug(name: string, suffix: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return `${base || 'modelo'}-${suffix}`
}

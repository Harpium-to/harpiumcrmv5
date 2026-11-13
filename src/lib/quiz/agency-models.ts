// ============================================================
// The agency's own quiz models (quiz_templates, migration 072).
//
// The agency builds a quiz once, saves it as a model, and every CRM
// finds it in "Novo quiz" next to the built-in ones. A model is a
// definition only — screens, rules, texts. It never carries visits,
// leads, the Pixel ID or anything else that belongs to one CRM.
//
// Server only; reads and writes use the service role, after the route
// checked who is asking.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingTable } from '@/lib/leads/mappings'
import { sanitizeDefinition } from './validate'
import type { QuizDefinition } from './types'

export interface AgencyModelSummary {
  id: string
  name: string
  description: string | null
  updatedAt: string
}

/** A definition with what belongs to one CRM taken out. */
export function asModelDefinition(value: unknown): QuizDefinition {
  const def = sanitizeDefinition(value)
  return {
    ...def,
    appearance: { accent: def.appearance.accent },
    settings: { ...def.settings, pixelId: undefined },
  }
}

export async function listAgencyModels(admin: SupabaseClient): Promise<AgencyModelSummary[]> {
  const { data, error } = await admin
    .from('quiz_templates')
    .select('id, name, description, updated_at')
    .eq('active', true)
    .order('name', { ascending: true })
  if (error) {
    if (!isMissingTable(error)) console.error('[quiz models] list failed:', error.message)
    return []
  }
  return ((data ?? []) as { id: string; name: string; description: string | null; updated_at: string }[]).map(
    (row) => ({ id: row.id, name: row.name, description: row.description, updatedAt: row.updated_at }),
  )
}

export async function loadAgencyModel(
  admin: SupabaseClient,
  id: string,
): Promise<{ name: string; definition: QuizDefinition } | null> {
  const { data, error } = await admin
    .from('quiz_templates')
    .select('name, definition, active')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    if (!isMissingTable(error)) console.error('[quiz models] read failed:', error.message)
    return null
  }
  const row = data as { name: string; definition: unknown; active: boolean } | null
  if (!row || !row.active) return null
  return { name: row.name, definition: asModelDefinition(row.definition) }
}

export async function saveAgencyModel(
  admin: SupabaseClient,
  input: { name: string; description: string | null; definition: unknown; userId: string },
): Promise<string> {
  const { data, error } = await admin
    .from('quiz_templates')
    .insert({
      name: input.name,
      description: input.description,
      definition: asModelDefinition(input.definition),
      created_by: input.userId,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return (data as { id: string }).id
}

export async function updateAgencyModel(
  admin: SupabaseClient,
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<boolean> {
  const { data, error } = await admin.from('quiz_templates').update(patch).eq('id', id).select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

export async function deleteAgencyModel(admin: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await admin.from('quiz_templates').delete().eq('id', id).select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

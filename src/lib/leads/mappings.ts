import type { SupabaseClient } from '@supabase/supabase-js'

import { MAPPABLE_CONTACT_COLUMNS, type FieldMappings } from './ingest'

/** PostgREST / Postgres codes for "this table does not exist (yet)". */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /does not exist|could not find the table/i.test(error.message ?? '')
  )
}

/**
 * The account's "de/para" choices for one origin (migration 068): where
 * each incoming field key goes. Keys without a choice follow the
 * default rule (a custom field with the same name, else the note).
 * Before 068 is applied — or if the read fails — there are no choices.
 */
export async function loadFieldMappings(
  admin: SupabaseClient,
  accountId: string,
  source: string,
): Promise<FieldMappings> {
  const { data, error } = await admin
    .from('lead_field_mappings')
    .select('field_key, target')
    .eq('account_id', accountId)
    .eq('source', source)
  if (error) {
    if (!isMissingTable(error)) console.error('[leads] mappings read failed:', error.message)
    return {}
  }
  const out: FieldMappings = {}
  for (const row of (data ?? []) as { field_key: string; target: string }[]) {
    out[row.field_key] = row.target
  }
  return out
}

const CUSTOM_TARGET = /^custom:[0-9a-f-]{36}$/

/** A target the de/para screen may store (custom ids are checked apart). */
export function isValidTarget(target: string): boolean {
  if (target === 'note' || target === 'ignore') return true
  if (target.startsWith('contact:')) {
    return (MAPPABLE_CONTACT_COLUMNS as readonly string[]).includes(target.slice('contact:'.length))
  }
  return CUSTOM_TARGET.test(target)
}

import type { SupabaseClient } from '@supabase/supabase-js'

import type { FieldMappings } from './ingest'

/**
 * The account's "de/para" choices for one origin: where each incoming
 * field key goes. Empty until the de/para screen (migration 068) is in
 * place — then every key without a choice follows the default rule
 * (a custom field with the same name, else the note).
 */
export async function loadFieldMappings(
  _admin: SupabaseClient,
  _accountId: string,
  _source: string,
): Promise<FieldMappings> {
  return {}
}

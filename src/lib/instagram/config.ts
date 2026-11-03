import type { SupabaseClient } from '@supabase/supabase-js'

export interface InstagramConfigRow {
  account_id: string
  ig_user_id: string | null
  page_id: string | null
  username: string | null
  access_token: string | null // encrypted
  enabled: boolean
}

export const INSTAGRAM_CONFIG_COLUMNS =
  'account_id, ig_user_id, page_id, username, access_token, enabled'

/** An account's Instagram config, or null when there is none. */
export async function getInstagramConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<InstagramConfigRow | null> {
  const { data, error } = await db
    .from('instagram_config')
    .select(INSTAGRAM_CONFIG_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()
  // A missing table (migration 047 unapplied) reads as "no Instagram
  // channel", so every other channel keeps working untouched.
  if (error) return null
  return (data as InstagramConfigRow) ?? null
}

/** True when the account can actually send and receive on Instagram. */
export function isInstagramReady(cfg: InstagramConfigRow | null): boolean {
  return Boolean(cfg?.enabled && cfg.ig_user_id && cfg.access_token)
}

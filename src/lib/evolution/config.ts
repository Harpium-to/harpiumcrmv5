import type { SupabaseClient } from '@supabase/supabase-js'

export interface EvolutionConfigRow {
  account_id: string
  base_url: string | null
  api_key: string | null // encrypted
  instance: string | null
  webhook_token: string
  enabled: boolean
}

/** Load an account's Evolution config, or null if none exists. */
export async function getEvolutionConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<EvolutionConfigRow | null> {
  const { data, error } = await db
    .from('evolution_config')
    .select('account_id, base_url, api_key, instance, webhook_token, enabled')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) {
    // Missing table (migration not applied) or other error → treat as "no
    // Evolution channel" so the Meta path stays the default.
    return null
  }
  return (data as EvolutionConfigRow) ?? null
}

/** True when the account has a usable, enabled Evolution channel. */
export function isEvolutionReady(cfg: EvolutionConfigRow | null): boolean {
  return Boolean(cfg?.enabled && cfg.base_url && cfg.api_key && cfg.instance)
}

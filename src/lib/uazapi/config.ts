import type { SupabaseClient } from '@supabase/supabase-js'

export interface UazapiConfigRow {
  account_id: string
  base_url: string | null
  admin_token: string | null // encrypted
  instance_token: string | null // encrypted
  instance_name: string | null
  status: string
  paired_phone: string | null
  webhook_token: string
  enabled: boolean
}

/** Load an account's UAZAPI config, or null if none exists. */
export async function getUazapiConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<UazapiConfigRow | null> {
  const { data, error } = await db
    .from('uazapi_config')
    .select(
      'account_id, base_url, admin_token, instance_token, instance_name, status, paired_phone, webhook_token, enabled',
    )
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) {
    // Missing table (migration not applied) or other error → treat as "no
    // UAZAPI channel" so the other channels stay the default.
    return null
  }
  return (data as UazapiConfigRow) ?? null
}

/**
 * True when the account has a usable, enabled UAZAPI channel.
 *
 * Deliberately does NOT look at `status`: that column is a cache of what
 * the gateway last reported and can be stale. The gateway rejects sends
 * on an unpaired instance anyway, with a message worth surfacing.
 */
export function isUazapiReady(cfg: UazapiConfigRow | null): boolean {
  return Boolean(cfg?.enabled && cfg.base_url && cfg.instance_token)
}

import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingTable } from './mappings'

// ============================================================
// Which account a lead-URL token belongs to.
//
// Two kinds of token open the door:
//   - named tokens (migration 068), one per origin, revocable one by one;
//   - the account's original token (lead_ingest.token, 039), which keeps
//     working so no integration built before breaks.
// ============================================================

export interface ResolvedToken {
  accountId: string
  googleKey: string | null
  /** Set for a named token (068). */
  tokenId: string | null
  /** The named token's label, e.g. "Quiz planejados". */
  tokenName: string | null
}

export async function resolveIngestToken(
  admin: SupabaseClient,
  token: string,
): Promise<ResolvedToken | null | 'error'> {
  const { data: named, error: namedErr } = await admin
    .from('lead_ingest_tokens')
    .select('id, account_id, name, revoked_at')
    .eq('token', token)
    .maybeSingle()
  if (namedErr && !isMissingTable(namedErr)) {
    console.error('[leads ingest] token lookup failed:', namedErr.message)
  }

  if (named) {
    const row = named as { id: string; account_id: string; name: string; revoked_at: string | null }
    if (row.revoked_at) return null
    const { data: cfg } = await admin
      .from('lead_ingest')
      .select('google_key')
      .eq('account_id', row.account_id)
      .maybeSingle()
    // Best effort: "last used" helps tell a dead integration from a live one.
    const { error: touchErr } = await admin
      .from('lead_ingest_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', row.id)
    if (touchErr) console.warn('[leads ingest] last_used_at failed:', touchErr.message)
    return {
      accountId: row.account_id,
      googleKey: (cfg as { google_key?: string | null } | null)?.google_key ?? null,
      tokenId: row.id,
      tokenName: row.name,
    }
  }

  const { data, error } = await admin
    .from('lead_ingest')
    .select('account_id, google_key')
    .eq('token', token)
    .maybeSingle()
  if (error) {
    console.error('[leads ingest] config lookup failed:', error.message)
    return 'error'
  }
  if (!data) return null
  return {
    accountId: data.account_id,
    googleKey: data.google_key ?? null,
    tokenId: null,
    tokenName: null,
  }
}

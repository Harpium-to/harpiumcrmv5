// ============================================================
// Platform keys — management side, for /agencia/integracoes.
//
// The table has no policies (075): everything goes through the
// service-role client the agency gate hands out, and only a
// super_admin reaches these functions (the routes check).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { generatePlatformKey } from './keys';
import { normalizeScopes, type PlatformScope } from './scopes';

export interface PlatformKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: PlatformScope[];
  createdByEmail: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export async function listPlatformKeys(admin: SupabaseClient): Promise<PlatformKeyRow[]> {
  const { data, error } = await admin
    .from('platform_api_keys')
    .select('id, name, key_prefix, scopes, created_by, created_at, last_used_at, revoked_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  const creatorIds = Array.from(
    new Set(rows.map((r) => r.created_by).filter((v): v is string => typeof v === 'string')),
  );
  const emailById = new Map<string, string | null>();
  if (creatorIds.length > 0) {
    const { data: profs } = await admin
      .from('profiles')
      .select('user_id, email')
      .in('user_id', creatorIds);
    for (const p of (profs ?? []) as Array<{ user_id: string; email: string | null }>) {
      emailById.set(p.user_id, p.email ?? null);
    }
  }

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    prefix: String(r.key_prefix),
    scopes: normalizeScopes(r.scopes),
    createdByEmail:
      typeof r.created_by === 'string' ? (emailById.get(r.created_by) ?? null) : null,
    createdAt: String(r.created_at),
    lastUsedAt: typeof r.last_used_at === 'string' ? r.last_used_at : null,
    revokedAt: typeof r.revoked_at === 'string' ? r.revoked_at : null,
  }));
}

export interface CreatedPlatformKey {
  id: string;
  /** Shown once, never stored. */
  plaintext: string;
  prefix: string;
}

export async function createPlatformKey(
  admin: SupabaseClient,
  input: { name: string; scopes: PlatformScope[]; createdBy: string },
): Promise<CreatedPlatformKey> {
  const key = generatePlatformKey();
  const { data, error } = await admin
    .from('platform_api_keys')
    .insert({
      name: input.name,
      key_prefix: key.prefix,
      key_hash: key.hash,
      scopes: input.scopes,
      created_by: input.createdBy,
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('Falha ao criar a chave');
  return { id: String((data as { id: string }).id), plaintext: key.plaintext, prefix: key.prefix };
}

/** Revoke a key. Returns false when no live key has that id. */
export async function revokePlatformKey(admin: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await admin
    .from('platform_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .is('revoked_at', null)
    .select('id');
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

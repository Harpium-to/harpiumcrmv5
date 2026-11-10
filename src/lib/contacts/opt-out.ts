import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// Contacts who asked not to receive automatic messages (migration 066).
//
// Bulk sends, template broadcasts, sequences and flows started by hand
// leave them out; a message a person writes or schedules by hand still
// goes. Read with `select('*')` where it matters, so code that runs
// before 066 is applied sees "nobody opted out" instead of failing.
// ============================================================

export const OPTED_OUT_MESSAGE =
  'Este contato pediu para não receber mensagens automáticas (descadastro). Desmarque na ficha dele se ele voltar a querer.';

/** True when the row says the contact opted out. */
export function isOptedOut(row: { opted_out_at?: unknown } | null | undefined): boolean {
  return Boolean(row && typeof row.opted_out_at === 'string' && row.opted_out_at);
}

/** Whether this contact of the account opted out. */
export async function contactOptedOut(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<boolean> {
  const { data } = await db
    .from('contacts')
    .select('*')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  return isOptedOut(data as { opted_out_at?: unknown } | null);
}

/** Of these contact ids, the ones that opted out. */
export async function optedOutAmong(
  db: SupabaseClient,
  accountId: string,
  contactIds: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < contactIds.length; i += 500) {
    const { data } = await db
      .from('contacts')
      .select('*')
      .eq('account_id', accountId)
      .in('id', contactIds.slice(i, i + 500));
    for (const c of (data ?? []) as { id: string; opted_out_at?: unknown }[]) {
      if (isOptedOut(c)) out.add(c.id);
    }
  }
  return out;
}

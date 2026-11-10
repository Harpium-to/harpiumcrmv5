// ============================================================
// GET /api/v1/tags — the account's tags (scope: contacts:read)
//
// Not paginated: an account has a few dozen tags, and a caller offering
// them as choices needs the whole list. Sorted by name. To put tags on
// a contact, send their names in `PATCH /api/v1/contacts/{id}` — names
// that don't exist yet are created there.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

/** Far above any real account; a bound, not a page size. */
const MAX_TAGS = 500;

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:read');

    const { data, error } = await ctx.supabase
      .from('tags')
      .select('id, name, color')
      .eq('account_id', ctx.accountId)
      .order('name', { ascending: true })
      .limit(MAX_TAGS);

    if (error) {
      console.error('[api/v1/tags] list error:', error);
      return fail('internal', 'Falha ao listar as etiquetas', 500);
    }

    return ok(
      (data ?? []).map((t) => ({
        id: t.id as string,
        name: t.name as string,
        color: t.color as string,
      }))
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

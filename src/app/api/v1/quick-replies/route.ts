// ============================================================
// GET /api/v1/quick-replies — the account's quick replies
// (scope: quick_replies:read)
//
// The text snippets the team keeps in Configurações › Respostas
// rápidas, sorted by title. Not paginated: an account has a few dozen,
// and a caller offering them as choices needs the whole list.
//
// Only the plain-text ones. An interactive quick reply (buttons, a
// list) is a WhatsApp Business API payload — it can't be typed into a
// message box, which is what the callers of this endpoint do with a
// reply — so it is left out rather than returned half-usable.
//
// `text` may contain `{{nome}}`, `{{primeiro_nome}}` and `{{empresa}}`
// (src/lib/quick-replies/variables.ts). They are returned as written:
// filling them needs the contact, which the caller has.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

/** Far above any real account; a bound, not a page size. */
const MAX_QUICK_REPLIES = 500;

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'quick_replies:read');

    const { data, error } = await ctx.supabase
      .from('quick_replies')
      .select('id, title, content_text')
      .eq('account_id', ctx.accountId)
      .eq('kind', 'text')
      .order('title', { ascending: true })
      .limit(MAX_QUICK_REPLIES);

    if (error) {
      console.error('[api/v1/quick-replies] list error:', error);
      return fail('internal', 'Falha ao listar as respostas rápidas', 500);
    }

    return ok(
      (data ?? [])
        .filter((r) => typeof r.content_text === 'string' && r.content_text.trim() !== '')
        .map((r) => ({
          id: r.id as string,
          title: r.title as string,
          text: r.content_text as string,
        }))
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

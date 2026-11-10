// ============================================================
// GET /api/v1/quick-replies — the account's quick replies
// (scope: quick_replies:read)
//
// The text snippets the team keeps in Configurações › Respostas
// rápidas, sorted by title. Not paginated: an account has a few dozen,
// and a caller offering them as choices needs the whole list.
//
// The plain-text ones; with `?include=media`, also the ones with a file
// (migration 063), which a caller sends through POST /api/v1/messages
// (shape in src/lib/api/v1/quick-replies.ts). An interactive quick
// reply (buttons, a list) is a WhatsApp Business API payload — it can't
// be typed into a message box — so it is left out rather than returned
// half-usable.
//
// `text` may contain `{{nome}}`, `{{primeiro_nome}}` and `{{empresa}}`
// (src/lib/quick-replies/variables.ts). They are returned as written:
// filling them needs the contact, which the caller has.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { serializeQuickReplies, type QuickReplyRow } from '@/lib/api/v1/quick-replies';

/** Far above any real account; a bound, not a page size. */
const MAX_QUICK_REPLIES = 500;

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'quick_replies:read');
    const includeMedia = new URL(request.url).searchParams.get('include') === 'media';

    const list = (columns: string, kinds: string[]) =>
      ctx.supabase
        .from('quick_replies')
        .select(columns)
        .eq('account_id', ctx.accountId)
        .in('kind', kinds)
        .order('title', { ascending: true })
        .limit(MAX_QUICK_REPLIES);

    let { data, error } = includeMedia
      ? await list('id, title, kind, content_text, media_kind, media_url, media_filename', [
          'text',
          'media',
        ])
      : await list('id, title, kind, content_text', ['text']);
    // Before migration 063 the file columns don't exist: the text
    // replies are still worth returning.
    if (error && includeMedia) {
      ({ data, error } = await list('id, title, kind, content_text', ['text']));
    }

    if (error) {
      console.error('[api/v1/quick-replies] list error:', error);
      return fail('internal', 'Falha ao listar as respostas rápidas', 500);
    }

    return ok(serializeQuickReplies((data ?? []) as unknown as QuickReplyRow[], includeMedia));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

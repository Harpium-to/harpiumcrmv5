// ============================================================
// GET /api/v1/deals — list deals (scope: deals:read)
//
// Keyset-paginated (newest first). Filters: `?contact_id=`,
// `?pipeline_id=` and `?status=` (open / won / lost). Each deal embeds
// its stage and pipeline.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
import { DEAL_SELECT, DEAL_STATUSES, serializeDeal } from '@/lib/api/v1/deals';
import type { ApiDealStatus } from '@/lib/api/v1/deals';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const contactId = url.searchParams.get('contact_id');
    const pipelineId = url.searchParams.get('pipeline_id');
    const status = url.searchParams.get('status');

    if (status && !DEAL_STATUSES.includes(status as ApiDealStatus)) {
      return fail(
        'bad_request',
        `'status' must be one of ${DEAL_STATUSES.join(', ')}`,
        400
      );
    }

    let query = ctx.supabase
      .from('deals')
      .select(DEAL_SELECT)
      .eq('account_id', ctx.accountId);

    if (contactId) query = query.eq('contact_id', contactId);
    if (pipelineId) query = query.eq('pipeline_id', pipelineId);
    if (status) query = query.eq('status', status);

    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      // A malformed id filter is the caller's mistake, not ours.
      if (error.code === '22P02') {
        return fail('bad_request', 'contact_id and pipeline_id must be ids', 400);
      }
      console.error('[api/v1/deals] list error:', error);
      return fail('internal', 'Failed to list deals', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as Array<{ created_at: string; id: string }>,
      limit
    );
    return okList(
      items.map((r) => serializeDeal(r as unknown as Record<string, unknown>)),
      nextCursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

// ============================================================
// GET /api/v1/pipelines — list pipelines with their stages
// (scope: deals:read)
//
// Not paginated: an account has a handful of pipelines, and a caller
// moving a deal needs the whole list of stages to offer as targets.
// Stages come in board order (`position`).
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { serializePipeline } from '@/lib/api/v1/deals';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:read');

    const { data, error } = await ctx.supabase
      .from('pipelines')
      .select('id, name, created_at, stages:pipeline_stages(id, name, color, position)')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[api/v1/pipelines] list error:', error);
      return fail('internal', 'Failed to list pipelines', 500);
    }

    return ok(
      (data ?? []).map((r) =>
        serializePipeline(r as unknown as Record<string, unknown>)
      )
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

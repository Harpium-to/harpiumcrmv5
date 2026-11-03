// ============================================================
// GET   /api/v1/deals/{id} — read a deal   (scope: deals:read)
// PATCH /api/v1/deals/{id} — update a deal (scope: deals:write)
//
// Both are account-scoped: a deal belonging to another account returns
// 404. PATCH updates only the fields present in the body: `stage_id`
// (must be a stage of the deal's own pipeline), `status`, `title`,
// `value`, `notes`, `expected_close_date`. Moving stage is the same
// write the Kanban drag makes; `closed_at` is stamped by the database
// trigger (migration 046), not here.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  getDealById,
  parseDealPatch,
  stageBelongsToPipeline,
} from '@/lib/api/v1/deals';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'deals:read');
    const { id } = await params;
    const deal = await getDealById(ctx.supabase, ctx.accountId, id);
    if (!deal) return fail('not_found', 'Negócio não encontrado', 404);
    return ok(deal);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'deals:write');
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return fail('bad_request', 'O corpo da requisição precisa ser um objeto JSON', 400);
    }

    const patch = parseDealPatch(body);
    if (!patch.ok) return fail('bad_request', patch.message, 400);
    const { updates } = patch;

    // Verify the deal is in this account before mutating anything.
    const existing = await getDealById(ctx.supabase, ctx.accountId, id);
    if (!existing) return fail('not_found', 'Negócio não encontrado', 404);

    if (typeof updates.stage_id === 'string' && existing.pipeline) {
      const valid = await stageBelongsToPipeline(
        ctx.supabase,
        updates.stage_id,
        existing.pipeline.id
      );
      if (!valid) {
        return fail(
          'bad_request',
          "'stage_id' precisa ser uma etapa do funil do próprio negócio",
          400
        );
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      const { error } = await ctx.supabase
        .from('deals')
        .update(updates)
        .eq('id', id)
        .eq('account_id', ctx.accountId);
      if (error) {
        console.error('[api/v1/deals] update error:', error);
        return fail('internal', 'Falha ao atualizar o negócio', 500);
      }
    }

    const deal = await getDealById(ctx.supabase, ctx.accountId, id);
    return ok(deal);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

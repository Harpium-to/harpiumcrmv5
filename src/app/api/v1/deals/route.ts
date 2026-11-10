// ============================================================
// GET  /api/v1/deals — list deals   (scope: deals:read)
// POST /api/v1/deals — open a deal  (scope: deals:write)
//
// List is keyset-paginated (newest first). Filters: `?contact_id=`,
// `?pipeline_id=` and `?status=` (open / won / lost). Each deal embeds
// its stage and pipeline.
//
// Create takes `contact_id` and `title`, and optionally `value`,
// `notes`, `expected_close_date`, `pipeline_id` and `stage_id`. With no
// stage it lands on the first stage of the pipeline (the account's
// first pipeline, if none is named) — the same place a new card starts
// on the board. The deal is always created open, in the account's
// default currency.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
import {
  DEAL_SELECT,
  DEAL_STATUSES,
  parseDealCreate,
  resolveDealPlacement,
  serializeDeal,
} from '@/lib/api/v1/deals';
import type { ApiDealStatus } from '@/lib/api/v1/deals';
import { ContactError, getContactById, resolveAuditUserId } from '@/lib/api/v1/contacts';

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
        `'status' precisa ser um destes: ${DEAL_STATUSES.join(', ')}`,
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
        return fail('bad_request', 'contact_id e pipeline_id precisam ser IDs', 400);
      }
      console.error('[api/v1/deals] list error:', error);
      return fail('internal', 'Falha ao listar os negócios', 500);
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

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:write');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return fail('bad_request', 'O corpo da requisição precisa ser um objeto JSON', 400);
    }

    const parsed = parseDealCreate(body);
    if (!parsed.ok) return fail('bad_request', parsed.message, 400);
    const { values } = parsed;

    const contact = await getContactById(ctx.supabase, ctx.accountId, values.contact_id);
    if (!contact) {
      return fail('bad_request', "'contact_id' precisa ser um contato deste CRM", 400);
    }

    const placement = await resolveDealPlacement(
      ctx.supabase,
      ctx.accountId,
      values.pipeline_id,
      values.stage_id
    );
    if (!placement.ok) return fail('bad_request', placement.message, 400);

    const auditUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);
    const { data: account } = await ctx.supabase
      .from('accounts')
      .select('default_currency')
      .eq('id', ctx.accountId)
      .maybeSingle();

    const { data, error } = await ctx.supabase
      .from('deals')
      .insert({
        account_id: ctx.accountId,
        user_id: auditUserId,
        contact_id: contact.id,
        pipeline_id: placement.pipeline_id,
        stage_id: placement.stage_id,
        title: values.title,
        value: values.value,
        // Same fallback as a deal opened by an automation.
        currency: (account?.default_currency as string | undefined) ?? 'USD',
        notes: values.notes,
        expected_close_date: values.expected_close_date,
        status: 'open',
      })
      .select(DEAL_SELECT)
      .single();

    if (error || !data) {
      console.error('[api/v1/deals] create error:', error);
      return fail('internal', 'Falha ao criar o negócio', 500);
    }
    return ok(serializeDeal(data as unknown as Record<string, unknown>), 201);
  } catch (err) {
    if (err instanceof ContactError) {
      return fail(err.status === 400 ? 'bad_request' : 'internal', err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}

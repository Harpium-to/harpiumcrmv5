// ============================================================
// GET   /api/v1/contacts/{id} — read a contact  (scope: contacts:read)
// PATCH /api/v1/contacts/{id} — update a contact (scope: contacts:write)
//
// Both are account-scoped: a contact belonging to another account
// returns 404 (never 403 — don't reveal it exists elsewhere).
// PATCH updates only the fields present in the body — contact details
// plus the lead-qualification fields from migration 045 (temperature,
// potential, segment, source, …); pass `tags` (an array of tag names)
// to replace the contact's tags.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  getContactById,
  parseContactPatch,
  QUALIFICATION_FIELDS,
  setContactTags,
  resolveAuditUserId,
  ContactError,
} from '@/lib/api/v1/contacts';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'contacts:read');
    const { id } = await params;
    const contact = await getContactById(ctx.supabase, ctx.accountId, id);
    if (!contact) return fail('not_found', 'Contato não encontrado', 404);
    return ok(contact);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'contacts:write');
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'O corpo da requisição precisa ser um objeto JSON', 400);
    }

    // Verify the contact is in this account before mutating anything.
    const existing = await getContactById(ctx.supabase, ctx.accountId, id);
    if (!existing) return fail('not_found', 'Contato não encontrado', 404);

    const patch = parseContactPatch(body);
    if (!patch.ok) return fail('bad_request', patch.message, 400);
    const { updates } = patch;

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      const { error } = await ctx.supabase
        .from('contacts')
        .update(updates)
        .eq('id', id)
        .eq('account_id', ctx.accountId);
      if (error) {
        // PGRST204: PostgREST doesn't know the column — the deployment
        // hasn't applied migration 045. Say so instead of a bare 500.
        const missing = QUALIFICATION_FIELDS.filter((f) => f in updates);
        if (error.code === 'PGRST204' && missing.length > 0) {
          return fail(
            'bad_request',
            `Not available on this deployment yet: ${missing.join(', ')}`,
            400
          );
        }
        console.error('[api/v1/contacts] update error:', error);
        return fail('internal', 'Falha ao atualizar o contato', 500);
      }
    }

    if (Array.isArray(body.tags)) {
      const auditUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);
      await setContactTags(
        ctx.supabase,
        ctx.accountId,
        auditUserId,
        id,
        body.tags.filter((t): t is string => typeof t === 'string')
      );
    }

    const contact = await getContactById(ctx.supabase, ctx.accountId, id);
    return ok(contact);
  } catch (err) {
    if (err instanceof ContactError) {
      return fail(err.status === 400 ? 'bad_request' : 'internal', err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}

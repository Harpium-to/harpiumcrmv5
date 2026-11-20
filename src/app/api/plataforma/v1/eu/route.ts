// ============================================================
// GET /api/plataforma/v1/eu — the connection test.
//
// Any valid platform key. Answers who the X-Harpium-Pessoa e-mail is
// in the CRM (and whether they are agency) and what the key may do.
// The Agency OS calls it when connecting and to show each person
// whether they have a CRM login.
// ============================================================

import { requirePlatformKey } from '@/lib/plataforma/auth';
import { ok, toPlatformErrorResponse } from '@/lib/plataforma/errors';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const ctx = await requirePlatformKey(request);
    return ok({
      person: {
        id: ctx.person.userId,
        email: ctx.person.email,
        name: ctx.person.name,
        agencyRole: ctx.person.agencyRole,
      },
      key: { id: ctx.keyId, name: ctx.keyName, scopes: ctx.scopes },
    });
  } catch (err) {
    return toPlatformErrorResponse(err);
  }
}

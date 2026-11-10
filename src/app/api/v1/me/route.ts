// ============================================================
// GET /api/v1/me — public API identity probe.
//
// The reference endpoint for the public API: it requires nothing
// but a valid key (no scope), and returns the account the key is
// bound to plus the scopes it carries. For a personal key (the Chrome
// extension's), also the person it belongs to — the extension signs
// messages with that name. Integrators use it to verify
// their key works and to discover what it's allowed to do before
// wiring up real calls.
//
// It also exercises the entire public-API stack end to end — bearer
// parse → hash lookup → liveness → rate limit → envelope — so a
// green response here means the plumbing every future endpoint
// depends on is sound.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { getAccountName, getKeyPerson } from '@/lib/api-keys/store';
import { ok, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request);
    const [name, person] = await Promise.all([
      getAccountName(ctx.accountId),
      getKeyPerson(ctx.keyId),
    ]);
    return ok({
      account: { id: ctx.accountId, name },
      key: { id: ctx.keyId, scopes: ctx.scopes },
      person,
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

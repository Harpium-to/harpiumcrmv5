// ============================================================
// Owner-invitation token for a CRM the agency creates or hands over.
//
// Same scheme as every invitation (src/lib/auth/invitations.ts): the
// plaintext token leaves the server exactly once, in this response;
// only its hash reaches the database. The link is also addressed to
// one email (migration 050), so a forwarded link is useless to anyone
// else — and the invitee sees it inside the app even without it.
// ============================================================

import { resolvePublicOrigin } from '@/lib/http/base-url'
import {
  generateInviteToken,
  inviteExpiresAt,
  inviteUrl,
} from '@/lib/auth/invitations'

/** Owner invitations live longer than team ones: onboarding takes days. */
export const OWNER_INVITE_DAYS = 14

export function newOwnerInvite(): {
  token: string
  hash: string
  expiresAt: Date
} {
  const { token, hash } = generateInviteToken()
  return { token, hash, expiresAt: inviteExpiresAt(OWNER_INVITE_DAYS) }
}

/**
 * Full link when the request's public origin is known; otherwise just
 * the path, and the console (same origin as the app) completes it.
 */
export function ownerInviteLink(
  request: Request,
  token: string,
  label: string,
): { url: string | null; path: string } {
  const origin = resolvePublicOrigin(request, label)
  return {
    url: origin ? inviteUrl(token, origin) : null,
    path: `/join/${token}`,
  }
}

// ============================================================
// This CRM's public address, for the Google Agenda routes.
//
// On Netlify, `request.url` carries the deploy's own host
// (<hash>--harpium-crm.netlify.app), not the address people use.
// Nobody is signed in there, so sending someone back to it after the
// Google sign-in lands them on the login page — and a link to a
// contact's record written into Google would point there too.
// NEXT_PUBLIC_SITE_URL (set on every deploy) wins; the forwarded host
// is the fallback (lib/http/base-url.ts), the request's own last.
// ============================================================

import { resolvePublicOrigin } from '@/lib/http/base-url'

export function crmOrigin(request: Request): string {
  return resolvePublicOrigin(request, 'google agenda') ?? new URL(request.url).origin
}

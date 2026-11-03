// ============================================================
// Resolve the public origin a request arrived on.
//
// Extracted from the invitations route, which needed it to publish
// invite links; the UAZAPI channel needs the same answer to tell the
// gateway where to POST inbound messages. Both are cases where getting
// the host wrong sends something valuable to the wrong server, so the
// host-spoofing defence below is shared rather than reimplemented.
//
// Resolution order, first match wins:
//
//   1. `NEXT_PUBLIC_SITE_URL` — operator's explicit config. Trumps
//      everything.
//   2. `X-Forwarded-Host` (+ `X-Forwarded-Proto`) — set by every
//      reverse proxy in front of the app: Netlify, Vercel, Cloudflare,
//      nginx, Hostinger Managed Node.js. This is what makes things Just
//      Work in production without forcing an env var.
//   3. `Host` header + the protocol the request arrived on — bare
//      deployments with no proxy.
//   4. Nothing — returns null. Callers decide: the invite path falls
//      back to a marketing domain, the webhook path refuses outright,
//      because pointing a gateway at the wrong host leaks customer
//      messages.
//
// Defence-in-depth: `ALLOWED_INVITE_HOSTS`
//
//   Paths #2 and #3 trust a header the client (or proxy) controls. On a
//   proxied deploy the proxy overwrites them, so they are trustworthy.
//   On a bare deployment an attacker could send `Host: phishing.example`
//   and have us hand back a URL on their domain. When the env var is set
//   (comma-separated hostnames) the derived host must be on the list.
//   Unset keeps the permissive legacy behaviour.
//
//   The name is historical — it predates this extraction and operators
//   already set it — so it still gates both callers.
// ============================================================

function parseAllowedHosts(): readonly string[] | null {
  const raw = process.env.ALLOWED_INVITE_HOSTS?.trim()
  if (!raw) return null
  const list = raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  return list.length > 0 ? list : null
}

function isHostAllowed(
  hostname: string,
  allowList: readonly string[] | null,
): boolean {
  if (!allowList) return true // No allow-list → permissive (legacy behaviour).
  return allowList.includes(hostname.toLowerCase())
}

/**
 * The origin (`https://host`, no trailing slash) this request should be
 * addressed by, or null when it cannot be derived safely.
 *
 * `logLabel` identifies the caller in the warning that a rejected or
 * missing host produces — that warning is the operator's signal that
 * someone is probing with a spoofed Host header.
 */
export function resolvePublicOrigin(
  request: Request,
  logLabel: string,
): string | null {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')

  const allowList = parseAllowedHosts()
  const forwardedHost = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    ?.trim()
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
  if (forwardedHost && isHostAllowed(forwardedHost, allowList)) {
    return `${forwardedProto || 'https'}://${forwardedHost}`
  }

  const host = request.headers.get('host')?.trim()
  if (host && isHostAllowed(host, allowList)) {
    // The protocol on `request.url` is whatever the framework saw —
    // reliable for bare deployments where no proxy is rewriting it.
    const reqProto = new URL(request.url).protocol.replace(':', '')
    return `${reqProto}://${host}`
  }

  if (allowList && (forwardedHost || host)) {
    console.warn(`[${logLabel}] rejected non-allow-listed host:`, {
      forwardedHost,
      host,
      allowList,
    })
  } else {
    console.warn(`[${logLabel}] could not derive base URL from request`)
  }
  return null
}

// ============================================================
// Where a redirect may send someone inside the CRM.
//
// One rule for three places: the `next` of /login (after signing in),
// the proxy that sends a signed-out person to /login, and the `ir` of
// /abrir (the "Abrir no CRM" button of the agency's internal system).
// Only same-site paths under a known screen pass; anything else —
// `//evil.com`, `https://…`, `/\evil`, `javascript:`, unknown paths —
// falls back. That is what keeps these redirects from being "open".
// ============================================================

/** Screens a deep link (`/abrir?ir=`) may open. */
export const DEEP_LINK_PREFIXES = [
  '/dashboard',
  '/inbox',
  '/contacts',
  '/leads',
  '/pipelines',
  '/agenda',
  '/relatorios',
  '/automations',
  '/agents',
  '/flows',
  '/broadcasts',
  '/canais',
  '/settings',
  '/ferramentas',
  '/notifications',
  '/ajuda',
  '/agencia',
] as const

/** Where /login may continue to: the deep links, plus /abrir itself. */
export const LOGIN_NEXT_PREFIXES = [...DEEP_LINK_PREFIXES, '/abrir', '/aguardando'] as const

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/**
 * A safe same-site path (pathname + search + hash) or `fallback`.
 */
export function safeNextPath(
  value: unknown,
  opts: { prefixes?: readonly string[]; fallback?: string } = {},
): string {
  const fallback = opts.fallback ?? '/dashboard'
  const prefixes = opts.prefixes ?? DEEP_LINK_PREFIXES
  if (typeof value !== 'string') return fallback
  const v = value.trim()
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\')) return fallback
  // Control characters (tabs and newlines are dropped by URL parsers).
  if (/[\u0000-\u001f\u007f]/.test(v)) return fallback
  let url: URL
  try {
    url = new URL(v, 'https://crm.invalid')
  } catch {
    return fallback
  }
  if (url.origin !== 'https://crm.invalid') return fallback
  if (!matchesPrefix(url.pathname, prefixes)) return fallback
  return `${url.pathname}${url.search}${url.hash}`
}

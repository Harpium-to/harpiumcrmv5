// ============================================================
// Send people who open the CRM on its old Netlify address to the
// address it lives on now (NEXT_PUBLIC_SITE_URL, e.g.
// https://crm.harpium.com.br). See docs/plano-troca-dominio-crm.md.
//
// Why: Google Agenda's return, invite links and "Abrir no CRM" all
// point at NEXT_PUBLIC_SITE_URL. Someone still signed in on
// harpium-crm.netlify.app would land on the new host without a
// session (cookies are per host) and hit the login mid-flow.
//
// What is NOT redirected, on purpose:
//   - /api/* — Meta and UAZAPI webhooks, lead intake URLs handed to
//     clients, the Agency OS platform API and the Chrome extension all
//     keep answering on the old address. A redirect would break POSTs.
//   - anything but GET/HEAD.
//   - deploy previews and branch deploys (<x>--site.netlify.app).
//   - any host that is not a bare *.netlify.app — custom domains such
//     as the quiz domain are left alone.
// With NEXT_PUBLIC_SITE_URL unset, or on the netlify.app host itself,
// this does nothing, so it is safe to ship before the domain switch.
// ============================================================

export function canonicalHostRedirect(input: {
  method: string
  host: string | null
  pathname: string
  search: string
}): URL | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (!raw || !input.host) return null

  let site: URL
  try {
    site = new URL(raw)
  } catch {
    return null
  }

  const method = input.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return null

  const host = input.host.toLowerCase().split(':')[0]
  if (!host.endsWith('.netlify.app') || host.includes('--')) return null
  if (host === site.hostname.toLowerCase()) return null

  const { pathname } = input
  if (pathname === '/api' || pathname.startsWith('/api/')) return null

  const target = new URL(site.origin)
  target.pathname = pathname
  target.search = input.search
  return target
}

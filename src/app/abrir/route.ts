// ============================================================
// GET /abrir?crm=<accountId>&ir=<path> — the "Abrir no CRM" button of
// the agency's internal system (docs/plano-integracao-agency-os.md §5.5).
//
// Every link the platform API hands back goes through here: it makes
// `crm` the person's active CRM, then opens `ir` (a lead, a deal, a
// conversation, a settings screen). The active CRM is the person's,
// not the tab's — opening a client's CRM switches what they see in
// every tab of the CRM after a reload.
//
//   not signed in        → the proxy sends them to /login?next=<this>
//   `ir` not a known screen → /dashboard (no open redirect)
//   switch allowed       → `ir`  (set_active_account audits the agency)
//   refused, agency      → /agencia/<crm> (numbers + "Pedir acesso")
//   refused, otherwise   → /abrir/sem-acesso
// ============================================================

import { NextResponse } from 'next/server'

import { DEEP_LINK_PREFIXES, safeNextPath } from '@/lib/http/next-path'
import { isUuid } from '@/lib/plataforma/access'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const crm = url.searchParams.get('crm')
  const ir = safeNextPath(url.searchParams.get('ir'), {
    prefixes: DEEP_LINK_PREFIXES,
    fallback: '/dashboard',
  })
  const go = (path: string) => NextResponse.redirect(new URL(path, request.url))

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    const back = `/abrir${url.search}`
    return go(`/login?next=${encodeURIComponent(back)}`)
  }

  // Nothing to switch: no CRM named, or a page of the agency console.
  if (!crm || !isUuid(crm) || ir.startsWith('/agencia')) return go(ir)

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if ((profile as { account_id?: string | null } | null)?.account_id === crm) return go(ir)

  const { error } = await supabase.rpc('set_active_account', { p_account_id: crm })
  if (!error) return go(ir)

  const { data: isAgencia } = await supabase.rpc('is_agencia')
  if (isAgencia === true) return go(`/agencia/${crm}`)
  return go(`/abrir/sem-acesso?crm=${encodeURIComponent(crm)}`)
}

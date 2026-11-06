// ============================================================
// /aguardando — signed in, but no CRM yet.
//
// Where someone lands when signup no longer creates a CRM (platform
// flag off, 049) or when they were removed from their last CRM. It
// lists invitations addressed to their email (050) so they can accept
// without the link, and otherwise tells them the agency will release
// access. Anyone who does have an active CRM is sent to the dashboard.
// ============================================================

import { redirect } from 'next/navigation'

import { isMissingFunction, parseAccountContext } from '@/lib/auth/account-context'
import { createClient } from '@/lib/supabase/server'
import type { MyInvitation } from '@/types/platform'
import { WaitingCard } from './waiting-card'

export const dynamic = 'force-dynamic'

export default async function AguardandoPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const ctx = await supabase.rpc('current_account_context')
  if (!ctx.error && parseAccountContext(ctx.data)) redirect('/dashboard')
  if (ctx.error && isMissingFunction(ctx.error)) {
    // Before 049 everyone has a CRM; nothing to wait for.
    redirect('/dashboard')
  }

  const [agencyRes, invitesRes] = await Promise.all([
    supabase.rpc('is_agencia'),
    supabase.rpc('my_pending_invitations'),
  ])

  const invitations: MyInvitation[] = invitesRes.error
    ? []
    : ((invitesRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        id: String(r.invitation_id),
        accountName: String(r.account_name ?? ''),
        role: String(r.role ?? ''),
        expiresAt: String(r.expires_at ?? ''),
        agencyLevel: typeof r.agency_level === 'string' ? r.agency_level : null,
      }))

  return (
    <WaitingCard
      email={user.email ?? null}
      isAgencia={agencyRes.data === true}
      invitations={invitations}
    />
  )
}

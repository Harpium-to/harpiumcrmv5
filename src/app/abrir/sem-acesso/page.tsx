// ============================================================
// /abrir/sem-acesso — an "Abrir no CRM" link to a CRM this login can't
// open. Says which e-mail is signed in (the usual cause is being signed
// in with another account) and offers to switch accounts.
// ============================================================

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { Glow } from '@/components/ui/glow'
import { createClient } from '@/lib/supabase/server'

import { SwitchAccountButton } from './switch-account-button'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Sem acesso a este CRM',
  robots: { index: false, follow: false, nocache: true },
}

export default async function SemAcessoPage({
  searchParams,
}: {
  searchParams: Promise<{ crm?: string }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { crm } = await searchParams

  return (
    <div className="bg-background relative isolate flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <Glow className="-top-32 left-1/2 h-[32rem] w-[32rem] -translate-x-1/2" />
      <div className="border-border bg-card w-full max-w-md space-y-4 rounded-2xl border p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold">Você não tem acesso a este CRM</h1>
        <p className="text-muted-foreground text-sm">
          Você entrou como <span className="text-foreground font-medium">{user.email}</span>. Esta
          conta não faz parte do CRM que o link pediu. Se você usa outro e-mail neste CRM, saia e
          entre com ele. Se deveria ter acesso, peça um convite ao dono do CRM.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <a
            href="/dashboard"
            className="border-border hover:bg-muted inline-flex items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium"
          >
            Ir para o meu CRM
          </a>
          <SwitchAccountButton crm={crm ?? null} />
        </div>
      </div>
    </div>
  )
}

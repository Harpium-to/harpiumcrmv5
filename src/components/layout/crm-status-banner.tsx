'use client'

import { useEffect, useState } from 'react'
import { PauseCircle } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'

/**
 * Explains a suspended CRM (migration 050). The database already
 * refuses every write; without this the person would only see actions
 * failing one by one.
 *
 * Reads `accounts.status` on its own, ignoring errors, instead of
 * adding the column to the AuthProvider's account query — a select
 * naming a column that doesn't exist yet (050 not applied) would fail
 * that whole query and blank the account everywhere.
 */
export function CrmStatusBanner({ accountId }: { accountId: string | null }) {
  const [suspended, setSuspended] = useState(false)

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    createClient()
      .from('accounts')
      .select('status')
      .eq('id', accountId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        setSuspended(!error && data?.status === 'suspended')
      })
    return () => {
      cancelled = true
    }
  }, [accountId])

  if (!suspended) return null

  return (
    <div
      role="status"
      className="mx-3 mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm sm:mx-4"
    >
      <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      <p>
        <span className="font-medium">Este CRM está suspenso.</span> Você
        continua vendo tudo, mas nada pode ser alterado ou enviado. Mensagens
        que chegam continuam sendo recebidas. Fale com a agência para reativar.
      </p>
    </div>
  )
}

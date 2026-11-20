'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, LogOut } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'

/** Sign out and come back to the same link after signing in again. */
export function SwitchAccountButton({ crm }: { crm: string | null }) {
  const [busy, setBusy] = useState(false)
  const router = useRouter()
  const onClick = async () => {
    setBusy(true)
    await createClient().auth.signOut()
    const back = crm ? `/abrir?crm=${encodeURIComponent(crm)}&ir=%2Fdashboard` : '/dashboard'
    router.push(`/login?next=${encodeURIComponent(back)}`)
    router.refresh()
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="bg-foreground text-background inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
      Sair e entrar com outra conta
    </button>
  )
}

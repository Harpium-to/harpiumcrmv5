'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Headset, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

/**
 * Support mode (Fase 6): open the client's CRM itself, with the role
 * the owner's consent gives this operator. The entry is audited, every
 * change made inside is audited, and the CRM shows a banner with the
 * way out.
 */
export function EnterCrmButton({
  accountId,
  as,
}: {
  accountId: string
  /** What the operator will be inside: admin (Total) or viewer (Leitura). */
  as: 'admin' | 'viewer'
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const enter = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/account/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Falha ao entrar no CRM')
      router.push('/dashboard')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao entrar no CRM')
      setBusy(false)
    }
  }

  return (
    <Button onClick={enter} disabled={busy} variant={as === 'admin' ? 'default' : 'outline'}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Headset className="h-4 w-4" />}
      {as === 'admin' ? 'Entrar no CRM (Total)' : 'Entrar no CRM (só leitura)'}
    </Button>
  )
}

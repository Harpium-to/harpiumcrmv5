'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Headset, Loader2, LogOut, PauseCircle } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

export interface CrmContext {
  accountName: string
  role: string
  status: string
  viaAgency: boolean
}

/**
 * Banners about the CRM that is open, from the server's view of it
 * (/api/account/context — the profile mirror on the client can't tell
 * support mode apart, nor follow a grant expiring):
 *
 *   - support mode (Fase 6): the agency is inside a client CRM. Always
 *     visible, says that everything is recorded, and offers the way out.
 *   - suspended (Fase 2): read-only, with why.
 */
export function CrmContextBanner({ accountId }: { accountId: string | null }) {
  const [ctx, setCtx] = useState<CrmContext | null>(null)

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    fetch('/api/account/context', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled) setCtx(json)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [accountId])

  return <CrmContextBannerView ctx={ctx} />
}

export function CrmContextBannerView({ ctx }: { ctx: CrmContext | null }) {
  const router = useRouter()
  const [leaving, setLeaving] = useState(false)

  if (!ctx) return null

  const leave = async () => {
    setLeaving(true)
    try {
      const res = await fetch('/api/account/leave-support', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Falha ao sair')
      router.push('/agencia')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao sair')
      setLeaving(false)
    }
  }

  return (
    <>
      {ctx.viaAgency && (
        <div
          role="status"
          className="mx-3 mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm sm:mx-4"
        >
          <Headset className="h-4 w-4 shrink-0 text-primary" />
          <p className="min-w-0 flex-1">
            <span className="font-medium">Modo suporte:</span> você está no CRM{' '}
            <span className="font-medium">{ctx.accountName}</span> pela agência, como{' '}
            {ctx.role === 'admin' ? 'administrador' : 'leitura'}. Tudo o que você
            alterar aqui fica registrado para o dono.
          </p>
          <Button size="sm" variant="outline" onClick={leave} disabled={leaving}>
            {leaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            Sair do modo suporte
          </Button>
        </div>
      )}
      {ctx.status === 'suspended' && (
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
      )}
    </>
  )
}

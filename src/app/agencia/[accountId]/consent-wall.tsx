import Link from 'next/link'
import { ArrowLeft, ShieldOff } from 'lucide-react'

import type { ConsentGate } from '@/lib/agencia/consent'
import { RequestAccessForm } from './request-access'

/**
 * Shown instead of a client's contacts / conversations / pipeline when
 * the CRM owner granted the agency only metrics. Nothing with personal
 * data was read to render this page.
 */
export function ConsentWall({
  accountId,
  gate,
  what,
}: {
  accountId: string
  gate: ConsentGate
  /** "os contatos", "as conversas"… */
  what: string
}) {
  return (
    <div className="space-y-6">
      <Link
        href={`/agencia/${accountId}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar ao CRM
      </Link>
      <div className="mx-auto max-w-xl space-y-4 rounded-xl border border-border bg-card p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <ShieldOff className="h-5 w-5 text-muted-foreground" />
          </span>
          <div>
            <h1 className="text-lg font-semibold">
              O dono deste CRM liberou só Métricas
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              A agência vê números de uso, mas não {what}. Para ver, o dono
              precisa liberar Leitura ou Total.
            </p>
          </div>
        </div>
        <RequestAccessForm
          accountId={accountId}
          currentLevel={gate.level}
          pending={gate.pending}
          canRequest={gate.canRequest}
          hasOwner={gate.hasOwner}
        />
      </div>
    </div>
  )
}

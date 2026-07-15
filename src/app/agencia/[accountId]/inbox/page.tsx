import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

import { requireAgencia } from '@/lib/agencia/guard'
import { listAccountConversations } from '@/lib/agencia/queries'
import { BackToAccount, Pager, parsePage } from '../parts'

export const dynamic = 'force-dynamic'

export default async function AgenciaInboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { accountId } = await params
  const page = parsePage((await searchParams).page)
  const { admin } = await requireAgencia()
  const { rows, total, pageSize } = await listAccountConversations(
    admin,
    accountId,
    page,
  )

  const basePath = `/agencia/${accountId}/inbox`

  return (
    <div className="space-y-5">
      <div>
        <BackToAccount accountId={accountId} />
        <h1 className="mt-2 text-2xl font-bold">Inbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {total.toLocaleString()} conversa{total === 1 ? '' : 's'} · somente
          leitura
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Nenhuma conversa.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <ul className="divide-y divide-border">
            {rows.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/agencia/${accountId}/inbox/${c.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">
                        {c.contactName ?? 'Desconhecido'}
                      </p>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {c.lastMessageAt ? formatWhen(c.lastMessageAt) : ''}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {c.status}
                      </span>
                      {c.lastMessageText && (
                        <span className="truncate text-xs text-muted-foreground">
                          {c.lastMessageText}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Pager basePath={basePath} page={page} total={total} pageSize={pageSize} />
    </div>
  )
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

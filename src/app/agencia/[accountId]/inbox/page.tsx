import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

import { requireAgencia } from '@/lib/agencia/guard'
import { loadConsentGate } from '@/lib/agencia/consent'
import { ConsentWall } from '../consent-wall'
import {
  listAccountConversations,
  type ConversationStatusFilter,
} from '@/lib/agencia/queries'
import { BackToAccount, Pager, SearchForm, parsePage } from '../parts'

export const dynamic = 'force-dynamic'

const STATUS_TABS: { value: ConversationStatusFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'open', label: 'Abertas' },
  { value: 'pending', label: 'Pendentes' },
  { value: 'closed', label: 'Fechadas' },
]

function parseStatus(value: string | undefined): ConversationStatusFilter {
  return value === 'open' || value === 'pending' || value === 'closed'
    ? value
    : 'all'
}

export default async function AgenciaInboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>
  searchParams: Promise<{ page?: string; q?: string; status?: string }>
}) {
  const { accountId } = await params
  const sp = await searchParams
  const page = parsePage(sp.page)
  const q = sp.q?.trim() || undefined
  const status = parseStatus(sp.status)

  const { admin, userId, role } = await requireAgencia()
  // Consent first: nothing personal is read when the owner granted metrics.
  const gate = await loadConsentGate(admin, accountId, { userId, role })
  if (!gate.allowed) {
    return <ConsentWall accountId={accountId} gate={gate} what="as conversas" />
  }
  const { rows, total, pageSize } = await listAccountConversations(
    admin,
    accountId,
    { page, q, status },
  )

  const basePath = `/agencia/${accountId}/inbox`
  const tabHref = (s: ConversationStatusFilter) => {
    const params = new URLSearchParams()
    if (s !== 'all') params.set('status', s)
    if (q) params.set('q', q)
    const qs = params.toString()
    return qs ? `${basePath}?${qs}` : basePath
  }

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

      {/* Status filter */}
      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((t) => (
          <Link
            key={t.value}
            href={tabHref(t.value)}
            className={`rounded-full border px-3 py-1 text-sm ${
              status === t.value
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-muted'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <SearchForm
        action={basePath}
        q={q}
        placeholder="Buscar no texto da última mensagem…"
        hidden={{ status: status === 'all' ? undefined : status }}
      />

      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          {q || status !== 'all'
            ? 'Nenhuma conversa corresponde ao filtro.'
            : 'Nenhuma conversa.'}
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

      <Pager
        basePath={basePath}
        page={page}
        total={total}
        pageSize={pageSize}
        params={{ q, status: status === 'all' ? undefined : status }}
      />
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

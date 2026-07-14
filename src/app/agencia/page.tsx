import Link from 'next/link'
import { ChevronRight, Users, MessageSquare, Contact, Coins } from 'lucide-react'

import { requireAgencia } from '@/lib/agencia/guard'
import { listAccountsOverview } from '@/lib/agencia/queries'

// Reads live account data through the service role on every request.
export const dynamic = 'force-dynamic'

export default async function AgenciaHomePage() {
  // Defence in depth: the layout already gated, but a page can execute
  // even as the layout redirects, so we re-verify and get the client.
  const { admin } = await requireAgencia()
  const accounts = await listAccountsOverview(admin)

  const totals = accounts.reduce(
    (acc, a) => ({
      contacts: acc.contacts + a.contactCount,
      conversations: acc.conversations + a.openConversationCount,
      deals: acc.deals + a.openDealCount,
    }),
    { contacts: 0, conversations: 0, deals: 0 },
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Contas dos clientes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {accounts.length} conta{accounts.length === 1 ? '' : 's'} ·{' '}
          {totals.contacts} contatos · {totals.conversations} conversas abertas ·{' '}
          {totals.deals} negócios abertos
        </p>
      </div>

      {accounts.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Nenhuma conta encontrada.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((a) => (
            <Link
              key={a.id}
              href={`/agencia/${a.id}`}
              className="group flex flex-col justify-between rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold leading-tight">{a.name}</h2>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {a.ownerEmail ?? 'sem dono'}
                </p>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <Stat icon={Contact} label="Contatos" value={a.contactCount} />
                <Stat icon={Users} label="Membros" value={a.memberCount} />
                <Stat
                  icon={MessageSquare}
                  label="Conversas"
                  value={a.openConversationCount}
                />
                <Stat icon={Coins} label="Negócios" value={a.openDealCount} />
              </dl>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="font-medium">{value.toLocaleString()}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

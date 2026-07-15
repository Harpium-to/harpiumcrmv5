import Link from 'next/link'
import {
  ChevronRight,
  Users,
  MessageSquare,
  Contact,
  Coins,
  TrendingUp,
  MoonStar,
} from 'lucide-react'

import { requireAgencia } from '@/lib/agencia/guard'
import {
  listAccountsOverview,
  getAgencyOverview,
  type AgencyOverview,
} from '@/lib/agencia/queries'

// Reads live account data through the service role on every request.
export const dynamic = 'force-dynamic'

export default async function AgenciaHomePage() {
  // Defence in depth: the layout already gated, but a page can execute
  // even as the layout redirects, so we re-verify and get the client.
  const { admin } = await requireAgencia()
  const [accounts, overview] = await Promise.all([
    listAccountsOverview(admin),
    getAgencyOverview(admin),
  ])

  const totals = accounts.reduce(
    (acc, a) => ({
      contacts: acc.contacts + a.contactCount,
      conversations: acc.conversations + a.openConversationCount,
      deals: acc.deals + a.openDealCount,
      dealValue: acc.dealValue + a.openDealValue,
    }),
    { contacts: 0, conversations: 0, deals: 0, dealValue: 0 },
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Visão da agência</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Panorama somado de todas as contas · últimos 30 dias
        </p>
      </div>

      {/* Totais da carteira */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Contas" value={accounts.length.toLocaleString()} />
        <Tile label="Contatos" value={totals.contacts.toLocaleString()} />
        <Tile
          label="Conversas abertas"
          value={totals.conversations.toLocaleString()}
        />
        <Tile
          label="Negócios abertos"
          value={formatAmount(totals.dealValue)}
        />
        <Tile
          label="Ganhos (30d)"
          value={formatAmount(overview.wonDealValue30d)}
        />
      </div>

      {/* Volume de mensagens */}
      <Section title="Volume de mensagens · todas as contas (30 dias)">
        <div className="p-4">
          <MessagesChart data={overview.dailyMessages} />
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Ranking */}
        <Section title="Clientes mais ativos">
          {overview.ranking.length === 0 ? (
            <Empty>Sem mensagens no período.</Empty>
          ) : (
            <div className="space-y-3 p-4">
              {overview.ranking.map((r, i) => {
                const max = overview.ranking[0].messageCount || 1
                return (
                  <Link
                    key={r.accountId}
                    href={`/agencia/${r.accountId}`}
                    className="flex items-center gap-3 text-sm hover:opacity-80"
                  >
                    <span className="w-4 text-xs text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="w-28 truncate font-medium">{r.name}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${(r.messageCount / max) * 100}%` }}
                      />
                    </span>
                    <span className="w-20 text-right text-xs text-muted-foreground">
                      {r.messageCount.toLocaleString()} msgs
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
        </Section>

        {/* Precisam de atenção — sem atividade recente */}
        <Section title="Precisam de atenção">
          {overview.inactive.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              Todas as contas tiveram atividade nos últimos 14 dias.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {overview.inactive.map((a) => (
                <li key={a.accountId}>
                  <Link
                    href={`/agencia/${a.accountId}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/50"
                  >
                    <span className="flex items-center gap-2">
                      <MoonStar className="h-4 w-4 text-amber-500" />
                      <span className="font-medium">{a.name}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-500">
                      sem atividade há 14+ dias
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Grade de contas */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Contas dos clientes</h2>
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
                    <h3 className="font-semibold leading-tight">{a.name}</h3>
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
    </div>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xl font-bold">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  )
}

function MessagesChart({ data }: { data: AgencyOverview['dailyMessages'] }) {
  const max = Math.max(1, ...data.map((d) => d.incoming + d.outgoing))

  if (data.every((d) => d.incoming + d.outgoing === 0)) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        Sem mensagens no período.
      </p>
    )
  }

  return (
    <div>
      <div className="flex h-28 items-end gap-0.5">
        {data.map((d) => (
          <div
            key={d.day}
            className="flex flex-1 flex-col justify-end"
            title={`${d.day}: ${d.incoming} recebidas, ${d.outgoing} enviadas`}
          >
            <div
              className="w-full rounded-t-sm bg-primary/70"
              style={{ height: `${(d.outgoing / max) * 100}%` }}
            />
            <div
              className="w-full bg-muted-foreground/40"
              style={{ height: `${(d.incoming / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-primary/70" />
          Enviadas
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-muted-foreground/40" />
          Recebidas
        </span>
      </div>
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

function formatAmount(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

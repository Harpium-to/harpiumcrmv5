import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { requireAgencia } from '@/lib/agencia/guard'
import {
  getAccountDetail,
  getAccountMetrics,
  logAgenciaAccess,
  parseMetricWindow,
  type AccountMetrics,
} from '@/lib/agencia/queries'
import { loadConsentGate } from '@/lib/agencia/consent'
import {
  listAgencyOperators,
  loadAccountRows,
  loadPendingOwnerInvites,
} from '@/lib/agencia/crms'
import { CRM_STATUS_LABEL, nicheLabel } from '@/lib/agencia/crm'
import { PeriodTabs } from '../ui'
import { CrmManagePanel } from './manage'

export const dynamic = 'force-dynamic'

// Next 16: dynamic route params are async and must be awaited.
export default async function AgenciaAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>
  searchParams: Promise<{ dias?: string }>
}) {
  const { accountId } = await params
  const windowDays = parseMetricWindow((await searchParams).dias)
  const { admin, userId, role: myRole } = await requireAgencia()
  // Consent decides whether personal data is read at all (Fase 3).
  const gate = await loadConsentGate(admin, accountId, { userId, role: myRole })
  const [detail, metrics, lifecycleRows, pendingOwners, operators] =
    await Promise.all([
      getAccountDetail(admin, accountId, { personal: gate.allowed }),
      getAccountMetrics(admin, accountId, windowDays),
      loadAccountRows(admin, accountId),
      loadPendingOwnerInvites(admin, accountId),
      listAgencyOperators(admin),
    ])
  if (!detail) notFound()
  const lifecycle = lifecycleRows[0]
  const canEdit =
    myRole === 'super_admin' ||
    (myRole === 'manager' && lifecycle?.manager_user_id === userId)

  // Audit this privileged view (non-blocking on failure).
  await logAgenciaAccess(admin, {
    actorUserId: userId,
    action: 'view_account',
    accountId,
  })

  const { account, members, stats, recentContacts, recentConversations, stages } =
    detail

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/agencia"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Todas as contas
          </Link>
          <h1 className="mt-2 flex flex-wrap items-center gap-2 text-2xl font-bold">
            {account.name}
            {lifecycle && lifecycle.status !== 'active' && (
              <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                {CRM_STATUS_LABEL[lifecycle.status]}
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {account.ownerEmail ?? 'sem dono'}
            {lifecycle?.niche && <> · {nicheLabel(lifecycle.niche)}</>} · criado em{' '}
            {formatDate(account.createdAt)}
          </p>
        </div>
        <PeriodTabs
          basePath={`/agencia/${account.id}`}
          current={windowDays}
        />
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Contatos" value={stats.contactCount.toLocaleString()} />
        <StatCard
          label="Conversas abertas"
          value={stats.openConversationCount.toLocaleString()}
        />
        <StatCard
          label="Negócios abertos"
          value={stats.openDealCount.toLocaleString()}
        />
        <StatCard
          label="Valor em aberto"
          value={formatAmount(stats.openDealValue)}
        />
      </div>

      {lifecycle && (
        <CrmManagePanel
          accountId={account.id}
          status={lifecycle.status}
          niche={lifecycle.niche}
          managerUserId={lifecycle.manager_user_id}
          notes={lifecycle.notes}
          ownerEmail={account.ownerEmail}
          pendingOwner={pendingOwners.get(account.id) ?? null}
          agencyLevel={gate.level}
          gate={gate}
          operators={operators}
          myRole={myRole}
          canEdit={canEdit}
        />
      )}

      {/* Analysis — 30-day window */}
      <Section title={`Análise · últimos ${metrics.windowDays} dias`}>
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
          <MiniStat label="Contatos novos" value={metrics.newContacts} />
          <MiniStat label="Conversas novas" value={metrics.newConversations} />
          <MiniStat label="Msgs recebidas" value={metrics.incomingMessages} />
          <MiniStat label="Msgs enviadas" value={metrics.outgoingMessages} />
          <MiniStat label="Negócios ganhos" value={metrics.wonDealsCount} />
          <MiniStat label="Valor ganho" value={formatAmount(metrics.wonDealsValue)} />
        </div>
        <div className="border-t border-border p-4">
          <p className="mb-3 text-xs text-muted-foreground">
            Volume de mensagens · últimos 14 dias
          </p>
          <MessagesChart data={metrics.dailyMessages} />
        </div>
      </Section>

      {/* Pipeline */}
      <Section
        title="Pipeline"
        action={{ href: `/agencia/${account.id}/pipeline`, label: 'Ver board →' }}
      >
        {stages.length === 0 ? (
          <Empty>Nenhum estágio de pipeline configurado.</Empty>
        ) : (
          <div className="divide-y divide-border">
            {stages.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.pipelineName}</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">{s.dealCount} negócios</p>
                  <p className="text-xs text-muted-foreground">
                    {formatAmount(s.dealValue)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent contacts */}
        <Section
          title="Contatos recentes"
          action={{ href: `/agencia/${account.id}/contatos`, label: 'Ver todos →' }}
        >
          {!gate.allowed ? (
            <Empty>O dono liberou só Métricas: contatos não aparecem.</Empty>
          ) : recentContacts.length === 0 ? (
            <Empty>Nenhum contato.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {recentContacts.map((c) => (
                <li key={c.id} className="px-4 py-3 text-sm">
                  <p className="font-medium">{c.name ?? c.phone}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.phone}
                    {c.email ? ` · ${c.email}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Recent conversations (inbox) */}
        <Section
          title="Inbox recente"
          action={{ href: `/agencia/${account.id}/inbox`, label: 'Ver tudo →' }}
        >
          {!gate.allowed ? (
            <Empty>O dono liberou só Métricas: conversas não aparecem.</Empty>
          ) : recentConversations.length === 0 ? (
            <Empty>Nenhuma conversa.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {recentConversations.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/agencia/${account.id}/inbox/${c.id}`}
                    className="block px-4 py-3 text-sm transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">
                        {c.contactName ?? 'Desconhecido'}
                      </p>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {c.status}
                      </span>
                    </div>
                    {c.lastMessageText && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {c.lastMessageText}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Members */}
      <Section title="Membros">
        <ul className="divide-y divide-border">
          {members.map((m, i) => (
            <li
              key={i}
              className="flex items-center justify-between px-4 py-3 text-sm"
            >
              <span>{m.email ?? (gate.allowed ? '—' : 'e-mail oculto (Métricas)')}</span>
              <span className="text-xs text-muted-foreground">{m.role}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </div>
  )
}

function MiniStat({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="bg-card p-3">
      <p className="text-lg font-bold leading-tight">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function MessagesChart({
  data,
}: {
  data: AccountMetrics['dailyMessages']
}) {
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
      <div className="flex h-28 items-end gap-1">
        {data.map((d) => {
          const total = d.incoming + d.outgoing
          return (
            <div
              key={d.day}
              className="flex flex-1 flex-col justify-end"
              title={`${d.day}: ${d.incoming} recebidas, ${d.outgoing} enviadas`}
            >
              <div
                className="w-full rounded-t bg-primary/70"
                style={{ height: `${(d.outgoing / max) * 100}%` }}
              />
              <div
                className="w-full bg-muted-foreground/40"
                style={{ height: `${(d.incoming / max) * 100}%` }}
              />
              {total === 0 && <div className="h-px w-full bg-border" />}
            </div>
          )
        })}
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

function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: { href: string; label: string }
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action && (
          <Link
            href={action.href}
            className="text-xs text-primary hover:underline"
          >
            {action.label}
          </Link>
        )}
      </div>
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatAmount(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

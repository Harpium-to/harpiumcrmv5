import Link from 'next/link'
import { Plus, TrendingUp, UserRoundPlus } from 'lucide-react'

import { requireAgencia } from '@/lib/agencia/guard'
import {
  listAccountsOverview,
  getAgencyOverview,
  parseMetricWindow,
  type AgencyOverview,
} from '@/lib/agencia/queries'
import {
  getPlatformSettings,
  listPendingSignups,
  loadConsentLevels,
  loadPlatformUsage,
} from '@/lib/agencia/crms'
import { CRM_NICHES, CRM_STATUSES, CRM_STATUS_LABEL, type CrmStatus } from '@/lib/agencia/crm'
import {
  applyPanelFilters,
  buildPanelRows,
  panelHref,
  panelTotals,
  parsePanelFilters,
  usageExtremes,
  type PanelRow,
} from '@/lib/agencia/panel'
import { hasAgenciaRole } from '@/lib/agencia/roles'
import { PeriodTabs } from './ui'
import { PlatformSettings } from './platform-settings'
import { CrmTable } from './crm-table'

// Reads live account data through the service role on every request.
export const dynamic = 'force-dynamic'

export default async function AgenciaHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sp = await searchParams
  const windowDays = parseMetricWindow(sp.dias)
  const filters = parsePanelFilters(sp)
  // Defence in depth: the layout already gated, but a page can execute
  // even as the layout redirects, so we re-verify and get the client.
  const { admin, role } = await requireAgencia()
  const [accounts, rawOverview, pendingSignups, platform, usage, access] =
    await Promise.all([
      listAccountsOverview(admin),
      getAgencyOverview(admin, windowDays),
      listPendingSignups(admin),
      getPlatformSettings(admin),
      loadPlatformUsage(admin),
      loadConsentLevels(admin),
    ])

  const now = new Date()
  const allRows = buildPanelRows(accounts, usage, access, now)
  const rows = applyPanelFilters(allRows, filters)
  const totals = panelTotals(allRows)
  const { most, least } = usageExtremes(allRows)
  const canCreate = hasAgenciaRole(role, 'manager')

  // Archived CRMs drop out of the chart's companions too.
  const archived = new Set(accounts.filter((a) => a.status === 'archived').map((a) => a.id))
  const overview: AgencyOverview = {
    ...rawOverview,
    ranking: rawOverview.ranking.filter((r) => !archived.has(r.accountId)),
    attention: rawOverview.attention.filter((a) => !archived.has(a.accountId)),
  }
  const needsAttention = allRows
    .filter((r) => r.alerts.length > 0)
    .sort(
      (a, b) =>
        a.alerts[0].priority - b.alerts[0].priority ||
        (a.health?.score ?? 101) - (b.health?.score ?? 101),
    )

  const countByStatus = new Map<CrmStatus, number>()
  for (const a of accounts) {
    countByStatus.set(a.status, (countByStatus.get(a.status) ?? 0) + 1)
  }
  const managers = [
    ...new Map(
      accounts
        .filter((a) => a.managerUserId)
        .map((a) => [a.managerUserId!, a.managerEmail ?? a.managerUserId!]),
    ),
  ]
  const niches = CRM_NICHES.filter((n) => accounts.some((a) => a.niche === n.id))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Painel da plataforma</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Como cada cliente está usando o CRM dele
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodTabs
            basePath="/agencia"
            current={windowDays}
            params={{
              status: filters.status ?? undefined,
              nicho: filters.niche ?? undefined,
              gestor: filters.manager ?? undefined,
              risco: filters.risk ? '1' : undefined,
              semacesso: filters.idle ? '1' : undefined,
              ordem: filters.sort !== 'saude' ? filters.sort : undefined,
            }}
          />
          {canCreate && (
            <Link
              href="/agencia/novo"
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              Novo CRM
            </Link>
          )}
        </div>
      </div>

      {usage === null && (
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Último acesso, usuários ativos, nota de saúde e alertas aparecem depois que
          a migration 052 for aplicada no Supabase.
        </p>
      )}

      {/* Números da carteira */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="CRMs ativos" value={totals.active} href={panelHref(filters, { status: 'active', risk: false, idle: false }, windowDays)} />
        <Tile label="Em implantação" value={totals.onboarding} href={panelHref(filters, { status: 'onboarding', risk: false, idle: false }, windowDays)} />
        <Tile label="Em risco" value={usage ? totals.risk : '—'} tone={totals.risk > 0 ? 'red' : undefined} href={panelHref(filters, { status: null, risk: true, idle: false }, windowDays)} />
        <Tile label="Sem acesso há 7+ dias" value={usage ? totals.idle : '—'} tone={totals.idle > 0 ? 'amber' : undefined} href={panelHref(filters, { status: null, risk: false, idle: true }, windowDays)} />
        <Tile label="Suspensos" value={totals.suspended} href={panelHref(filters, { status: 'suspended', risk: false, idle: false }, windowDays)} />
        <Tile label="Usuários ativos (7 dias)" value={usage ? totals.activeUsers7d : '—'} />
        <Tile label="Mensagens (7 dias)" value={usage ? totals.messages7d : '—'} />
        <Tile label="Ganhos (30 dias)" value={formatAmount(usage ? totals.wonValue30d : overview.wonDealValue30d)} />
      </div>

      {/* Aguardando liberação */}
      {pendingSignups.length > 0 && (
        <Section title={`Aguardando liberação · ${pendingSignups.length}`}>
          <ul className="divide-y divide-border">
            {pendingSignups.map((p) => (
              <li
                key={p.userId}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">{p.name ?? p.email ?? p.userId}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.email} · cadastro em {formatDate(p.createdAt)}
                    {p.invitedTo && <> · já convidado para {p.invitedTo}</>}
                  </p>
                </div>
                {canCreate && !p.invitedTo && p.email && (
                  <Link
                    href={`/agencia/novo?email=${encodeURIComponent(p.email)}${
                      p.name ? `&nome=${encodeURIComponent(p.name)}` : ''
                    }`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs hover:bg-muted"
                  >
                    <UserRoundPlus className="h-3.5 w-3.5" />
                    Criar CRM para esta pessoa
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Precisam de atenção */}
        <Section title="Precisam de atenção">
          {usage ? (
            needsAttention.length === 0 ? (
              <AllGood />
            ) : (
              <ul className="divide-y divide-border">
                {needsAttention.slice(0, 8).map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/agencia/${r.id}`}
                      className="flex flex-col gap-1.5 px-4 py-3 text-sm transition-colors hover:bg-muted/50"
                    >
                      <span className="font-medium">
                        {r.name}
                        {r.health && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            saúde {r.health.score}
                          </span>
                        )}
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        {r.alerts.map((a) => (
                          <Badge key={a.kind} tone={a.priority <= 1 ? 'red' : a.priority <= 3 ? 'amber' : 'blue'}>
                            {a.label}
                          </Badge>
                        ))}
                      </span>
                    </Link>
                  </li>
                ))}
                {needsAttention.length > 8 && (
                  <li className="px-4 py-2 text-xs text-muted-foreground">
                    e mais {needsAttention.length - 8} na tabela abaixo
                  </li>
                )}
              </ul>
            )
          ) : overview.attention.length === 0 ? (
            <AllGood />
          ) : (
            <ul className="divide-y divide-border">
              {overview.attention.map((a) => (
                <li key={a.accountId}>
                  <Link
                    href={`/agencia/${a.accountId}`}
                    className="flex flex-col gap-1.5 px-4 py-3 text-sm transition-colors hover:bg-muted/50"
                  >
                    <span className="font-medium">{a.name}</span>
                    <span className="flex flex-wrap gap-1.5">
                      {a.backlog > 0 && (
                        <Badge tone="red">
                          {a.backlog} conversa{a.backlog === 1 ? '' : 's'} sem atendente
                        </Badge>
                      )}
                      {a.whatsappDisconnected && <Badge tone="blue">WhatsApp desconectado</Badge>}
                      {a.inactive && <Badge tone="amber">sem atividade há 14+ dias</Badge>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Quem mais / menos usa */}
        <Section title="Quem mais usa · quem menos usa">
          {usage ? (
            most.length === 0 ? (
              <Empty>Nenhum CRM ativo com uso registrado.</Empty>
            ) : (
              <div className="grid grid-cols-2 divide-x divide-border">
                <UsageList title="Mais usam" rows={most} />
                <UsageList title="Menos usam" rows={least} />
              </div>
            )
          ) : overview.ranking.length === 0 ? (
            <Empty>Sem mensagens no período.</Empty>
          ) : (
            <ul className="space-y-2 p-4 text-sm">
              {overview.ranking.map((r, i) => (
                <li key={r.accountId} className="flex justify-between gap-2">
                  <Link href={`/agencia/${r.accountId}`} className="truncate hover:underline">
                    {i + 1}. {r.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {r.messageCount.toLocaleString('pt-BR')} msgs
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Volume de mensagens */}
      <Section title={`Volume de mensagens · todos os CRMs (${windowDays} dias)`}>
        <div className="p-4">
          <MessagesChart data={overview.dailyMessages} />
        </div>
      </Section>

      {/* Tabela de CRMs */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">CRMs dos clientes</h2>
          <div className="flex flex-wrap gap-1.5">
            <StatusPill
              href={panelHref(filters, { status: null }, windowDays)}
              active={filters.status === null}
              label="Todos"
              count={accounts.length - archived.size}
            />
            {CRM_STATUSES.map((s) => (
              <StatusPill
                key={s}
                href={panelHref(filters, { status: s }, windowDays)}
                active={filters.status === s}
                label={CRM_STATUS_LABEL[s]}
                count={countByStatus.get(s) ?? 0}
              />
            ))}
          </div>
        </div>

        <form
          action="/agencia"
          method="get"
          className="flex flex-wrap items-center gap-2 text-sm"
        >
          <input type="hidden" name="dias" value={windowDays} />
          {filters.status && <input type="hidden" name="status" value={filters.status} />}
          {filters.sort !== 'saude' && <input type="hidden" name="ordem" value={filters.sort} />}
          <select
            name="nicho"
            defaultValue={filters.niche ?? ''}
            aria-label="Nicho"
            className="h-8 rounded-md border border-border bg-card px-2 text-sm"
          >
            <option value="">Todos os nichos</option>
            {niches.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </select>
          <select
            name="gestor"
            defaultValue={filters.manager ?? ''}
            aria-label="Gestor"
            className="h-8 rounded-md border border-border bg-card px-2 text-sm"
          >
            <option value="">Todos os gestores</option>
            {managers.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-muted-foreground">
            <input type="checkbox" name="risco" value="1" defaultChecked={filters.risk} />
            Só em risco
          </label>
          <label className="flex items-center gap-1.5 text-muted-foreground">
            <input type="checkbox" name="semacesso" value="1" defaultChecked={filters.idle} />
            Sem acesso há 7+ dias
          </label>
          <button
            type="submit"
            className="h-8 rounded-md border border-border px-3 text-sm hover:bg-muted"
          >
            Filtrar
          </button>
          {(filters.niche || filters.manager || filters.risk || filters.idle) && (
            <Link
              href={panelHref(filters, { niche: null, manager: null, risk: false, idle: false }, windowDays)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Limpar filtros
            </Link>
          )}
        </form>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            Nenhum CRM com esses filtros.
          </p>
        ) : (
          <CrmTable rows={rows} filters={filters} dias={windowDays} now={now} />
        )}
      </div>

      {role === 'super_admin' && platform.autoPersonalAccount !== null && (
        <Section title="Plataforma">
          <PlatformSettings autoPersonalAccount={platform.autoPersonalAccount} />
        </Section>
      )}
    </div>
  )
}

function UsageList({ title, rows }: { title: string; rows: PanelRow[] }) {
  return (
    <div className="p-4">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="space-y-2 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex items-baseline justify-between gap-2">
            <Link href={`/agencia/${r.id}`} className="truncate hover:underline">
              {r.name}
            </Link>
            <span className="shrink-0 text-xs text-muted-foreground">
              {r.usage!.activeUsers7d} pess. · {r.usage!.msgsByWeek[0].toLocaleString('pt-BR')} msgs
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AllGood() {
  return (
    <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
      <TrendingUp className="h-4 w-4 text-emerald-500" />
      Nenhum sinal de atenção nos CRMs.
    </div>
  )
}

function StatusPill({
  href,
  active,
  label,
  count,
}: {
  href: string
  active: boolean
  label: string
  count: number
}) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-xs ${
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:bg-muted'
      }`}
    >
      {label} · {count}
    </Link>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR')
}

function Tile({
  label,
  value,
  href,
  tone,
}: {
  label: string
  value: number | string
  href?: string
  tone?: 'red' | 'amber'
}) {
  const toneClass =
    tone === 'red'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'amber'
        ? 'text-amber-600 dark:text-amber-400'
        : ''
  const body = (
    <>
      <p className={`text-xl font-bold ${toneClass}`}>
        {typeof value === 'number' ? value.toLocaleString('pt-BR') : value}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </>
  )
  return href ? (
    <Link href={href} className="fx-lift rounded-xl border border-border bg-card p-4">
      {body}
    </Link>
  ) : (
    <div className="rounded-xl border border-border bg-card p-4">{body}</div>
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

function Badge({
  tone,
  children,
}: {
  tone: 'red' | 'blue' | 'amber'
  children: React.ReactNode
}) {
  const tones = {
    red: 'bg-red-500/10 text-red-500',
    blue: 'bg-blue-500/10 text-blue-500',
    amber: 'bg-amber-500/10 text-amber-500',
  } as const
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${tones[tone]}`}>
      {children}
    </span>
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

function formatAmount(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

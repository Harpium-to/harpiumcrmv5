import Link from 'next/link'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

import {
  AGENCY_ACCESS_LABEL,
  CRM_STATUS_LABEL,
  nicheLabel,
} from '@/lib/agencia/crm'
import { HEALTH_BAND_LABEL, messageDelta, type HealthBand } from '@/lib/agencia/health'
import {
  panelHref,
  type PanelFilters,
  type PanelRow,
  type PanelSort,
} from '@/lib/agencia/panel'
import type { WhatsAppStatus } from '@/lib/agencia/whatsapp'

const BAND_CLASS: Record<HealthBand, string> = {
  healthy: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  attention: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  risk: 'bg-red-500/10 text-red-600 dark:text-red-400',
}

/**
 * One row per client CRM with the usage signals from migration 052.
 * Aggregates only, so it shows whatever consent level each CRM gave.
 * Before 052 the usage columns show dashes.
 */
export function CrmTable({
  rows,
  filters,
  dias,
  now,
  whatsapp = null,
}: {
  rows: PanelRow[]
  filters: PanelFilters
  dias: number
  now: Date
  /** WhatsApp status per CRM (W2). null → fall back to "any channel". */
  whatsapp?: Map<string, WhatsAppStatus> | null
}) {
  const sortLink = (sort: PanelSort, label: string) => (
    <Link
      href={panelHref(filters, { sort }, dias)}
      className={filters.sort === sort ? 'text-foreground' : 'hover:text-foreground'}
      aria-current={filters.sort === sort ? 'true' : undefined}
    >
      {label}
      {filters.sort === sort && ' ↓'}
    </Link>
  )

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[56rem] text-sm">
        <thead className="border-b border-border text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">{sortLink('nome', 'CRM')}</th>
            <th className="px-3 py-3 font-medium">Status</th>
            <th className="px-3 py-3 font-medium">{sortLink('saude', 'Saúde')}</th>
            <th className="px-3 py-3 font-medium">{sortLink('acesso', 'Último acesso')}</th>
            <th className="px-3 py-3 font-medium">Usuários 7d</th>
            <th className="px-3 py-3 font-medium">{sortLink('uso', 'Mensagens 7d')}</th>
            <th className="px-3 py-3 font-medium">{whatsapp ? 'WhatsApp' : 'Canal'}</th>
            <th className="px-3 py-3 font-medium">Alertas</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => {
            const delta = r.usage ? messageDelta(r.usage) : null
            return (
              <tr key={r.id} className="align-top transition-colors hover:bg-muted/40">
                <td className="max-w-[16rem] px-4 py-3">
                  <Link href={`/agencia/${r.id}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {[nicheLabel(r.niche), r.ownerLabel].filter(Boolean).join(' · ')}
                  </p>
                </td>
                <td className="px-3 py-3">
                  <span className="text-xs">{CRM_STATUS_LABEL[r.status]}</span>
                  {r.access && (
                    <p className="text-xs text-muted-foreground">
                      Acesso: {AGENCY_ACCESS_LABEL[r.access]}
                    </p>
                  )}
                </td>
                <td className="px-3 py-3">
                  {r.health ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${BAND_CLASS[r.health.band]}`}
                        title={`${HEALTH_BAND_LABEL[r.health.band]} · semana anterior: ${r.health.prevScore}`}
                      >
                        {r.health.score}
                      </span>
                      <TrendIcon trend={r.health.trend} />
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-3 text-xs">
                  {r.usage ? (
                    r.usage.lastActivityAt ? (
                      formatDistanceToNow(new Date(r.usage.lastActivityAt), {
                        addSuffix: true,
                        locale: ptBR,
                      })
                    ) : (
                      <span className="text-muted-foreground">nunca</span>
                    )
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-3 text-xs">
                  {r.usage ? `${r.usage.activeUsers7d} de ${r.usage.membersTotal}` : '—'}
                </td>
                <td className="px-3 py-3 text-xs">
                  {r.usage ? (
                    <>
                      {r.usage.msgsByWeek[0].toLocaleString('pt-BR')}
                      {delta !== null && (
                        <span
                          className={`ml-1.5 ${
                            delta < -0.2
                              ? 'text-red-600 dark:text-red-400'
                              : delta > 0.2
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-muted-foreground'
                          }`}
                        >
                          {delta > 0 ? '+' : ''}
                          {Math.round(delta * 100)}%
                        </span>
                      )}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-3 text-xs">
                  {whatsapp ? (
                    <WhatsAppBadge status={whatsapp.get(r.id) ?? null} />
                  ) : r.usage ? (
                    r.usage.channelConnected ? (
                      'Conectado'
                    ) : (
                      <span className="text-red-600 dark:text-red-400">Desconectado</span>
                    )
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-3 text-xs">
                  {r.alerts.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {r.alerts.slice(0, 2).map((a) => (
                        <li key={a.kind}>{a.label}</li>
                      ))}
                      {r.alerts.length > 2 && (
                        <li className="text-muted-foreground">+{r.alerts.length - 2}</li>
                      )}
                    </ul>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        Atualizado em {now.toLocaleString('pt-BR')}. Saúde de 0 a 100: pessoas usando,
        ritmo de mensagens, canal conectado, conversas sem resposta e módulos em uso.
      </p>
    </div>
  )
}

function TrendIcon({ trend }: { trend: 'up' | 'down' | 'flat' }) {
  if (trend === 'up') {
    return <ArrowUp className="h-3.5 w-3.5 text-emerald-600" aria-label="subindo" />
  }
  if (trend === 'down') {
    return <ArrowDown className="h-3.5 w-3.5 text-red-600" aria-label="caindo" />
  }
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" aria-label="estável" />
}

const WA_BADGE: Record<WhatsAppStatus['state'], { label: string; className: string }> = {
  connected: { label: 'Conectado', className: 'text-emerald-600 dark:text-emerald-400' },
  attention: { label: 'Atenção', className: 'text-amber-600 dark:text-amber-400' },
  none: { label: 'Não conectado', className: 'text-muted-foreground' },
}

/** WhatsApp state of one CRM; the reason shows on hover. */
function WhatsAppBadge({ status }: { status: WhatsAppStatus | null }) {
  const s = status ?? { state: 'none' as const, reason: null }
  const badge = WA_BADGE[s.state]
  return (
    <span className={badge.className} title={s.reason ?? undefined}>
      {badge.label}
    </span>
  )
}

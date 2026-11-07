import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

import {
  HEALTH_BAND_LABEL,
  modulesInUse,
  type CrmAlert,
  type CrmUsage,
  type Health,
} from '@/lib/agencia/health'

const PARTS: { key: keyof Health['parts']; label: string; max: number }[] = [
  { key: 'users', label: 'Pessoas usando', max: 30 },
  { key: 'momentum', label: 'Ritmo de mensagens', max: 25 },
  { key: 'channel', label: 'Canal conectado', max: 15 },
  { key: 'responsiveness', label: 'Conversas respondidas', max: 15 },
  { key: 'modules', label: 'Módulos em uso', max: 15 },
]

/**
 * Why a CRM has the score it has: each part against its weight, plus
 * the raw signals behind it. Aggregates only (no consent needed).
 */
export function HealthCard({
  usage,
  health,
  alerts,
}: {
  usage: CrmUsage
  health: Health | null
  alerts: CrmAlert[]
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
        Uso e saúde
      </h2>
      <div className="grid gap-6 p-4 lg:grid-cols-2">
        <div className="space-y-3">
          {health ? (
            <>
              <p className="flex items-baseline gap-2">
                <span className="text-3xl font-bold">{health.score}</span>
                <span className="text-sm text-muted-foreground">
                  de 100 · {HEALTH_BAND_LABEL[health.band]} · semana anterior{' '}
                  {health.prevScore}
                </span>
              </p>
              <ul className="space-y-2">
                {PARTS.map((p) => {
                  const value = health.parts[p.key]
                  return (
                    <li key={p.key} className="text-sm">
                      <div className="flex justify-between gap-2">
                        <span>{p.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {Math.round(value)} / {p.max}
                        </span>
                      </div>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${(value / p.max) * 100}%` }}
                        />
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sem nota: CRMs suspensos ou arquivados não são avaliados.
            </p>
          )}
        </div>

        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Fact label="Último acesso">
              {usage.lastActivityAt
                ? formatDistanceToNow(new Date(usage.lastActivityAt), {
                    addSuffix: true,
                    locale: ptBR,
                  })
                : 'nunca'}
            </Fact>
            <Fact label="Pessoas ativas (7 dias)">
              {usage.activeUsers7d} de {usage.membersTotal}
            </Fact>
            <Fact label="Mensagens (7 dias)">
              {usage.msgsByWeek[0].toLocaleString('pt-BR')} ({usage.msgsIn7d} recebidas)
            </Fact>
            <Fact label="Semana anterior">
              {usage.msgsByWeek[1].toLocaleString('pt-BR')} mensagens
            </Fact>
            <Fact label="Conversas abertas">
              {usage.openConversations} · {usage.openUnassigned} sem atendente
            </Fact>
            <Fact label="Sem resposta há 24h+">{usage.unanswered24h}</Fact>
            <Fact label="Módulos em uso">{modulesInUse(usage)} de 4</Fact>
            <Fact label="Ganhos (30 dias)">
              {usage.won30d} ·{' '}
              {usage.wonValue30d.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </Fact>
          </dl>
          {alerts.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-muted px-3 py-2 text-xs">
              {alerts.map((a) => (
                <li key={a.kind}>• {a.label}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

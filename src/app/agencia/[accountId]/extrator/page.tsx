import { BackToAccount } from '../parts'
import { requireAgencia } from '@/lib/agencia/guard'
import { hasAgenciaRole } from '@/lib/agencia/roles'
import { describeFilters } from '@/lib/extractor/filters'
import { listExtractions, loadSettings, monthlyUsage } from '@/lib/extractor/store'
import { DEFAULT_MONTHLY_LIMIT, SOURCE_LABEL } from '@/lib/extractor/types'

import { LimitForm } from './limit-form'

export const dynamic = 'force-dynamic'

const STATUS = {
  queued: 'na fila',
  running: 'extraindo',
  done: 'pronta',
  failed: 'falhou',
  cancelled: 'cancelada',
} as const

const usd = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })

/**
 * A client CRM's lead extractor, as the agency sees it (migration 073):
 * how much it used this month, the ceiling (managers change it — the
 * cost of Google Maps is the agency's), and each extraction's numbers.
 * Only numbers: the extracted companies themselves are seen inside the
 * CRM, with the access its owner granted.
 */
export default async function AgenciaExtractorPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params
  const { admin, role } = await requireAgencia()

  const extractions = await listExtractions(admin, accountId)
  const [settings, used] =
    extractions === null ? [null, 0] : await Promise.all([loadSettings(admin, accountId), monthlyUsage(admin, accountId)])
  const monthCost = (extractions ?? [])
    .filter((e) => e.createdAt.slice(0, 7) === new Date().toISOString().slice(0, 7))
    .reduce((sum, e) => sum + e.costUsd, 0)

  return (
    <div className="space-y-5">
      <div>
        <BackToAccount accountId={accountId} />
        <h1 className="mt-2 text-2xl font-bold">Extrator de leads</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          O uso do mês e as extrações deste CRM, só com os números. As empresas extraídas ficam dentro do CRM.
        </p>
      </div>

      {extractions === null || settings === null ? (
        <p className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          O Extrator exige a migration 073 aplicada no Supabase.
        </p>
      ) : (
        <>
          <section className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Leads extraídos no mês</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {used.toLocaleString('pt-BR')}{' '}
                <span className="text-sm font-normal text-muted-foreground">
                  de {settings.monthlyLimit.toLocaleString('pt-BR')}
                </span>
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Custo estimado no mês (Google Maps)</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{usd(monthCost)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Termo de uso</p>
              <p className="mt-1 text-sm">
                {settings.termsAcceptedAt
                  ? `aceito em ${new Date(settings.termsAcceptedAt).toLocaleDateString('pt-BR')}`
                  : 'ainda não aceito'}
              </p>
            </div>
            {hasAgenciaRole(role, 'manager') ? (
              <div className="sm:col-span-3">
                <LimitForm
                  accountId={accountId}
                  current={settings.monthlyLimit}
                  custom={settings.customLimit}
                  fallback={DEFAULT_MONTHLY_LIMIT}
                />
              </div>
            ) : null}
          </section>

          {extractions.length === 0 ? (
            <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              Este CRM ainda não fez extrações.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Extração</th>
                    <th className="px-4 py-3 text-right font-medium">Encontrados</th>
                    <th className="px-4 py-3 text-right font-medium">Novos</th>
                    <th className="px-4 py-3 text-right font-medium">No CRM</th>
                    <th className="px-4 py-3 text-right font-medium">Custo</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {extractions.map((e) => (
                    <tr key={e.id} className="border-b border-border align-top last:border-0">
                      <td className="px-4 py-3">
                        <p className="font-medium">
                          {e.name}{' '}
                          <span className="text-xs font-normal text-muted-foreground">{STATUS[e.status]}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {SOURCE_LABEL[e.source]} · {new Date(e.createdAt).toLocaleDateString('pt-BR')} ·{' '}
                          {describeFilters(e.source, e.filters)}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right">{e.found}</td>
                      <td className="px-4 py-3 text-right">{e.totals.novos}</td>
                      <td className="px-4 py-3 text-right">{e.totals.importados}</td>
                      <td className="px-4 py-3 text-right">{e.costUsd > 0 ? usd(e.costUsd) : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

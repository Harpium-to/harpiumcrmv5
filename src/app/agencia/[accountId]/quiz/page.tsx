import Link from 'next/link'

import { ReportView } from '@/components/quiz/editor/report-view'
import { requireAgencia } from '@/lib/agencia/guard'
import { consentAllowsRows, loadConsent } from '@/lib/agencia/consent'
import { buildPeople, buildReport } from '@/lib/quiz/report'
import { loadReportData } from '@/lib/quiz/report-data'
import { listQuizzes } from '@/lib/quiz/store'
import { BackToAccount } from '../parts'

export const dynamic = 'force-dynamic'

const DAYS = 30
const PEOPLE_SHOWN = 200

const STATUS = { draft: 'rascunho', published: 'no ar', paused: 'pausado' } as const

/** Where the report's window starts. */
function windowStart(): string {
  return new Date(Date.now() - DAYS * 86_400_000).toISOString()
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–'
}

/**
 * A client CRM's quizzes, as the agency may see them (migration 072).
 *
 * The numbers — visits, where people stop, what they answer, which
 * campaign brings them — are aggregates, so they show at every consent
 * level. The list of people only shows when the CRM's owner granted
 * "leitura" or "total": with "métricas" it is never read into the page.
 */
export default async function AgenciaQuizPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>
  searchParams: Promise<{ quiz?: string }>
}) {
  const { accountId } = await params
  const { quiz: quizId } = await searchParams
  const { admin } = await requireAgencia()

  const [level, quizzes] = await Promise.all([
    loadConsent(admin, accountId),
    listQuizzes(admin, accountId),
  ])
  const showPeople = consentAllowsRows(level)

  const data = quizId ? await loadReportData(admin, accountId, quizId, windowStart()) : null
  const base = `/agencia/${accountId}/quiz`

  return (
    <div className="space-y-5">
      <div>
        <BackToAccount accountId={accountId} />
        <h1 className="mt-2 text-2xl font-bold">Quiz e formulários</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {showPeople
            ? 'Os quizzes deste CRM, com os números e as pessoas dos últimos 30 dias.'
            : 'Os quizzes deste CRM, só com os números: o dono liberou Métricas, então nomes e telefones não aparecem.'}
        </p>
      </div>

      {quizzes === null ? (
        <p className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          O Quiz exige a migration 072 aplicada no Supabase.
        </p>
      ) : quizzes.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Este CRM ainda não tem quizzes.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Quiz</th>
                <th className="px-4 py-3 text-right font-medium">Visitas</th>
                <th className="px-4 py-3 text-right font-medium">Concluíram</th>
                <th className="px-4 py-3 text-right font-medium">Leads</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {quizzes.map((quiz) => (
                <tr
                  key={quiz.id}
                  className={`border-b border-border last:border-0 ${quiz.id === quizId ? 'bg-muted/50' : ''}`}
                >
                  <td className="px-4 py-3">
                    <Link href={`${base}?quiz=${quiz.id}`} className="font-medium hover:underline">
                      {quiz.name}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">{STATUS[quiz.status]}</span>
                  </td>
                  <td className="px-4 py-3 text-right">{quiz.totals.visits}</td>
                  <td className="px-4 py-3 text-right">
                    {quiz.totals.completed}{' '}
                    <span className="text-xs text-muted-foreground">
                      ({pct(quiz.totals.completed, quiz.totals.visits)})
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">{quiz.totals.leads}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {quizId && !data ? (
        <p className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          Quiz não encontrado neste CRM.
        </p>
      ) : null}

      {data ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{data.quiz.name} · últimos {DAYS} dias</h2>
          <ReportView
            report={buildReport(data.definition, data.sessions)}
            // With "métricas" the people are not built at all: nothing
            // personal travels to the browser. The contact links belong
            // to the CRM itself, so they are left out here either way.
            people={
              showPeople
                ? buildPeople(data.definition, data.sessions.slice(0, PEOPLE_SHOWN)).map((p) => ({
                    ...p,
                    contactId: null,
                  }))
                : []
            }
            peopleTotal={showPeople ? data.sessions.length : 0}
            showPeople={showPeople}
          />
        </section>
      ) : quizzes && quizzes.length > 0 ? (
        <p className="text-sm text-muted-foreground">Clique em um quiz para ver o relatório.</p>
      ) : null}
    </div>
  )
}

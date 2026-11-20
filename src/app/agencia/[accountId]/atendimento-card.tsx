import type { TeamQueue } from '@/lib/agencia/atendimento'

/**
 * The client CRM's setores in the agency console (Fase 5 of the
 * attendance plan): how many conversations wait in each queue, how many
 * wait for a person, and how many are past the setor's deadline.
 */
export function AtendimentoCard({ teams }: { teams: TeamQueue[] }) {
  if (teams.length === 0) return null
  const attention = teams.some((t) => t.overdue > 0)

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">
          Atendimento por setor{' '}
          <span className="font-normal text-muted-foreground">
            · {teams.length} {teams.length === 1 ? 'setor' : 'setores'}
          </span>
        </h2>
        {attention && (
          <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
            Prazo estourado
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">Setor</th>
              <th className="px-3 py-2 text-right font-medium">Pessoas</th>
              <th className="px-3 py-2 text-right font-medium">Na fila</th>
              <th className="px-3 py-2 text-right font-medium">Aguardando</th>
              <th className="px-4 py-2 text-right font-medium">Prazo estourado</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="px-4 py-2">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                    {t.name}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{t.members}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.queued}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.waiting}</td>
                <td
                  className={
                    t.overdue > 0
                      ? 'px-4 py-2 text-right font-semibold tabular-nums text-red-600 dark:text-red-400'
                      : 'px-4 py-2 text-right tabular-nums'
                  }
                >
                  {t.overdue}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

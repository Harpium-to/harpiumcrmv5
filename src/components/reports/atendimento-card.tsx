"use client";

import type { AtendimentoReport } from "@/lib/reports/atendimento";

/**
 * Relatórios › Atendimento: who received and passed on conversations,
 * and how each setor's queue behaved, in the selected window.
 */
export function AtendimentoCard({ report }: { report: AtendimentoReport }) {
  const hasPeople = report.people.length > 0;
  const hasTeams = report.teams.length > 0;

  if (!hasPeople && !hasTeams) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma conversa mudou de mãos neste período.
      </p>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {hasPeople && (
        <div className="min-w-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Por pessoa</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-2 font-medium">Pessoa</th>
                  <th className="px-2 py-1.5 text-right font-medium">Recebeu</th>
                  <th className="px-2 py-1.5 text-right font-medium">Passou</th>
                  <th className="py-1.5 pl-2 text-right font-medium">Abertas agora</th>
                </tr>
              </thead>
              <tbody>
                {report.people.map((p) => (
                  <tr key={p.userId} className="border-t border-border/60">
                    <td className="max-w-[10rem] truncate py-1.5 pr-2 text-foreground">{p.name}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{p.received}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{p.passedOn}</td>
                    <td className="py-1.5 pl-2 text-right tabular-nums">{p.openNow}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {hasTeams && (
        <div className="min-w-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Por setor</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-2 font-medium">Setor</th>
                  <th className="px-2 py-1.5 text-right font-medium">Entradas</th>
                  <th className="px-2 py-1.5 text-right font-medium">Espera na fila</th>
                  <th className="py-1.5 pl-2 text-right font-medium">Prazos estourados</th>
                </tr>
              </thead>
              <tbody>
                {report.teams.map((t) => (
                  <tr key={t.teamId} className="border-t border-border/60">
                    <td className="max-w-[10rem] py-1.5 pr-2">
                      <span className="flex items-center gap-1.5 truncate text-foreground">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                        {t.name}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{t.entries}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {t.medianQueueMinutes === null ? "—" : `${t.medianQueueMinutes} min`}
                    </td>
                    <td className="py-1.5 pl-2 text-right tabular-nums">{t.overdueMoves}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

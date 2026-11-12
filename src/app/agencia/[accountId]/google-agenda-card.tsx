import type { GoogleAgendaDetail, GoogleAgendaRow } from '@/lib/agencia/google-agenda'

const STATE_LABEL: Record<GoogleAgendaRow['state'], string> = {
  connected: 'No Google',
  needs_reconnect: 'Reconectar',
  none: 'Só no CRM',
}

const STATE_CLASS: Record<GoogleAgendaRow['state'], string> = {
  connected: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  needs_reconnect: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  none: 'bg-muted text-muted-foreground',
}

/**
 * Google Agenda of one client CRM, in the agency console (G3): which
 * agendas write to Google, which need the professional to sign in again,
 * and how many appointments did not get there.
 */
export function GoogleAgendaCard({ detail }: { detail: GoogleAgendaDetail }) {
  if (!detail.available || detail.agendas.length === 0) return null
  const linked = detail.agendas.filter((a) => a.state !== 'none').length
  const attention = detail.agendas.some((a) => a.state === 'needs_reconnect' || a.failed > 0)

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">
          Google Agenda{' '}
          <span className="font-normal text-muted-foreground">
            · {linked} de {detail.agendas.length} agenda{detail.agendas.length === 1 ? '' : 's'} ligada
            {linked === 1 ? '' : 's'}
          </span>
        </h2>
        {attention ? (
          <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            Precisa de atenção
          </span>
        ) : null}
      </div>
      <ul className="divide-y divide-border">
        {detail.agendas.map((agenda) => (
          <li key={agenda.name} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
            <span className="min-w-0 flex-1 truncate">
              {agenda.name}
              {agenda.email ? <span className="text-muted-foreground"> · {agenda.email}</span> : null}
            </span>
            {agenda.failed > 0 ? (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                {agenda.failed} sem ir para o Google
              </span>
            ) : null}
            {agenda.state !== 'none' && !agenda.showsGoogle ? (
              <span className="text-xs text-muted-foreground">não mostra o Google</span>
            ) : null}
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATE_CLASS[agenda.state]}`}>
              {STATE_LABEL[agenda.state]}
            </span>
          </li>
        ))}
      </ul>
      {detail.agendas.some((a) => a.state === 'needs_reconnect') ? (
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          O Google recusou o acesso de uma conta (senha trocada ou acesso removido). Um administrador
          do CRM resolve em Agenda › engrenagem › editar a agenda › Conectar de novo, ou enviando o
          link para o profissional.
        </p>
      ) : null}
    </section>
  )
}

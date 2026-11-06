import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { requireAgencia } from '@/lib/agencia/guard'
import { listAudit } from '@/lib/agencia/queries'
import { auditActionLabel } from '@/lib/agencia/crm'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50


export default async function AgenciaAuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const pageRaw = Number((await searchParams).page)
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1

  const { admin } = await requireAgencia()
  const { available, rows, total } = await listAudit(admin, page, PAGE_SIZE)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Auditoria de acesso</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Registro de quem abriu contas, conversas e exportações.
        </p>
      </div>

      {!available ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-4 text-sm text-amber-600 dark:text-amber-400">
          A auditoria ainda não está ativa. Aplique a migration{' '}
          <code className="font-mono">038_agencia_auditoria.sql</code> no SQL
          Editor do Supabase para começar a registrar os acessos.
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Nenhum acesso registrado ainda.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Quando</th>
                  <th className="px-4 py-3 font-medium">Quem</th>
                  <th className="px-4 py-3 font-medium">Ação</th>
                  <th className="px-4 py-3 font-medium">Conta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatWhen(r.createdAt)}
                    </td>
                    <td className="px-4 py-3">{r.actorEmail ?? '—'}</td>
                    <td className="px-4 py-3">
                      {auditActionLabel(r.action)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.accountName ? (
                        <span>{r.accountName}</span>
                      ) : (
                        <span className="italic">conta removida</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Página {page} de {totalPages} · {total.toLocaleString()} registros
              </span>
              <div className="flex items-center gap-2">
                <PagerLink
                  href={`/agencia/auditoria?page=${page - 1}`}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </PagerLink>
                <PagerLink
                  href={`/agencia/auditoria?page=${page + 1}`}
                  disabled={page >= totalPages}
                >
                  Próxima
                  <ChevronRight className="h-4 w-4" />
                </PagerLink>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function PagerLink({
  href,
  disabled,
  children,
}: {
  href: string
  disabled: boolean
  children: React.ReactNode
}) {
  const cls =
    'inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5'
  if (disabled) {
    return (
      <span className={`${cls} cursor-not-allowed text-muted-foreground/50`}>
        {children}
      </span>
    )
  }
  return (
    <Link href={href} className={`${cls} hover:bg-muted`}>
      {children}
    </Link>
  )
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

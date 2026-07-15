import { Download } from 'lucide-react'

import { requireAgencia } from '@/lib/agencia/guard'
import { listAccountContacts } from '@/lib/agencia/queries'
import { BackToAccount, Pager, SearchForm, parsePage } from '../parts'

export const dynamic = 'force-dynamic'

export default async function AgenciaContatosPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>
  searchParams: Promise<{ page?: string; q?: string }>
}) {
  const { accountId } = await params
  const sp = await searchParams
  const page = parsePage(sp.page)
  const q = sp.q?.trim() || undefined

  const { admin } = await requireAgencia()
  const { rows, total, pageSize } = await listAccountContacts(admin, accountId, {
    page,
    q,
  })

  const basePath = `/agencia/${accountId}/contatos`

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <BackToAccount accountId={accountId} />
          <h1 className="mt-2 text-2xl font-bold">Contatos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total.toLocaleString()} contato{total === 1 ? '' : 's'}
            {q ? ` para “${q}”` : ''}
          </p>
        </div>
        <a
          href={`/api/agencia/${accountId}/export/contatos`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
        >
          <Download className="h-4 w-4" />
          Exportar CSV
        </a>
      </div>

      <SearchForm
        action={basePath}
        q={q}
        placeholder="Buscar por nome, telefone, email ou empresa…"
      />

      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          {q ? 'Nenhum contato corresponde à busca.' : 'Nenhum contato.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Telefone</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Empresa</th>
                <th className="px-4 py-3 font-medium">Criado em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 font-medium">{c.name ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.phone}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.email ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.company ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(c.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pager
        basePath={basePath}
        page={page}
        total={total}
        pageSize={pageSize}
        params={{ q }}
      />
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

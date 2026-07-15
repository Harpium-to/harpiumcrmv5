import { requireAgencia } from '@/lib/agencia/guard'
import { listAccountContacts } from '@/lib/agencia/queries'
import { BackToAccount, Pager, parsePage } from '../parts'

export const dynamic = 'force-dynamic'

export default async function AgenciaContatosPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { accountId } = await params
  const page = parsePage((await searchParams).page)
  const { admin } = await requireAgencia()
  const { rows, total, pageSize } = await listAccountContacts(
    admin,
    accountId,
    page,
  )

  const basePath = `/agencia/${accountId}/contatos`

  return (
    <div className="space-y-5">
      <div>
        <BackToAccount accountId={accountId} />
        <h1 className="mt-2 text-2xl font-bold">Contatos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {total.toLocaleString()} contato{total === 1 ? '' : 's'}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Nenhum contato.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Telefone</th>
                <th className="px-4 py-3 font-medium">Email</th>
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
                    {formatDate(c.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pager basePath={basePath} page={page} total={total} pageSize={pageSize} />
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

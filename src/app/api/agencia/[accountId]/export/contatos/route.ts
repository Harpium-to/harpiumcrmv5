import { requireAgencia } from '@/lib/agencia/guard'
import { logAgenciaAccess } from '@/lib/agencia/queries'
import { toErrorResponse } from '@/lib/auth/account'
import { csvResponse, slugForFilename, toCsv } from '@/lib/reports/csv'

// CSV export of an account's contacts, for the agency to analyse offline
// or hand to the client. Gated by requireAgencia(); reads via service
// role. Paginates through the whole table (PostgREST caps a single
// request), so even large lists export in full.

const CHUNK = 1000

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { accountId } = await params
    const { admin, userId } = await requireAgencia()

    await logAgenciaAccess(admin, {
      actorUserId: userId,
      action: 'export_contacts',
      accountId,
    })

    const { data: account } = await admin
      .from('accounts')
      .select('name')
      .eq('id', accountId)
      .maybeSingle()

    const rows: Array<{
      name: string | null
      phone: string
      email: string | null
      company: string | null
      created_at: string
    }> = []
    for (let from = 0; ; from += CHUNK) {
      const { data, error } = await admin
        .from('contacts')
        .select('name, phone, email, company, created_at')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .range(from, from + CHUNK - 1)
      if (error) throw error
      rows.push(...(data ?? []))
      if (!data || data.length < CHUNK) break
    }

    // Quoting, formula-injection defusing and the BOM live in
    // lib/reports/csv, which is where the reports read them from too.
    const body = toCsv(rows, [
      { header: 'Nome', value: (c) => c.name },
      { header: 'Telefone', value: (c) => c.phone },
      { header: 'Email', value: (c) => c.email },
      { header: 'Empresa', value: (c) => c.company },
      { header: 'Criado em', value: (c) => formatDate(c.created_at) },
    ])

    const filename = `contatos-${slugForFilename(account?.name ?? accountId)}.csv`
    return csvResponse(body, filename)
  } catch (err) {
    return toErrorResponse(err)
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

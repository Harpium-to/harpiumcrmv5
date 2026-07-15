import { requireAgencia } from '@/lib/agencia/guard'
import { toErrorResponse } from '@/lib/auth/account'

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
    const { admin } = await requireAgencia()

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

    const header = ['Nome', 'Telefone', 'Email', 'Empresa', 'Criado em']
    const lines = [header.map(csvCell).join(',')]
    for (const c of rows) {
      lines.push(
        [
          c.name ?? '',
          c.phone,
          c.email ?? '',
          c.company ?? '',
          formatDate(c.created_at),
        ]
          .map(csvCell)
          .join(','),
      )
    }
    // BOM (﻿) so Excel reads UTF-8 accents correctly.
    const body = '﻿' + lines.join('\r\n')

    const filename = `contatos-${slug(account?.name ?? accountId)}.csv`
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

// Quote per RFC 4180 and defuse spreadsheet formula injection.
function csvCell(value: string): string {
  let s = value ?? ''
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
  return s
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

function slug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'conta'
  )
}

// ============================================================
// CSV serialisation.
//
// Lifted out of `/api/agencia/[accountId]/export/contatos`, which had
// the only correct implementation in the codebase, so the reports do
// not grow a second one that forgets the parts that matter:
//
//   * RFC 4180 quoting, so a contact called `Souza, Ltda` doesn't
//     become two columns.
//   * Formula-injection defusing. A cell beginning `=`, `+`, `-` or
//     `@` is executed as a formula by Excel, Sheets and LibreOffice on
//     open — `=HYPERLINK(...)` or `=cmd|...` in a lead's *name* field
//     turns an export into an attack on whoever opens it. Prefixing an
//     apostrophe makes it text. This matters more here than in the
//     contacts export: these files get mailed to clients.
//   * A UTF-8 BOM, without which Excel on Windows renders every
//     accented Portuguese name as mojibake.
// ============================================================

export interface CsvColumn<T> {
  header: string
  value: (row: T) => string | number | null | undefined
}

/** Quote per RFC 4180 and defuse spreadsheet formula injection. */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
  return s
}

/** The BOM Excel needs to read UTF-8. */
export const CSV_BOM = '﻿'

/**
 * Rows plus a column spec into a CSV document.
 *
 * CRLF line endings, because that is what RFC 4180 says and what Excel
 * expects; every other reader accepts them.
 */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')]
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(c.value(row))).join(','))
  }
  return CSV_BOM + lines.join('\r\n')
}

/**
 * A filename-safe slug.
 *
 * Also the sanitiser for the `Content-Disposition` header: the name
 * reaches it from account and report titles, and a quote or newline in
 * there is a header-injection bug, not a cosmetic one.
 */
export function slugForFilename(name: string, max = 40): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, max) || 'relatorio'
  )
}

/** A downloadable CSV response. */
export function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // These files hold customer data; no shared cache should keep a
      // copy of one.
      'Cache-Control': 'no-store',
    },
  })
}

// ============================================================
// Reading every matching row, or failing loudly.
//
// PostgREST caps a single response (1000 rows by default). The
// dashboard's queries ignore that: `loadConversationsSeries` selects
// every message in the window with no range, so on any account past a
// thousand messages its chart is quietly wrong. For a chart next to a
// live inbox that is survivable. For a report somebody exports and
// sends to a client it is not.
//
// So: page through everything, and if the data outgrows even the
// generous cap below, THROW rather than return a short list. A report
// that says "não consegui ler este período" sends someone to fix it;
// a report that silently drops 40% of October does not, and the number
// gets quoted in a meeting.
// ============================================================

const CHUNK = 1000
const MAX_PAGES = 100

export class ReportTooLargeError extends Error {
  constructor() {
    super(
      `Período com mais de ${CHUNK * MAX_PAGES} registros para agregar. ` +
        'Escolha um intervalo menor.',
    )
    this.name = 'ReportTooLargeError'
  }
}

export interface QueryError {
  message: string
  code?: string
}

export interface PageResult<T> {
  data: T[] | null
  error: QueryError | null
}

/**
 * Every row the query matches.
 *
 * `build` is called once per page with the offset bounds, because a
 * PostgREST builder is single-use — awaiting one twice replays the
 * first page, which would loop forever on page two.
 *
 * Typed against the result shape rather than the builder: the
 * builder's own generics are awkward to spell for a helper this
 * generic, and all this needs is something awaitable that resolves to
 * `{ data, error }`.
 */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const rows: T[] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * CHUNK
    const { data, error } = await build(from, from + CHUNK - 1)
    if (error) throw Object.assign(new Error(error.message), { code: error.code })
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < CHUNK) return rows
  }
  throw new ReportTooLargeError()
}

import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------
// An in-memory stand-in for the service-role client that also RECORDS
// the filters of every query, so a test can prove each read of client
// data was scoped to one CRM.
// ---------------------------------------------------------------------

export type Row = Record<string, unknown>
export interface QueryLog {
  table: string
  filters: Array<[string, string, unknown]>
}

export function recordingDb(
  tables: Record<string, Row[]>,
  rpcs: Record<string, (args: Record<string, unknown>) => unknown> = {},
) {
  const log: QueryLog[] = []
  const rpcLog: Array<{ fn: string; args: Record<string, unknown> }> = []

  const from = (table: string) => {
    const entry: QueryLog = { table, filters: [] }
    log.push(entry)
    const preds: ((r: Row) => boolean)[] = []
    let head = false
    let wantCount = false
    let lim = Infinity
    let range: [number, number] | null = null
    let orderCol: string | null = null
    let asc = true

    const add = (op: string, col: string, v: unknown, p: (r: Row) => boolean) => {
      entry.filters.push([op, col, v])
      preds.push(p)
      return q
    }
    const parseList = (v: unknown) =>
      String(v).replace(/^\(|\)$/g, '').split(',').map((s) => s.trim())

    const run = () => {
      let rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)))
      if (orderCol) {
        const c = orderCol
        rows = [...rows].sort((a, b) =>
          (asc ? 1 : -1) * String(a[c] ?? '').localeCompare(String(b[c] ?? '')),
        )
      }
      const total = rows.length
      if (range) rows = rows.slice(range[0], range[1] + 1)
      rows = rows.slice(0, lim)
      return {
        data: head ? null : rows,
        count: wantCount ? total : null,
        error: null,
      }
    }

    const q = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count) wantCount = true
        if (opts?.head) head = true
        return q
      },
      eq: (c: string, v: unknown) => add('eq', c, v, (r) => r[c] === v),
      neq: (c: string, v: unknown) => add('neq', c, v, (r) => r[c] !== v),
      in: (c: string, vs: unknown[]) => add('in', c, vs, (r) => vs.includes(r[c])),
      is: (c: string, v: unknown) => add('is', c, v, (r) => (r[c] ?? null) === v),
      not: (c: string, op: string, v: unknown) =>
        op === 'is'
          ? add('not.is', c, v, (r) => (r[c] ?? null) !== v)
          : add('not.in', c, v, (r) => !parseList(v).includes(String(r[c]))),
      gte: (c: string, v: unknown) => add('gte', c, v, (r) => r[c] != null && String(r[c]) >= String(v)),
      gt: (c: string, v: unknown) => add('gt', c, v, (r) => r[c] != null && String(r[c]) > String(v)),
      lt: (c: string, v: unknown) => add('lt', c, v, (r) => r[c] != null && String(r[c]) < String(v)),
      lte: (c: string, v: unknown) => add('lte', c, v, (r) => r[c] != null && String(r[c]) <= String(v)),
      or: (expr: string) => (entry.filters.push(['or', '', expr]), q),
      ilike: (c: string, v: unknown) => add('ilike', c, v, () => true),
      order: (c: string, o?: { ascending?: boolean }) => {
        orderCol = c
        asc = o?.ascending !== false
        return q
      },
      limit: (n: number) => ((lim = n), q),
      range: (a: number, b: number) => ((range = [a, b]), q),
      maybeSingle: async () => {
        const r = run()
        return { data: (r.data ?? [])[0] ?? null, error: null }
      },
      single: async () => {
        const r = run()
        return { data: (r.data ?? [])[0] ?? null, error: null }
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    }
    return q
  }

  const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
    rpcLog.push({ fn, args })
    const h = rpcs[fn]
    if (!h) return { data: null, error: { code: '42883', message: `function ${fn} does not exist` } }
    return { data: h(args), error: null }
  }

  return { db: { from, rpc } as unknown as SupabaseClient, log, rpcLog }
}

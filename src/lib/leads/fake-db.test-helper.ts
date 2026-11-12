import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------
// A small in-memory stand-in for the Supabase query builder: enough of
// select / insert / update / upsert / delete and the filters ingest uses.
// ---------------------------------------------------------------------

export type Row = Record<string, unknown>

function likeToRegex(pattern: string, flags: string): RegExp {
  let src = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\' && i + 1 < pattern.length) {
      src += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    } else if (c === '%') src += '.*'
    else if (c === '_') src += '.'
    else src += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  // `s`: like Postgres LIKE, `%` also spans line breaks.
  return new RegExp(`^${src}$`, `${flags}s`)
}

export function fakeDb(tables: Record<string, Row[]>) {
  let seq = 0
  const nextId = (table: string) => `${table}-${++seq}`

  const withDefaults = (table: string, row: Row): Row => {
    const out: Row = { id: nextId(table), created_at: new Date().toISOString(), ...row }
    if (table === 'contacts') out.phone_normalized = String(out.phone ?? '').replace(/\D/g, '')
    return out
  }

  const from = (table: string) => {
    tables[table] ??= []
    const filters: ((r: Row) => boolean)[] = []
    let op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
    let payload: Row[] = []
    let patch: Row = {}
    let conflict: string[] = []
    let ignoreDuplicates = false
    let limit = Infinity

    const matching = () => tables[table].filter((r) => filters.every((f) => f(r)))

    const run = (): { data: Row[]; error: { code?: string; message: string } | null } => {
      if (op === 'insert') {
        const created = payload.map((r) => withDefaults(table, r))
        tables[table].push(...created)
        return { data: created, error: null }
      }
      if (op === 'update') {
        const hit = matching()
        for (const r of hit) Object.assign(r, patch)
        return { data: hit, error: null }
      }
      if (op === 'delete') {
        const hit = matching()
        tables[table] = tables[table].filter((r) => !hit.includes(r))
        return { data: hit, error: null }
      }
      if (op === 'upsert') {
        const out: Row[] = []
        for (const r of payload) {
          const existing = tables[table].find((e) => conflict.every((c) => e[c] === r[c]))
          if (existing) {
            if (!ignoreDuplicates) Object.assign(existing, r)
            out.push(existing)
          } else {
            const created = withDefaults(table, r)
            tables[table].push(created)
            out.push(created)
          }
        }
        return { data: out, error: null }
      }
      return { data: matching().slice(0, limit), error: null }
    }

    const q = {
      select: () => q,
      insert: (rows: Row | Row[]) => ((op = 'insert'), (payload = Array.isArray(rows) ? rows : [rows]), q),
      update: (values: Row) => ((op = 'update'), (patch = values), q),
      delete: () => ((op = 'delete'), q),
      upsert: (rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        op = 'upsert'
        payload = Array.isArray(rows) ? rows : [rows]
        conflict = (opts?.onConflict ?? 'id').split(',')
        ignoreDuplicates = Boolean(opts?.ignoreDuplicates)
        return q
      },
      eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), q),
      is: (col: string, v: unknown) => (filters.push((r) => (r[col] ?? null) === v), q),
      in: (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), q),
      not: (col: string, operator: string, v: unknown) => {
        if (operator === 'is') filters.push((r) => (r[col] ?? null) !== v)
        return q
      },
      contains: (col: string, vs: unknown[]) => (
        filters.push((r) => Array.isArray(r[col]) && vs.every((v) => (r[col] as unknown[]).includes(v))),
        q
      ),
      gte: (col: string, v: string) => (filters.push((r) => String(r[col]) >= v), q),
      lt: (col: string, v: string) => (filters.push((r) => String(r[col]) < v), q),
      like: (col: string, p: string) => (filters.push((r) => likeToRegex(p, '').test(String(r[col] ?? ''))), q),
      ilike: (col: string, p: string) => (filters.push((r) => likeToRegex(p, 'i').test(String(r[col] ?? ''))), q),
      order: () => q,
      limit: (n: number) => ((limit = n), q),
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      single: async () => {
        const { data, error } = run()
        return { data: data[0] ?? null, error }
      },
      then: (resolve: (v: unknown) => unknown) => resolve(run()),
    }
    return q
  }
  return { from } as unknown as SupabaseClient
}

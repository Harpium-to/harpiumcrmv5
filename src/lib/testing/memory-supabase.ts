import type { SupabaseClient } from '@supabase/supabase-js'

import { normalizePhone } from '@/lib/whatsapp/phone-utils'

// ============================================================
// Test-only: an in-memory stand-in for the service-role Supabase client.
//
// Covers the query-builder surface the inbound webhooks use (select /
// insert / update / delete / upsert, eq / neq / in / like / is / range
// filters, order, limit, single / maybeSingle, exact counts) and, the
// reason it exists, enforces the real unique indexes that make inbound
// processing race-safe: one conversation per contact (036), one contact
// per phone (022) and per Instagram id (047). A losing insert gets the
// same SQLSTATE 23505 Postgres would return.
//
// Each query resolves a microtask after it is awaited, so two inbound
// deliveries run with Promise.all interleave like concurrent requests.
// ============================================================

export type Row = Record<string, unknown>

/** Returns the row's key under one unique index, or null when the
 *  index doesn't apply to it (partial index / NULL column). */
export type UniqueKey = (row: Row) => string | null

export const CRM_UNIQUE_KEYS: Record<string, UniqueKey[]> = {
  conversations: [(r) => `${r.account_id}|${r.contact_id}`],
  contacts: [
    (r) => {
      const digits = normalizePhone(String(r.phone ?? ''))
      return digits ? `${r.account_id}|phone|${digits}` : null
    },
    (r) => (r.instagram_id ? `${r.account_id}|ig|${r.instagram_id}` : null),
  ],
}

export interface MemoryDbOptions {
  seed?: Record<string, Row[]>
  unique?: Record<string, UniqueKey[]>
  /** `table.op` pairs that fail with a generic error, e.g. `deals.insert`. */
  failures?: string[]
}

export interface MemoryDb {
  client: SupabaseClient
  rows(table: string): Row[]
}

type Op = 'select' | 'insert' | 'update' | 'delete' | 'upsert'

interface Result {
  data: unknown
  error: { message: string; code?: string } | null
  count?: number | null
}

export function memoryDb(opts: MemoryDbOptions = {}): MemoryDb {
  const tables: Record<string, Row[]> = {}
  const unique = opts.unique ?? CRM_UNIQUE_KEYS
  const failures = new Set(opts.failures ?? [])
  let seq = 0

  const table = (name: string) => (tables[name] ??= [])
  const withDefaults = (name: string, r: Row): Row => {
    seq += 1
    return {
      id: `${name}-${seq}`,
      // Strictly increasing so "oldest first" is deterministic.
      created_at: new Date(Date.UTC(2026, 0, 1) + seq * 1000).toISOString(),
      ...r,
    }
  }

  for (const [name, rows] of Object.entries(opts.seed ?? {})) {
    for (const r of rows) table(name).push(withDefaults(name, { ...r }))
  }

  function violates(name: string, candidate: Row, others: Row[]): boolean {
    for (const key of unique[name] ?? []) {
      const k = key(candidate)
      if (k !== null && others.some((o) => key(o) === k)) return true
    }
    return false
  }

  class Query implements PromiseLike<Result> {
    private op: Op = 'select'
    private payload: Row | Row[] | undefined
    private filters: ((r: Row) => boolean)[] = []
    private orders: { col: string; asc: boolean }[] = []
    private max = Infinity
    private returning = false
    private count = false
    private head = false
    private mode: 'many' | 'single' | 'maybe' = 'many'

    constructor(private name: string) {}

    select(_cols?: string, o?: { count?: string; head?: boolean }) {
      if (this.op === 'select') {
        this.count = Boolean(o?.count)
        this.head = Boolean(o?.head)
      } else {
        this.returning = true
      }
      return this
    }
    insert(p: Row | Row[]) {
      this.op = 'insert'
      this.payload = p
      return this
    }
    upsert(p: Row | Row[]) {
      this.op = 'upsert'
      this.payload = p
      return this
    }
    update(p: Row) {
      this.op = 'update'
      this.payload = p
      return this
    }
    delete() {
      this.op = 'delete'
      return this
    }
    eq(c: string, v: unknown) {
      this.filters.push((r) => r[c] === v)
      return this
    }
    neq(c: string, v: unknown) {
      this.filters.push((r) => r[c] !== v)
      return this
    }
    in(c: string, vs: unknown[]) {
      this.filters.push((r) => vs.includes(r[c]))
      return this
    }
    is(c: string, v: unknown) {
      this.filters.push((r) => (r[c] ?? null) === v)
      return this
    }
    like(c: string, pattern: string) {
      const re = new RegExp(
        '^' + pattern.split('%').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$',
      )
      this.filters.push((r) => re.test(String(r[c] ?? '')))
      return this
    }
    gte(c: string, v: unknown) {
      this.filters.push((r) => String(r[c]) >= String(v))
      return this
    }
    lte(c: string, v: unknown) {
      this.filters.push((r) => String(r[c]) <= String(v))
      return this
    }
    order(col: string, o?: { ascending?: boolean }) {
      this.orders.push({ col, asc: o?.ascending ?? true })
      return this
    }
    limit(n: number) {
      this.max = n
      return this
    }
    single() {
      this.mode = 'single'
      return this.exec()
    }
    maybeSingle() {
      this.mode = 'maybe'
      return this.exec()
    }
    then<A = Result, B = never>(
      onF?: ((v: Result) => A | PromiseLike<A>) | null,
      onR?: ((e: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      return this.exec().then(onF, onR)
    }

    private exec(): Promise<Result> {
      return Promise.resolve().then(() => this.run())
    }

    private matching(): Row[] {
      const rows = table(this.name).filter((r) => this.filters.every((f) => f(r)))
      if (this.orders.length > 0) {
        rows.sort((a, b) => {
          for (const { col, asc } of this.orders) {
            const numeric = typeof a[col] === 'number' && typeof b[col] === 'number'
            const x = numeric ? (a[col] as number) : String(a[col] ?? '')
            const y = numeric ? (b[col] as number) : String(b[col] ?? '')
            if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1)
          }
          return 0
        })
      }
      return rows.slice(0, this.max)
    }

    private shape(rows: Row[]): Result {
      if (this.mode === 'many') return { data: rows, error: null }
      if (rows.length === 1) return { data: rows[0], error: null }
      if (rows.length === 0 && this.mode === 'maybe') return { data: null, error: null }
      return { data: null, error: { message: `expected one row, got ${rows.length}`, code: 'PGRST116' } }
    }

    private run(): Result {
      if (failures.has(`${this.name}.${this.op}`)) {
        return { data: null, error: { message: `${this.name}.${this.op} failed`, code: 'XX000' } }
      }
      const rows = table(this.name)

      if (this.op === 'select') {
        const found = this.matching()
        if (this.count) {
          return { data: this.head ? null : found, error: null, count: found.length }
        }
        return this.shape(found)
      }

      if (this.op === 'insert' || this.op === 'upsert') {
        const items = (Array.isArray(this.payload) ? this.payload : [this.payload ?? {}]).map(
          (p) => withDefaults(this.name, { ...p }),
        )
        const accepted: Row[] = []
        for (const item of items) {
          if (violates(this.name, item, [...rows, ...accepted])) {
            // A plain INSERT fails as a whole; an upsert that hits the
            // conflict target leaves the existing row (ignoreDuplicates).
            if (this.op === 'upsert') continue
            return {
              data: null,
              error: { message: 'duplicate key value violates unique constraint', code: '23505' },
            }
          }
          accepted.push(item)
        }
        rows.push(...accepted)
        return this.returning ? this.shape(accepted) : { data: null, error: null }
      }

      if (this.op === 'update') {
        const found = rows.filter((r) => this.filters.every((f) => f(r)))
        for (const r of found) Object.assign(r, this.payload)
        return this.returning ? this.shape(found) : { data: null, error: null }
      }

      // delete
      const keep = rows.filter((r) => !this.filters.every((f) => f(r)))
      tables[this.name] = keep
      return { data: null, error: null }
    }
  }

  const client = {
    from: (name: string) => new Query(name),
    rpc: async () => ({ data: null, error: null }),
  } as unknown as SupabaseClient

  return { client, rows: (name) => table(name) }
}

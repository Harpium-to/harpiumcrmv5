import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { loadPipelineDonut } from './queries'

// Minimal PostgREST stand-in: every chain method returns the builder,
// `.range()` slices, and awaiting it resolves `{ data, error }` —
// capped at 1000 rows like the real server when no range is given.
function fakeDb(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? []
      let slice = rows.slice(0, 1000)
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        range(from: number, to: number) {
          slice = rows.slice(from, to + 1)
          return builder
        },
        then<T>(resolve: (r: { data: unknown[]; error: null }) => T) {
          return Promise.resolve(resolve({ data: slice, error: null }))
        },
      }
      return builder
    },
  } as unknown as SupabaseClient
}

describe('loadPipelineDonut', () => {
  it('sums NUMERIC strings and reads past the 1000-row cap', async () => {
    const deals = Array.from({ length: 1500 }, () => ({ stage_id: 's1', value: '10.50' }))
    const db = fakeDb({
      pipeline_stages: [{ id: 's1', name: 'Proposta', color: '#000' }],
      deals,
    })

    const out = await loadPipelineDonut(db)

    expect(out.stages[0].dealCount).toBe(1500)
    expect(out.stages[0].totalValue).toBe(15750)
    expect(out.totalValue).toBe(15750)
  })
})

import type { SupabaseClient } from '@supabase/supabase-js'

import { fakeDb, type Row } from '@/lib/leads/fake-db.test-helper'

export type RpcHandler = (args: Record<string, unknown>) => unknown

/** fakeDb + rpc(): enough of the admin client for the platform API tests. */
export function fakePlatformDb(
  tables: Record<string, Row[]>,
  rpcs: Record<string, RpcHandler> = {},
): SupabaseClient {
  const db = fakeDb(tables) as unknown as Record<string, unknown>
  db.rpc = async (fn: string, args: Record<string, unknown> = {}) => {
    const h = rpcs[fn]
    if (!h) return { data: null, error: { code: '42883', message: `function ${fn} does not exist` } }
    return { data: h(args), error: null }
  }
  return db as unknown as SupabaseClient
}

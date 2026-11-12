// ============================================================
// Runs the real migrations on PGlite (Postgres in WASM) so RLS and
// SECURITY DEFINER functions can be tested as they will run in
// Supabase. `supabase-stubs.sql` provides the small Supabase surface
// the migrations touch: auth.users / auth.uid(), storage.objects /
// storage.foldername(), the anon / authenticated / service_role
// roles, the realtime publication, and Supabase's default grants.
//
// A "session" is simulated the way PostgREST does it: SET ROLE
// authenticated + the JWT subject in `request.jwt.claim.sub`.
// ============================================================

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import { vector } from '@electric-sql/pglite-pgvector'

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations')
const STUBS = join(__dirname, 'supabase-stubs.sql')

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

export async function createDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { uuid_ossp, vector, btree_gist } })
  await db.exec(readFileSync(STUBS, 'utf8'))
  return db
}

export async function applyMigration(db: PGlite, file: string): Promise<void> {
  await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
}

/** Apply every migration whose file name sorts before `stopBefore`. */
export async function applyMigrationsBefore(
  db: PGlite,
  stopBefore: string,
): Promise<void> {
  for (const f of migrationFiles()) {
    if (f >= stopBefore) break
    await applyMigration(db, f)
  }
}

/** Rows of a query run as the superuser (service-role equivalent). */
export async function sql<T = Record<string, unknown>>(
  db: PGlite,
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await db.query<T>(query, params)
  return res.rows
}

/** Rows of a query run inside `userId`'s session (role authenticated). */
export async function asUser<T = Record<string, unknown>>(
  db: PGlite,
  userId: string,
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [
    userId,
  ])
  await db.exec('SET ROLE authenticated')
  try {
    const res = await db.query<T>(query, params)
    return res.rows
  } finally {
    await db.exec('RESET ROLE')
    await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`)
  }
}

/** The SQLSTATE a promise rejects with, or 'resolved'. */
export async function errorCode(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'resolved'
  } catch (err) {
    return (err as { code?: string }).code ?? 'unknown'
  }
}

export async function signUp(
  db: PGlite,
  id: string,
  name: string,
): Promise<void> {
  await db.query(
    `INSERT INTO auth.users (id, email, raw_user_meta_data)
     VALUES ($1, $2, jsonb_build_object('full_name', $3::text))`,
    [id, `${name.toLowerCase()}@teste.dev`, name],
  )
}

export async function activeAccountOf(
  db: PGlite,
  userId: string,
): Promise<string | null> {
  const rows = await sql<{ account_id: string | null }>(
    db,
    'SELECT account_id FROM profiles WHERE user_id = $1',
    [userId],
  )
  return rows[0]?.account_id ?? null
}

/** Mint an invitation as the service role and redeem it as `userId`. */
export async function inviteAndRedeem(
  db: PGlite,
  accountId: string,
  userId: string,
  role: 'owner' | 'admin' | 'agent' | 'viewer',
): Promise<void> {
  const token = `tok-${accountId}-${userId}-${role}`
  await sql(
    db,
    `INSERT INTO account_invitations (account_id, token_hash, role, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '1 day')`,
    [accountId, token, role],
  )
  await asUser(db, userId, 'SELECT redeem_invitation($1)', [token])
}

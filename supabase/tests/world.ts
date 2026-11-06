// ============================================================
// Shared test world for the platform migrations (049+).
//
// Built the way production will see it: migrations 001–048, users
// and a shared CRM created under the OLD model, then 049 applied
// twice (idempotency), then every later migration, then new signups
// under the new model.
// ============================================================

import type { PGlite } from '@electric-sql/pglite'

import {
  activeAccountOf,
  applyMigration,
  applyMigrationsBefore,
  asUser,
  createDb,
  inviteAndRedeem,
  migrationFiles,
  signUp,
  sql,
} from './harness'

export const M049 = '049_plataforma_acesso.sql'

export const U = {
  alice: '00000000-0000-4000-8000-0000000000a1', // owner of A
  bob: '00000000-0000-4000-8000-0000000000b2', // agent in A
  carol: '00000000-0000-4000-8000-0000000000c3', // viewer in A
  dave: '00000000-0000-4000-8000-0000000000d4', // owner of D
  agus: '00000000-0000-4000-8000-0000000000a5', // agency super_admin (pre-049)
  eve: '00000000-0000-4000-8000-0000000000e6', // signs up between the two 049 runs
  sara: '00000000-0000-4000-8000-0000000000f7', // agency support
  mel: '00000000-0000-4000-8000-000000000108', // agency manager
  mia: '00000000-0000-4000-8000-000000000119', // member of A and D
  otto: '00000000-0000-4000-8000-00000000012a', // outsider
}

export interface World {
  db: PGlite
  A: string
  D: string
  E: string
  miaPersonal: string
}

let base: Promise<World> | null = null

/**
 * A fresh, independent world. The first call in a test file builds it
 * (all migrations + seeds, the slow part); later calls clone that
 * database, so each describe still gets its own state.
 */
export async function buildWorld(): Promise<World> {
  base ??= buildFreshWorld()
  const world = await base
  return { ...world, db: (await world.db.clone()) as PGlite }
}

async function buildFreshWorld(): Promise<World> {
  const db = await createDb()
  await applyMigrationsBefore(db, M049)

  // ---- old model (pre-049) ----
  for (const [name, id] of [
    ['Alice', U.alice],
    ['Bob', U.bob],
    ['Carol', U.carol],
    ['Dave', U.dave],
    ['Agus', U.agus],
  ] as const) {
    await signUp(db, id, name)
  }
  const A = (await activeAccountOf(db, U.alice))!
  const D = (await activeAccountOf(db, U.dave))!
  await inviteAndRedeem(db, A, U.bob, 'agent')
  await inviteAndRedeem(db, A, U.carol, 'viewer')
  await sql(
    db,
    `INSERT INTO contacts (user_id, account_id, phone, name) VALUES
       ($1, $2, '5511900000001', 'Ana'),
       ($3, $4, '5511900000002', 'Duda')`,
    [U.alice, A, U.dave, D],
  )
  await sql(db, `INSERT INTO agencia_membros (user_id, label) VALUES ($1, 'Agus')`, [
    U.agus,
  ])

  // ---- 049, twice, with a signup in between ----
  await applyMigration(db, M049)
  await signUp(db, U.eve, 'Eve')
  const E = (await activeAccountOf(db, U.eve))!
  await applyMigration(db, M049)
  for (const f of migrationFiles()) {
    if (f > M049) await applyMigration(db, f)
  }

  // ---- new model ----
  for (const [name, id] of [
    ['Sara', U.sara],
    ['Mel', U.mel],
    ['Mia', U.mia],
    ['Otto', U.otto],
  ] as const) {
    await signUp(db, id, name)
  }
  await sql(
    db,
    `INSERT INTO agencia_membros (user_id, label, role) VALUES
       ($1, 'Sara', 'support'), ($2, 'Mel', 'manager')`,
    [U.sara, U.mel],
  )
  const miaPersonal = (await activeAccountOf(db, U.mia))!
  await inviteAndRedeem(db, A, U.mia, 'agent')
  await inviteAndRedeem(db, D, U.mia, 'viewer')

  return { db, A, D, E, miaPersonal }
}

export async function contactNames(db: PGlite, userId: string): Promise<string[]> {
  const rows = await asUser<{ name: string }>(
    db,
    userId,
    'SELECT name FROM contacts ORDER BY name',
  )
  return rows.map((r) => r.name)
}

export function insertContact(db: PGlite, userId: string, accountId: string, phone: string) {
  return asUser(
    db,
    userId,
    `INSERT INTO contacts (user_id, account_id, phone, name)
     VALUES (auth.uid(), $1, $2, 'Novo')`,
    [accountId, phone],
  )
}

export async function context(db: PGlite, userId: string) {
  const rows = await asUser<{ ctx: Record<string, unknown> | null }>(
    db,
    userId,
    'SELECT current_account_context() AS ctx',
  )
  return rows[0].ctx
}

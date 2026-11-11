// ============================================================
// Migration 060 — tasks and reminders for people, and the scopes the
// Chrome extension needs for them.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'

import { applyMigration, asUser, errorCode, sql } from './harness'
import { buildWorld, U, type World } from './world'

const M060 = '060_tarefas.sql'

const contactId = async (w: World, name: string) =>
  (await sql<{ id: string }>(w.db, 'SELECT id FROM contacts WHERE name = $1', [name]))[0].id

describe('060 — who can see and write a contact’s tasks', () => {
  let w: World
  let ana: string
  beforeAll(async () => {
    w = await buildWorld()
    ana = await contactId(w, 'Ana')
  })

  const addTask = (user: string, account: string, contact: string, title: string) =>
    asUser<{ id: string }>(
      w.db,
      user,
      `INSERT INTO contact_tasks (account_id, contact_id, title, created_by, assigned_to)
       VALUES ($1, $2, $3, auth.uid(), auth.uid()) RETURNING id`,
      [account, contact, title],
    )
  const titles = (user: string) =>
    asUser<{ title: string }>(w.db, user, 'SELECT title FROM contact_tasks ORDER BY title').then(
      (rows) => rows.map((r) => r.title),
    )

  it('an agent writes a task and the whole team reads it', async () => {
    await addTask(U.bob, w.A, ana, 'Ligar na quinta')
    expect(await titles(U.alice)).toEqual(['Ligar na quinta'])
    expect(await titles(U.carol)).toEqual(['Ligar na quinta']) // viewer
  })

  it('a viewer reads but cannot write', async () => {
    expect(await errorCode(addTask(U.carol, w.A, ana, 'Não devia'))).toBe('42501')
    const touched = await asUser(
      w.db,
      U.carol,
      `UPDATE contact_tasks SET done_at = NOW() RETURNING id`,
    )
    expect(touched).toEqual([])
    expect(await asUser(w.db, U.carol, 'DELETE FROM contact_tasks RETURNING id')).toEqual([])
  })

  it('another CRM sees nothing and cannot write into this one', async () => {
    expect(await titles(U.dave)).toEqual([])
    expect(await errorCode(addTask(U.dave, w.A, ana, 'De fora'))).toBe('42501')
    expect(await titles(U.otto)).toEqual([])
  })

  it('refuses a task with no title', async () => {
    expect(await errorCode(addTask(U.bob, w.A, ana, '   '))).toBe('23514')
  })

  it('an agent marks it done and deletes it', async () => {
    const done = await asUser<{ id: string }>(
      w.db,
      U.bob,
      `UPDATE contact_tasks SET done_at = NOW() WHERE title = 'Ligar na quinta' RETURNING id`,
    )
    expect(done).toHaveLength(1)
    await asUser(w.db, U.bob, 'DELETE FROM contact_tasks WHERE id = $1', [done[0].id])
    expect(await titles(U.alice)).toEqual([])
  })
})

describe('060 — reminders', () => {
  let w: World
  let ana: string
  beforeAll(async () => {
    w = await buildWorld()
    ana = await contactId(w, 'Ana')
  })

  const task = (title: string, due: string | null, assignee: string | null, done = false) =>
    sql<{ id: string }>(
      w.db,
      `INSERT INTO contact_tasks (account_id, contact_id, title, due_at, assigned_to, done_at)
       VALUES ($1, $2, $3, $4::timestamptz, $5, CASE WHEN $6 THEN NOW() ELSE NULL END)
       RETURNING id`,
      [w.A, ana, title, due, assignee, done],
    ).then((rows) => rows[0].id)
  const emit = () =>
    sql<{ n: number }>(w.db, 'SELECT emit_task_reminders() AS n').then((rows) => rows[0].n)
  const reminders = () =>
    sql<{ user_id: string; title: string; body: string; contact_id: string }>(
      w.db,
      `SELECT user_id, title, body, contact_id FROM notifications
       WHERE type = 'task_due' ORDER BY created_at, title`,
    )

  it('reminds whoever the task is for, once, when it comes due', async () => {
    await task('Ligar', '2020-01-01T10:00:00Z', U.bob)
    await task('Ainda não venceu', '2999-01-01T10:00:00Z', U.bob)
    await task('Já feita', '2020-01-01T10:00:00Z', U.bob, true)
    await task('Sem data', null, U.bob)

    expect(await emit()).toBe(1)
    expect(await reminders()).toEqual([
      { user_id: U.bob, title: 'Tarefa: Ligar', body: 'Ana', contact_id: ana },
    ])
    expect(await emit()).toBe(0)
    expect(await reminders()).toHaveLength(1)
  })

  it('does not notify someone who is not on that CRM’s team, or nobody', async () => {
    const outsider = await task('De quem saiu', '2020-01-01T10:00:00Z', U.otto)
    const nobody = await task('Sem responsável', '2020-01-01T10:00:00Z', null)
    expect(await emit()).toBe(0)
    // Stamped all the same, so they are not looked at again every minute.
    const stamped = await sql<{ id: string }>(
      w.db,
      'SELECT id FROM contact_tasks WHERE id = ANY($1) AND reminded_at IS NOT NULL',
      [[outsider, nobody]],
    )
    expect(stamped).toHaveLength(2)
  })

  it('reminds again after the task is moved to another date', async () => {
    const id = await task('Remarcada', '2020-01-01T10:00:00Z', U.bob)
    expect(await emit()).toBe(1)

    // An edit that is not a new date keeps the stamp…
    await sql(w.db, `UPDATE contact_tasks SET title = 'Remarcada de novo' WHERE id = $1`, [id])
    expect(await emit()).toBe(0)
    // …and a new date clears it.
    await sql(w.db, `UPDATE contact_tasks SET due_at = '2021-06-01T10:00:00Z' WHERE id = $1`, [id])
    expect(await emit()).toBe(1)
    const mine = (await reminders()).filter((r) => r.title.includes('Remarcada'))
    expect(mine.map((r) => r.title)).toEqual(['Tarefa: Remarcada', 'Tarefa: Remarcada de novo'])
  })

  it('cannot be called by a signed-in user', async () => {
    expect(await errorCode(asUser(w.db, U.bob, 'SELECT emit_task_reminders()'))).toBe('42501')
  })

  it('keeps the notification types that already existed, and still refuses unknown ones', async () => {
    const insert = (type: string) =>
      sql(
        w.db,
        `INSERT INTO notifications (account_id, user_id, type, title) VALUES ($1, $2, $3, 'x')`,
        [w.A, U.bob, type],
      )
    expect(await errorCode(insert('conversation_assigned'))).toBe('resolved')
    expect(await errorCode(insert('agency_access_request'))).toBe('resolved')
    expect(await errorCode(insert('task_due'))).toBe('resolved')
    expect(await errorCode(insert('qualquer_coisa'))).toBe('23514')
  })

  it('keeps a type another migration added, when it runs again', async () => {
    // What a later migration adding its own type would leave behind.
    await sql(w.db, 'ALTER TABLE notifications DROP CONSTRAINT notifications_type_check')
    await sql(
      w.db,
      `ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
       CHECK (type IN ('conversation_assigned', 'agency_access_request', 'task_due', 'de_outra_migration'))`,
    )
    await applyMigration(w.db, M060)
    const insert = (type: string) =>
      sql(
        w.db,
        `INSERT INTO notifications (account_id, user_id, type, title) VALUES ($1, $2, $3, 'x')`,
        [w.A, U.bob, type],
      )
    expect(await errorCode(insert('de_outra_migration'))).toBe('resolved')
    expect(await errorCode(insert('task_due'))).toBe('resolved')
    expect(await errorCode(insert('qualquer_coisa'))).toBe('23514')
  })
})

describe('060 — extension keys', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  const ALL = [
    'contacts:read',
    'contacts:write',
    'deals:read',
    'deals:write',
    'quick_replies:read',
    'tasks:read',
    'tasks:write',
    'conversations:read',
    'conversations:write',
  ]
  const scopesOf = (hash: string) =>
    sql<{ scopes: string[] }>(w.db, 'SELECT scopes FROM api_keys WHERE key_hash = $1', [
      hash,
    ]).then((rows) => rows[0].scopes)

  it('gives the missing scopes to the keys that already existed, and only to those', async () => {
    await sql(
      w.db,
      `INSERT INTO api_keys (account_id, created_by, user_id, kind, name, key_prefix, key_hash, scopes, revoked_at)
       VALUES ($1, $2, $2, 'extension', 'depois da 059', 'p1', 'after-059', $4, NULL),
              ($1, $3, $3, 'extension', 'só a 054', 'p2', 'only-054', $5, NULL),
              ($1, $6, $6, 'extension', 'revogada', 'p3', 'revoked', $5, NOW())`,
      [w.A, U.bob, U.alice, ALL.slice(0, 5), ALL.slice(0, 4), U.mia],
    )
    await sql(
      w.db,
      `INSERT INTO api_keys (account_id, created_by, name, key_prefix, key_hash, scopes)
       VALUES ($1, $2, 'Integração', 'p4', 'account-level', ARRAY['contacts:read'])`,
      [w.A, U.alice],
    )

    await applyMigration(w.db, M060)

    expect(await scopesOf('after-059')).toEqual(ALL)
    expect(await scopesOf('only-054')).toEqual(ALL)
    expect(await scopesOf('revoked')).toEqual(ALL.slice(0, 4))
    expect(await scopesOf('account-level')).toEqual(['contacts:read'])
  })

  it('is safe to run again', async () => {
    await applyMigration(w.db, M060)
    expect(await scopesOf('after-059')).toEqual(ALL)
  })
})

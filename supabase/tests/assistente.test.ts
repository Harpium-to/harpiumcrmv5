// ============================================================
// 074 — Harpi, the CRM assistant.
//
// Conversations are private to the person: nobody else in the CRM,
// the owner included, reads them. The changes the bot made
// (assistant_actions) are readable by the person and by the CRM's
// admins, and written only by the server. Memory is the CRM's: every
// member reads it. Another CRM sees none of it.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'

import { asUser, errorCode, sql } from './harness'
import { buildWorld, U, type World } from './world'

describe('074 — Harpi', () => {
  let w: World
  let aliceConv: string
  let bobConv: string

  beforeAll(async () => {
    w = await buildWorld()
    const [a] = await asUser<{ id: string }>(
      w.db,
      U.alice,
      `INSERT INTO assistant_conversations (account_id, user_id, title) VALUES ($1, $2, 'da Alice') RETURNING id`,
      [w.A, U.alice],
    )
    aliceConv = a.id
    const [b] = await asUser<{ id: string }>(
      w.db,
      U.bob,
      `INSERT INTO assistant_conversations (account_id, user_id, title) VALUES ($1, $2, 'do Bob') RETURNING id`,
      [w.A, U.bob],
    )
    bobConv = b.id
    await asUser(
      w.db,
      U.bob,
      `INSERT INTO assistant_messages (conversation_id, account_id, role, content) VALUES ($1, $2, 'user', '{"text":"oi"}')`,
      [bobConv, w.A],
    )
    // Server-side writes (service role).
    await sql(
      w.db,
      `INSERT INTO assistant_actions (account_id, conversation_id, user_id, tool, risk, preview)
       VALUES ($1, $2, $3, 'adicionar_nota', 'pequena', '{"title":"Nota"}')`,
      [w.A, bobConv, U.bob],
    )
    await sql(w.db, `INSERT INTO assistant_memory (account_id, content) VALUES ($1, 'Ticket médio R$ 4 mil')`, [w.A])
  })

  const count = async (userId: string, query: string, params: unknown[] = []) =>
    (await asUser<{ n: number }>(w.db, userId, query, params))[0]?.n ?? 0

  it('a conversation is only its owner’s — not even the CRM owner reads it', async () => {
    const q = 'SELECT count(*)::int AS n FROM assistant_conversations WHERE id = $1'
    expect(await count(U.bob, q, [bobConv])).toBe(1)
    expect(await count(U.alice, q, [bobConv])).toBe(0)
    expect(await count(U.carol, q, [bobConv])).toBe(0)
    const m = 'SELECT count(*)::int AS n FROM assistant_messages WHERE conversation_id = $1'
    expect(await count(U.bob, m, [bobConv])).toBe(1)
    expect(await count(U.alice, m, [bobConv])).toBe(0)
  })

  it('nobody writes into someone else’s conversation', async () => {
    const code = await errorCode(
      asUser(
        w.db,
        U.alice,
        `INSERT INTO assistant_messages (conversation_id, account_id, role, content) VALUES ($1, $2, 'user', '{}')`,
        [bobConv, w.A],
      ),
    )
    expect(code).toBe('42501')
  })

  it('a conversation cannot be opened in someone else’s name', async () => {
    const code = await errorCode(
      asUser(
        w.db,
        U.bob,
        `INSERT INTO assistant_conversations (account_id, user_id) VALUES ($1, $2)`,
        [w.A, U.alice],
      ),
    )
    expect(code).toBe('42501')
  })

  it('what the bot changed: the person and the admins read it, a viewer does not', async () => {
    const q = 'SELECT count(*)::int AS n FROM assistant_actions WHERE account_id = $1'
    expect(await count(U.bob, q, [w.A])).toBe(1)
    expect(await count(U.alice, q, [w.A])).toBe(1)
    expect(await count(U.carol, q, [w.A])).toBe(0)
    expect(await count(U.dave, q, [w.A])).toBe(0)
  })

  it('actions are written by the server only', async () => {
    const code = await errorCode(
      asUser(
        w.db,
        U.bob,
        `INSERT INTO assistant_actions (account_id, user_id, tool, risk) VALUES ($1, $2, 'x', 'pequena')`,
        [w.A, U.bob],
      ),
    )
    expect(code).toBe('42501')
    const updated = await asUser<{ id: string }>(
      w.db,
      U.bob,
      `UPDATE assistant_actions SET status = 'done' WHERE account_id = $1 RETURNING id`,
      [w.A],
    )
    expect(updated).toHaveLength(0)
  })

  it('memory is the CRM’s: members read it, another CRM does not', async () => {
    const q = 'SELECT count(*)::int AS n FROM assistant_memory WHERE account_id = $1'
    expect(await count(U.carol, q, [w.A])).toBe(1)
    expect(await count(U.dave, q, [w.A])).toBe(0)
  })

  it('a conversation of the active CRM only', async () => {
    const q = 'SELECT count(*)::int AS n FROM assistant_conversations WHERE id = $1'
    expect(await count(U.alice, q, [aliceConv])).toBe(1)
    expect(await count(U.dave, q, [aliceConv])).toBe(0)
  })

  it('usage and notifications accept the new values, keeping the old ones', async () => {
    await sql(
      w.db,
      `INSERT INTO ai_usage_log (account_id, mode, provider, model, prompt_tokens, completion_tokens, total_tokens)
       VALUES ($1, 'assistant', 'anthropic', 'm', 1, 1, 2), ($1, 'draft', 'openai', 'm', 1, 1, 2)`,
      [w.A],
    )
    await sql(
      w.db,
      `INSERT INTO notifications (account_id, user_id, type, title) VALUES
         ($1, $2, 'assistente', 'Rotina'), ($1, $2, 'agenda_google', 'G'), ($1, $2, 'task_due', 'T')`,
      [w.A, U.alice],
    )
    expect(await errorCode(sql(w.db, `INSERT INTO notifications (account_id, user_id, type, title) VALUES ($1, $2, 'nope', 'x')`, [w.A, U.alice]))).toBe('23514')
  })

  it('a routine’s time must be HH:MM', async () => {
    const code = await errorCode(
      sql(
        w.db,
        `INSERT INTO assistant_routines (account_id, user_id, name, instruction, run_time) VALUES ($1, $2, 'r', 'faça', '25:00')`,
        [w.A, U.alice],
      ),
    )
    expect(code).toBe('23514')
  })
})

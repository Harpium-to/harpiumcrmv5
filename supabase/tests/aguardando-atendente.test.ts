// ============================================================
// Migration 058 — conversations.needs_human_since: set when the AI
// hands a conversation to the team, cleared when a person writes to
// the customer, the AI is resumed or the conversation is closed.
// ============================================================

import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  activeAccountOf,
  applyMigration,
  applyMigrationsBefore,
  asUser,
  createDb,
  signUp,
  sql,
} from './harness'
import { buildWorld, U, type World } from './world'

const M058 = '058_aguardando_atendente.sql'

let phoneSeq = 0

/** One conversation per contact (036), so each gets a contact of its own. */
async function newConversation(db: PGlite, accountId: string, userId: string): Promise<string> {
  phoneSeq++
  const [{ id: contactId }] = await sql<{ id: string }>(
    db,
    `INSERT INTO contacts (user_id, account_id, phone, name)
     VALUES ($1, $2, '55119800' || lpad($3::text, 5, '0'), 'Cliente ' || $3)
     RETURNING id`,
    [userId, accountId, phoneSeq],
  )
  const [{ id }] = await sql<{ id: string }>(
    db,
    `INSERT INTO conversations (user_id, account_id, contact_id, status)
     VALUES ($1, $2, $3, 'open') RETURNING id`,
    [userId, accountId, contactId],
  )
  return id
}

async function since(db: PGlite, conv: string): Promise<string | null> {
  const [row] = await sql<{ needs_human_since: string | null }>(
    db,
    'SELECT needs_human_since FROM conversations WHERE id = $1',
    [conv],
  )
  return row.needs_human_since
}

const handOff = (db: PGlite, conv: string, note = 'Cliente quer orçamento') =>
  sql(
    db,
    `UPDATE conversations SET ai_autoreply_disabled = true, ai_handoff_summary = $2 WHERE id = $1`,
    [conv, note],
  )

const message = (db: PGlite, conv: string, sender: string, aiGenerated = false) =>
  sql(
    db,
    `INSERT INTO messages (conversation_id, sender_type, content_text, ai_generated)
     VALUES ($1, $2, 'x', $3)`,
    [conv, sender, aiGenerated],
  )

describe('058 — conversations waiting for a person', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  it('a handoff starts the wait; the AI notice and the customer do not end it', async () => {
    const conv = await newConversation(w.db, w.A, U.alice)
    expect(await since(w.db, conv)).toBeNull()

    await handOff(w.db, conv)
    const started = await since(w.db, conv)
    expect(started).not.toBeNull()

    await message(w.db, conv, 'bot', true) // "a equipe já vai te responder"
    await message(w.db, conv, 'bot') // an automation
    await message(w.db, conv, 'customer')
    expect(await since(w.db, conv)).toEqual(started)
  })

  it("a teammate's message ends the wait, through RLS as the agent", async () => {
    const conv = await newConversation(w.db, w.A, U.alice)
    await handOff(w.db, conv)
    await asUser(
      w.db,
      U.bob,
      `INSERT INTO messages (conversation_id, sender_type, sender_id, content_text)
       VALUES ($1, 'agent', $2, 'Oi, sou o Bob')`,
      [conv, U.bob],
    )
    expect(await since(w.db, conv)).toBeNull()
  })

  it('taking over without a handoff note is not a wait', async () => {
    const conv = await newConversation(w.db, w.A, U.alice)
    await sql(
      w.db,
      `UPDATE conversations SET ai_autoreply_disabled = true, assigned_agent_id = $2 WHERE id = $1`,
      [conv, U.bob],
    )
    expect(await since(w.db, conv)).toBeNull()
  })

  it('assigning after the handoff keeps the wait until someone writes', async () => {
    const conv = await newConversation(w.db, w.A, U.alice)
    await handOff(w.db, conv)
    const started = await since(w.db, conv)
    await sql(w.db, 'UPDATE conversations SET assigned_agent_id = $2 WHERE id = $1', [conv, U.bob])
    expect(await since(w.db, conv)).toEqual(started)
  })

  it('resuming the AI or closing the conversation ends the wait', async () => {
    const resumed = await newConversation(w.db, w.A, U.alice)
    await handOff(w.db, resumed)
    await sql(
      w.db,
      `UPDATE conversations SET ai_autoreply_disabled = false, ai_handoff_summary = NULL WHERE id = $1`,
      [resumed],
    )
    expect(await since(w.db, resumed)).toBeNull()

    const closed = await newConversation(w.db, w.A, U.alice)
    await handOff(w.db, closed)
    await sql(w.db, `UPDATE conversations SET status = 'closed' WHERE id = $1`, [closed])
    expect(await since(w.db, closed)).toBeNull()
  })

  it('a second handoff after resuming starts a new wait', async () => {
    const conv = await newConversation(w.db, w.A, U.alice)
    await handOff(w.db, conv)
    await message(w.db, conv, 'agent')
    await sql(
      w.db,
      `UPDATE conversations SET ai_autoreply_disabled = false, ai_handoff_summary = NULL WHERE id = $1`,
      [conv],
    )
    await handOff(w.db, conv, 'Pediu para falar com o gerente')
    expect(await since(w.db, conv)).not.toBeNull()
  })

  it('other CRMs only see their own waiting conversations', async () => {
    const conv = await newConversation(w.db, w.A, U.alice)
    await handOff(w.db, conv)
    const fromD = await asUser(
      w.db,
      U.dave,
      'SELECT id FROM conversations WHERE needs_human_since IS NOT NULL',
    )
    expect(fromD.map((r) => r.id)).not.toContain(conv)
    const fromA = await asUser(
      w.db,
      U.bob,
      'SELECT id FROM conversations WHERE needs_human_since IS NOT NULL',
    )
    expect(fromA.map((r) => r.id)).toContain(conv)
  })
})

describe('058 — backfill of conversations handed off before it', () => {
  it('marks only the open handoffs nobody answered, from the AI’s last message', async () => {
    const db = await createDb()
    await applyMigrationsBefore(db, M058)
    const owner = '00000000-0000-4000-8000-0000000005a1'
    await signUp(db, owner, 'Bia')
    const acct = (await activeAccountOf(db, owner))!

    const waiting = await newConversation(db, acct, owner)
    const answered = await newConversation(db, acct, owner)
    const closed = await newConversation(db, acct, owner)
    const active = await newConversation(db, acct, owner)
    for (const conv of [waiting, answered, closed]) {
      await sql(
        db,
        `UPDATE conversations SET ai_autoreply_disabled = true, ai_handoff_summary = 'nota' WHERE id = $1`,
        [conv],
      )
      await sql(
        db,
        `INSERT INTO messages (conversation_id, sender_type, content_text, ai_generated, created_at)
         VALUES ($1, 'bot', 'já te passo para a equipe', true, '2026-11-09T12:00:00Z')`,
        [conv],
      )
    }
    await sql(
      db,
      `INSERT INTO messages (conversation_id, sender_type, content_text, created_at)
       VALUES ($1, 'agent', 'Oi!', '2026-11-09T12:05:00Z')`,
      [answered],
    )
    await sql(db, `UPDATE conversations SET status = 'closed' WHERE id = $1`, [closed])

    await applyMigration(db, M058)

    expect(new Date((await since(db, waiting))!).toISOString()).toBe('2026-11-09T12:00:00.000Z')
    expect(await since(db, answered)).toBeNull()
    expect(await since(db, closed)).toBeNull()
    expect(await since(db, active)).toBeNull()

    // Applying it again changes nothing.
    await applyMigration(db, M058)
    expect(new Date((await since(db, waiting))!).toISOString()).toBe('2026-11-09T12:00:00.000Z')
  })
})

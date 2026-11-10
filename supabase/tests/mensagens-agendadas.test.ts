// ============================================================
// Migration 064 — messages scheduled for a contact.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'

import { applyMigration, asUser, errorCode, sql } from './harness'
import { buildWorld, U, type World } from './world'

const M064 = '064_mensagens_agendadas.sql'

const contactId = async (w: World, name: string) =>
  (await sql<{ id: string }>(w.db, 'SELECT id FROM contacts WHERE name = $1', [name]))[0].id

const schedule = (
  w: World,
  user: string,
  account: string,
  contact: string,
  text: string | null,
  sendAt = "NOW() + INTERVAL '1 day'",
  media: { kind: string; url: string | null } | null = null,
) =>
  asUser<{ id: string }>(
    w.db,
    user,
    `INSERT INTO scheduled_messages (account_id, contact_id, created_by, content_text, media_kind, media_url, send_at)
     VALUES ($1, $2, auth.uid(), $3, $4, $5, ${sendAt}) RETURNING id`,
    [account, contact, text, media?.kind ?? null, media?.url ?? null],
  )

describe('064 — who sees and schedules', () => {
  let w: World
  let ana: string
  beforeAll(async () => {
    w = await buildWorld()
    ana = await contactId(w, 'Ana')
  })

  const texts = (user: string) =>
    asUser<{ content_text: string }>(
      w.db,
      user,
      'SELECT content_text FROM scheduled_messages ORDER BY content_text',
    ).then((rows) => rows.map((r) => r.content_text))

  it('an agent schedules and the whole team sees it', async () => {
    await schedule(w, U.bob, w.A, ana, 'Oi, Ana! Conseguiu ver a proposta?')
    expect(await texts(U.alice)).toEqual(['Oi, Ana! Conseguiu ver a proposta?'])
    expect(await texts(U.carol)).toEqual(['Oi, Ana! Conseguiu ver a proposta?'])
  })

  it('a viewer cannot schedule or cancel', async () => {
    expect(await errorCode(schedule(w, U.carol, w.A, ana, 'Não devia'))).toBe('42501')
    expect(
      await asUser(w.db, U.carol, "UPDATE scheduled_messages SET status = 'cancelled' RETURNING id"),
    ).toEqual([])
  })

  it('another CRM sees nothing and cannot write into this one', async () => {
    expect(await texts(U.dave)).toEqual([])
    expect(await errorCode(schedule(w, U.dave, w.A, ana, 'De fora'))).toBe('42501')
  })

  it('needs a text, or a file', async () => {
    expect(await errorCode(schedule(w, U.bob, w.A, ana, '  '))).toBe('23514')
    expect(await errorCode(schedule(w, U.bob, w.A, ana, null, undefined, { kind: 'image', url: null }))).toBe(
      '23514',
    )
    // A file with no caption is fine.
    await schedule(w, U.bob, w.A, ana, null, undefined, { kind: 'image', url: 'https://x/a.jpg' })
  })

  it('an agent cancels', async () => {
    const done = await asUser<{ id: string }>(
      w.db,
      U.bob,
      "UPDATE scheduled_messages SET status = 'cancelled' WHERE content_text LIKE 'Oi, Ana%' RETURNING id",
    )
    expect(done).toHaveLength(1)
  })
})

describe('064 — the scheduler claims what is due, once', () => {
  let w: World
  let ana: string
  beforeAll(async () => {
    w = await buildWorld()
    ana = await contactId(w, 'Ana')
  })

  const claim = () =>
    sql<{ content_text: string; status: string }>(w.db, 'SELECT * FROM claim_scheduled_messages()')

  it('hands over only due, scheduled messages, and marks them sending', async () => {
    await schedule(w, U.bob, w.A, ana, 'vencida', "NOW() - INTERVAL '5 minutes'")
    await schedule(w, U.bob, w.A, ana, 'amanhã', "NOW() + INTERVAL '1 day'")
    await schedule(w, U.bob, w.A, ana, 'cancelada', "NOW() - INTERVAL '1 hour'")
    await sql(w.db, "UPDATE scheduled_messages SET status = 'cancelled' WHERE content_text = 'cancelada'")

    const first = await claim()
    expect(first.map((r) => [r.content_text, r.status])).toEqual([['vencida', 'sending']])
    expect(await claim()).toEqual([])
  })

  it('is the scheduler’s alone', async () => {
    expect(await errorCode(asUser(w.db, U.bob, 'SELECT * FROM claim_scheduled_messages()'))).toBe('42501')
  })

  it('is safe to run again', async () => {
    await applyMigration(w.db, M064)
    const rows = await sql<{ n: number }>(w.db, 'SELECT count(*)::int AS n FROM scheduled_messages')
    expect(rows[0].n).toBe(3)
  })
})

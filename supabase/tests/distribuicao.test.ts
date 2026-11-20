// ============================================================
// Migration 076 — distribution of conversations: the rotation,
// "Recebe conversas", transfer_conversation(), the history trigger
// and the Portuguese notification.
// ============================================================

import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

import { asUser, errorCode, sql } from './harness'
import { buildWorld, U, type World } from './world'

let phoneSeq = 0

async function newConversation(db: PGlite, accountId: string, userId: string): Promise<string> {
  phoneSeq++
  const [{ id: contactId }] = await sql<{ id: string }>(
    db,
    `INSERT INTO contacts (user_id, account_id, phone, name)
     VALUES ($1, $2, '55119700' || lpad($3::text, 5, '0'), 'Paciente ' || $3)
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

type Result = {
  ok: boolean
  changed: boolean
  reason?: string
  from_user_id: string | null
  to_user_id: string | null
}

/** transfer_conversation() as the service role (the AI, a job, an automation). */
async function transferAsSystem(
  db: PGlite,
  conv: string,
  mode: string,
  opts: { to?: string; source?: string; note?: string; actor?: string; onlyIfUnassigned?: boolean; waiting?: boolean } = {},
): Promise<Result> {
  const [row] = await sql<{ r: Result }>(
    db,
    `SELECT transfer_conversation($1, $2, $3, $4, $5, $6, $7, $8) AS r`,
    [
      conv,
      mode,
      opts.to ?? null,
      opts.source ?? 'automacao',
      opts.note ?? null,
      opts.actor ?? null,
      opts.onlyIfUnassigned ?? false,
      opts.waiting ?? false,
    ],
  )
  return row.r
}

async function transferAsUser(
  db: PGlite,
  userId: string,
  conv: string,
  mode: string,
  opts: { to?: string; source?: string; note?: string; onlyIfUnassigned?: boolean } = {},
): Promise<Result> {
  const [row] = await asUser<{ r: Result }>(
    db,
    userId,
    `SELECT transfer_conversation($1, $2, $3, $4, $5, NULL, $6, false) AS r`,
    [conv, mode, opts.to ?? null, opts.source ?? 'manual', opts.note ?? null, opts.onlyIfUnassigned ?? false],
  )
  return row.r
}

async function owner(db: PGlite, conv: string): Promise<string | null> {
  const [row] = await sql<{ assigned_agent_id: string | null }>(
    db,
    'SELECT assigned_agent_id FROM conversations WHERE id = $1',
    [conv],
  )
  return row.assigned_agent_id
}

const online = (db: PGlite, userId: string, accountId: string) =>
  sql(
    db,
    `INSERT INTO member_presence (user_id, account_id, status, last_seen_at)
     VALUES ($1, $2, 'online', now())
     ON CONFLICT (user_id) DO UPDATE
       SET status = 'online', last_seen_at = now(), account_id = excluded.account_id`,
    [userId, accountId],
  )

const offline = (db: PGlite, userId: string) =>
  sql(db, 'DELETE FROM member_presence WHERE user_id = $1', [userId])

describe('076 — the rotation', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  it('shares conversations evenly among those who answer, never a viewer or the agency', async () => {
    const picks: string[] = []
    for (let i = 0; i < 6; i++) {
      const conv = await newConversation(w.db, w.A, U.alice)
      const r = await transferAsSystem(w.db, conv, 'rodizio', { source: 'rodizio' })
      expect(r.ok).toBe(true)
      picks.push(r.to_user_id!)
    }
    const counts = picks.reduce<Record<string, number>>((acc, id) => {
      acc[id] = (acc[id] ?? 0) + 1
      return acc
    }, {})
    // A's people who answer chats: Alice (owner), Bob and Mia (agents).
    expect(Object.keys(counts).sort()).toEqual([U.alice, U.bob, U.mia].sort())
    expect(Object.values(counts)).toEqual([2, 2, 2])
    // The turn goes round in the same order each lap.
    expect(picks.slice(3)).toEqual(picks.slice(0, 3))
    expect(picks).not.toContain(U.carol) // viewer
    expect(picks).not.toContain(U.agus) // agency staff
  })

  it('someone online goes before those offline', async () => {
    await online(w.db, U.mia, w.A)
    const conv = await newConversation(w.db, w.A, U.alice)
    const r = await transferAsSystem(w.db, conv, 'rodizio')
    expect(r.to_user_id).toBe(U.mia)
    await offline(w.db, U.mia)
  })

  it('"Recebe conversas" off takes a person out of the turn', async () => {
    await asUser(w.db, U.bob, 'SELECT set_receives_conversations($1, false)', [U.bob])
    for (let i = 0; i < 4; i++) {
      const conv = await newConversation(w.db, w.A, U.alice)
      const r = await transferAsSystem(w.db, conv, 'rodizio')
      expect(r.to_user_id).not.toBe(U.bob)
    }
    await asUser(w.db, U.bob, 'SELECT set_receives_conversations($1, true)', [U.bob])
  })

  it('only admins change it for someone else', async () => {
    expect(
      await errorCode(asUser(w.db, U.bob, 'SELECT set_receives_conversations($1, false)', [U.mia])),
    ).toBe('42501')
    await asUser(w.db, U.alice, 'SELECT set_receives_conversations($1, false)', [U.mia])
    const [row] = await sql<{ receives_conversations: boolean }>(
      w.db,
      'SELECT receives_conversations FROM account_members WHERE account_id = $1 AND user_id = $2',
      [w.A, U.mia],
    )
    expect(row.receives_conversations).toBe(false)
    await asUser(w.db, U.alice, 'SELECT set_receives_conversations($1, true)', [U.mia])
  })

  it('nobody available is an answer, not an error', async () => {
    for (const id of [U.alice, U.bob, U.mia]) {
      await sql(
        w.db,
        'UPDATE account_members SET receives_conversations = false WHERE account_id = $1 AND user_id = $2',
        [w.A, id],
      )
    }
    const conv = await newConversation(w.db, w.A, U.alice)
    const r = await transferAsSystem(w.db, conv, 'rodizio')
    expect(r).toMatchObject({ ok: false, changed: false, reason: 'nobody_available' })
    expect(await owner(w.db, conv)).toBeNull()
    await sql(w.db, 'UPDATE account_members SET receives_conversations = true WHERE account_id = $1', [w.A])
  })
})

describe('076 — transfer_conversation()', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  it('a teammate passes it to someone, with a note, and the history says so', async () => {
    const conv = await newConversation(w.db, w.A, U.alice)
    const r = await transferAsUser(w.db, U.bob, conv, 'pessoa', { to: U.mia, note: 'quer parcelar' })
    expect(r).toMatchObject({ ok: true, changed: true, from_user_id: null, to_user_id: U.mia })

    const history = await sql<{ from_user_id: string | null; to_user_id: string; actor_user_id: string; source: string; note: string }>(
      w.db,
      'SELECT from_user_id, to_user_id, actor_user_id, source, note FROM conversation_transfers WHERE conversation_id = $1',
      [conv],
    )
    expect(history).toEqual([
      { from_user_id: null, to_user_id: U.mia, actor_user_id: U.bob, source: 'manual', note: 'quer parcelar' },
    ])

    const [n] = await sql<{ title: string; body: string; actor_user_id: string }>(
      w.db,
      `SELECT title, body, actor_user_id FROM notifications
        WHERE user_id = $1 AND conversation_id = $2`,
      [U.mia, conv],
    )
    expect(n.title).toBe('Conversa para você')
    expect(n.body).toMatch(/^Bob passou para você a conversa com Paciente \d+ · quer parcelar$/)
    expect(n.actor_user_id).toBe(U.bob)
  })

  it('a person in the app cannot pose as the AI or a job', async () => {
    const conv = await newConversation(w.db, w.A, U.alice)
    await transferAsUser(w.db, U.bob, conv, 'pessoa', { to: U.alice, source: 'ia' })
    const [row] = await sql<{ source: string }>(
      w.db,
      'SELECT source FROM conversation_transfers WHERE conversation_id = $1',
      [conv],
    )
    expect(row.source).toBe('manual')
  })

  it('the AI passing it says so in the notification', async () => {
    const conv = await newConversation(w.db, w.A, U.alice)
    await transferAsSystem(w.db, conv, 'pessoa', { to: U.bob, source: 'ia', note: 'Pediu orçamento de implante' })
    const [n] = await sql<{ body: string; actor_user_id: string | null }>(
      w.db,
      'SELECT body, actor_user_id FROM notifications WHERE user_id = $1 AND conversation_id = $2',
      [U.bob, conv],
    )
    expect(n.body).toMatch(/^A IA passou para você a conversa com Paciente \d+ · Pediu orçamento de implante$/)
    expect(n.actor_user_id).toBeNull()
  })

  it('nobody is notified of a conversation they took themselves', async () => {
    const inApp = await newConversation(w.db, w.A, U.alice)
    await transferAsUser(w.db, U.bob, inApp, 'pessoa', { to: U.bob })
    const viaApi = await newConversation(w.db, w.A, U.alice)
    await transferAsSystem(w.db, viaApi, 'pessoa', { to: U.bob, source: 'api', actor: U.bob })
    const rows = await sql(
      w.db,
      'SELECT 1 FROM notifications WHERE user_id = $1 AND conversation_id = ANY($2::uuid[])',
      [U.bob, [inApp, viaApi]],
    )
    expect(rows).toHaveLength(0)
    expect(await owner(w.db, inApp)).toBe(U.bob)
    expect(await owner(w.db, viaApi)).toBe(U.bob)
  })

  it('"Pegar": the second of two claims loses', async () => {
    const conv = await newConversation(w.db, w.A, U.alice)
    const first = await transferAsUser(w.db, U.bob, conv, 'pessoa', { to: U.bob, onlyIfUnassigned: true })
    // Alice, not Mia: Mia's open CRM is D, and a person acts in the CRM they have open.
    const second = await transferAsUser(w.db, U.alice, conv, 'pessoa', { to: U.alice, onlyIfUnassigned: true })
    expect(first).toMatchObject({ ok: true, changed: true })
    expect(second).toMatchObject({ ok: false, reason: 'already_assigned', to_user_id: U.bob })
    expect(await owner(w.db, conv)).toBe(U.bob)
  })

  it('only to people who answer in this CRM', async () => {
    const conv = await newConversation(w.db, w.A, U.alice)
    expect(await errorCode(transferAsUser(w.db, U.bob, conv, 'pessoa', { to: U.carol }))).toBe('22023') // viewer
    expect(await errorCode(transferAsUser(w.db, U.bob, conv, 'pessoa', { to: U.dave }))).toBe('22023') // other CRM
    expect(await errorCode(transferAsUser(w.db, U.bob, conv, 'quem-sabe'))).toBe('22023')
  })

  it('a viewer, or someone from another CRM, cannot transfer', async () => {
    const conv = await newConversation(w.db, w.A, U.alice)
    expect(await errorCode(transferAsUser(w.db, U.carol, conv, 'pessoa', { to: U.bob }))).toBe('42501')
    expect(await errorCode(transferAsUser(w.db, U.dave, conv, 'pessoa', { to: U.bob }))).toBe('42501')
    expect(await owner(w.db, conv)).toBeNull()
  })

  it('back to the shared queue clears assigned_at; a new owner stamps it', async () => {
    const conv = await newConversation(w.db, w.A, U.alice)
    await transferAsSystem(w.db, conv, 'pessoa', { to: U.bob })
    const [a] = await sql<{ assigned_at: string | null }>(w.db, 'SELECT assigned_at FROM conversations WHERE id = $1', [conv])
    expect(a.assigned_at).not.toBeNull()
    await transferAsSystem(w.db, conv, 'ninguem')
    const [b] = await sql<{ assigned_at: string | null }>(w.db, 'SELECT assigned_at FROM conversations WHERE id = $1', [conv])
    expect(b.assigned_at).toBeNull()
    expect(await owner(w.db, conv)).toBeNull()
  })

  it('"waiting" pauses the AI and starts the wait in the same write', async () => {
    const conv = await newConversation(w.db, w.A, U.alice)
    await transferAsSystem(w.db, conv, 'pessoa', { to: U.bob, source: 'fluxo', waiting: true })
    const [row] = await sql<{ ai_autoreply_disabled: boolean; needs_human_since: string | null }>(
      w.db,
      'SELECT ai_autoreply_disabled, needs_human_since FROM conversations WHERE id = $1',
      [conv],
    )
    expect(row.ai_autoreply_disabled).toBe(true)
    expect(row.needs_human_since).not.toBeNull()
  })

  it('an assignment that bypasses the function still lands in the history', async () => {
    const conv = await newConversation(w.db, w.A, U.alice)
    await sql(w.db, 'UPDATE conversations SET assigned_agent_id = $2 WHERE id = $1', [conv, U.mia])
    await asUser(w.db, U.bob, 'UPDATE conversations SET assigned_agent_id = $2 WHERE id = $1', [conv, U.bob])
    const rows = await sql<{ source: string; actor_user_id: string | null; to_user_id: string }>(
      w.db,
      'SELECT source, actor_user_id, to_user_id FROM conversation_transfers WHERE conversation_id = $1 ORDER BY created_at, to_user_id',
      [conv],
    )
    // Same millisecond is possible: compare without relying on the order.
    expect(rows).toHaveLength(2)
    expect(rows).toEqual(
      expect.arrayContaining([
        { source: 'outro', actor_user_id: null, to_user_id: U.mia },
        { source: 'manual', actor_user_id: U.bob, to_user_id: U.bob },
      ]),
    )
  })

  it('the history is readable by the CRM and nobody else, and not writable', async () => {
    const conv = await newConversation(w.db, w.A, U.alice)
    await transferAsSystem(w.db, conv, 'pessoa', { to: U.bob })
    expect(
      await asUser(w.db, U.carol, 'SELECT id FROM conversation_transfers WHERE conversation_id = $1', [conv]),
    ).toHaveLength(1)
    expect(
      await asUser(w.db, U.dave, 'SELECT id FROM conversation_transfers WHERE conversation_id = $1', [conv]),
    ).toHaveLength(0)
    expect(
      await errorCode(
        asUser(
          w.db,
          U.bob,
          `INSERT INTO conversation_transfers (account_id, conversation_id, to_user_id) VALUES ($1, $2, $3)`,
          [w.A, conv, U.bob],
        ),
      ),
    ).toBe('42501')
  })
})

// ------------------------------------------------------------
// 077 — setores
// ------------------------------------------------------------

type TeamOpts = {
  name?: string
  code?: string
  mode?: 'rodizio' | 'menos_ocupado' | 'fila'
  onlineOnly?: boolean
  maxOpen?: number | null
  members?: string[]
}

let teamSeq = 0

async function newTeam(db: PGlite, accountId: string, opts: TeamOpts = {}): Promise<string> {
  teamSeq++
  const [{ id }] = await sql<{ id: string }>(
    db,
    `INSERT INTO teams (account_id, name, code, mode, online_only, max_open_per_person)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      accountId,
      opts.name ?? `Setor ${teamSeq}`,
      opts.code ?? `setor-${teamSeq}`,
      opts.mode ?? 'rodizio',
      opts.onlineOnly ?? false,
      opts.maxOpen ?? null,
    ],
  )
  for (const userId of opts.members ?? []) {
    await sql(db, 'INSERT INTO team_members (team_id, account_id, user_id) VALUES ($1, $2, $3)', [id, accountId, userId])
  }
  return id
}

type TeamResult = Result & { team_id: string | null }

async function toTeam(db: PGlite, conv: string, teamId: string, note: string | null = null): Promise<TeamResult> {
  const [row] = await sql<{ r: TeamResult }>(
    db,
    `SELECT transfer_conversation($1, 'setor', NULL, 'ia', $2, NULL, false, false, $3) AS r`,
    [conv, note, teamId],
  )
  return row.r
}

async function teamOf(db: PGlite, conv: string): Promise<string | null> {
  const [row] = await sql<{ team_id: string | null }>(db, 'SELECT team_id FROM conversations WHERE id = $1', [conv])
  return row.team_id
}

describe('077 — setores', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  it('the turn goes round inside the setor only', async () => {
    const team = await newTeam(w.db, w.A, { members: [U.bob, U.mia] })
    const picks: string[] = []
    for (let i = 0; i < 4; i++) {
      const conv = await newConversation(w.db, w.A, U.alice)
      const r = await toTeam(w.db, conv, team)
      expect(r).toMatchObject({ ok: true, changed: true, team_id: team })
      picks.push(r.to_user_id!)
    }
    expect(picks.filter((p) => p === U.bob)).toHaveLength(2)
    expect(picks.filter((p) => p === U.mia)).toHaveLength(2)
    expect(picks).not.toContain(U.alice)
  })

  it('"só online" with nobody online: the conversation waits in the setor queue and the setor is told once', async () => {
    const team = await newTeam(w.db, w.A, { name: 'Financeiro', onlineOnly: true, members: [U.bob] })
    const first = await newConversation(w.db, w.A, U.alice)
    const r = await toTeam(w.db, first, team, 'quer parcelar')
    expect(r).toMatchObject({ ok: true, reason: 'queued', to_user_id: null, team_id: team })
    expect(await owner(w.db, first)).toBeNull()
    expect(await teamOf(w.db, first)).toBe(team)

    const second = await newConversation(w.db, w.A, U.alice)
    await toTeam(w.db, second, team)

    const notes = await sql<{ title: string; body: string; conversation_id: string }>(
      w.db,
      `SELECT title, body, conversation_id FROM notifications WHERE user_id = $1 AND type = 'team_queue'`,
      [U.bob],
    )
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ title: 'Conversa na fila de Financeiro', conversation_id: first })
    expect(notes[0].body).toMatch(/Ninguém do setor está disponível: .* · quer parcelar$/)

    // Bob comes online: the next one goes to him.
    await online(w.db, U.bob, w.A)
    const third = await newConversation(w.db, w.A, U.alice)
    expect((await toTeam(w.db, third, team)).to_user_id).toBe(U.bob)
    await offline(w.db, U.bob)
  })

  it('"fila": nobody is picked; whoever takes it first keeps it', async () => {
    const team = await newTeam(w.db, w.A, { mode: 'fila', members: [U.bob, U.alice] })
    const conv = await newConversation(w.db, w.A, U.alice)
    expect(await toTeam(w.db, conv, team)).toMatchObject({ reason: 'queued', to_user_id: null })
    const bob = await transferAsUser(w.db, U.bob, conv, 'pessoa', { to: U.bob, onlyIfUnassigned: true })
    const alice = await transferAsUser(w.db, U.alice, conv, 'pessoa', { to: U.alice, onlyIfUnassigned: true })
    expect(bob.ok).toBe(true)
    expect(alice).toMatchObject({ ok: false, reason: 'already_assigned' })
    // Bob is in the setor: it stays in the setor, now his.
    expect(await teamOf(w.db, conv)).toBe(team)
  })

  it('"menos ocupado" and the per-person limit', async () => {
    const team = await newTeam(w.db, w.A, { mode: 'menos_ocupado', members: [U.bob, U.mia], maxOpen: 50 })
    const [{ bob_open, mia_open }] = await sql<{ bob_open: number; mia_open: number }>(
      w.db,
      `SELECT count(*) FILTER (WHERE assigned_agent_id = $2)::int AS bob_open,
              count(*) FILTER (WHERE assigned_agent_id = $3)::int AS mia_open
         FROM conversations WHERE account_id = $1 AND status <> 'closed'`,
      [w.A, U.bob, U.mia],
    )
    const conv = await newConversation(w.db, w.A, U.alice)
    const r = await toTeam(w.db, conv, team)
    expect(r.to_user_id).toBe(bob_open <= mia_open ? U.bob : U.mia)

    // Both at their limit: queued.
    await sql(w.db, 'UPDATE teams SET max_open_per_person = 1 WHERE id = $1', [team])
    const full = await newConversation(w.db, w.A, U.alice)
    expect(await toTeam(w.db, full, team)).toMatchObject({ reason: 'queued', to_user_id: null })
  })

  it('a person outside the setor takes it out of the setor; the history keeps both sides', async () => {
    const team = await newTeam(w.db, w.A, { members: [U.bob] })
    const conv = await newConversation(w.db, w.A, U.alice)
    await toTeam(w.db, conv, team, 'quer avaliação')
    await transferAsUser(w.db, U.bob, conv, 'pessoa', { to: U.alice, note: 'caso da doutora' })
    expect(await teamOf(w.db, conv)).toBeNull()

    const rows = await sql<{ from_team_id: string | null; to_team_id: string | null; to_user_id: string; source: string; note: string }>(
      w.db,
      `SELECT from_team_id, to_team_id, to_user_id, source, note
         FROM conversation_transfers WHERE conversation_id = $1 ORDER BY created_at, source`,
      [conv],
    )
    expect(rows).toEqual([
      { from_team_id: null, to_team_id: team, to_user_id: U.bob, source: 'ia', note: 'quer avaliação' },
      { from_team_id: team, to_team_id: null, to_user_id: U.alice, source: 'manual', note: 'caso da doutora' },
    ])
  })

  it("the notification names the setor", async () => {
    const team = await newTeam(w.db, w.A, { name: 'Orçamentos', members: [U.mia] })
    const conv = await newConversation(w.db, w.A, U.alice)
    await toTeam(w.db, conv, team, 'implante')
    const [n] = await sql<{ body: string }>(
      w.db,
      'SELECT body FROM notifications WHERE user_id = $1 AND conversation_id = $2',
      [U.mia, conv],
    )
    expect(n.body).toMatch(/^A IA passou para você a conversa com Paciente \d+ · Orçamentos · implante$/)
  })

  it('"Retomar IA" takes it out of the setor', async () => {
    const team = await newTeam(w.db, w.A, { mode: 'fila', members: [U.bob] })
    // Released by the transfer itself...
    const a = await newConversation(w.db, w.A, U.alice)
    await toTeam(w.db, a, team)
    await sql(w.db, `SELECT transfer_conversation($1, 'ninguem', NULL, 'manual', NULL, NULL, false, false, NULL, true)`, [a])
    expect(await teamOf(w.db, a)).toBeNull()
    // ...or by the AI coming back on a conversation nobody owns.
    const b = await newConversation(w.db, w.A, U.alice)
    await sql(w.db, `UPDATE conversations SET ai_autoreply_disabled = true WHERE id = $1`, [b])
    await toTeam(w.db, b, team)
    await sql(w.db, `UPDATE conversations SET ai_autoreply_disabled = false WHERE id = $1`, [b])
    expect(await teamOf(w.db, b)).toBeNull()
    // Back to the queue without leaving: stays in the setor.
    const c = await newConversation(w.db, w.A, U.alice)
    await toTeam(w.db, c, team)
    await sql(w.db, `SELECT transfer_conversation($1, 'ninguem')`, [c])
    expect(await teamOf(w.db, c)).toBe(team)
  })

  it('only setores of this CRM, only teammates in a setor', async () => {
    const other = await newTeam(w.db, w.D, {})
    const conv = await newConversation(w.db, w.A, U.alice)
    expect(await errorCode(toTeam(w.db, conv, other))).toBe('22023')
    const team = await newTeam(w.db, w.A, {})
    // Dave is not a member of A.
    expect(
      await errorCode(
        sql(w.db, 'INSERT INTO team_members (team_id, account_id, user_id) VALUES ($1, $2, $3)', [team, w.A, U.dave]),
      ),
    ).toBe('23503')
  })

  it('everyone reads the setores; only admins change them', async () => {
    const team = await newTeam(w.db, w.A, { name: 'Recepção', code: 'recepcao-rls' })
    expect(await asUser(w.db, U.carol, 'SELECT id FROM teams WHERE id = $1', [team])).toHaveLength(1)
    expect(await asUser(w.db, U.dave, 'SELECT id FROM teams WHERE id = $1', [team])).toHaveLength(0)
    expect(
      await errorCode(
        asUser(w.db, U.bob, `INSERT INTO teams (account_id, name, code) VALUES ($1, 'X', 'x-bob')`, [w.A]),
      ),
    ).toBe('42501')
    await asUser(w.db, U.alice, `INSERT INTO teams (account_id, name, code) VALUES ($1, 'Y', 'y-alice')`, [w.A])
    await asUser(w.db, U.alice, 'INSERT INTO team_members (team_id, account_id, user_id) VALUES ($1, $2, $3)', [team, w.A, U.bob])
    expect(
      await errorCode(
        asUser(w.db, U.bob, 'DELETE FROM team_members WHERE team_id = $1 RETURNING 1', [team]).then((rows) => {
          if (rows.length === 0) throw Object.assign(new Error('nada apagado'), { code: 'none' })
        }),
      ),
    ).toBe('none')
  })

  it('one entry setor per CRM', async () => {
    await newTeam(w.db, w.A, { code: 'entrada-1' }).then((id) => sql(w.db, 'UPDATE teams SET is_entry = true WHERE id = $1', [id]))
    const second = await newTeam(w.db, w.A, { code: 'entrada-2' })
    expect(await errorCode(sql(w.db, 'UPDATE teams SET is_entry = true WHERE id = $1', [second]))).toBe('23505')
  })
})

// ------------------------------------------------------------
// 078 — chegada, retorno e prazo
// ------------------------------------------------------------

describe('078 — return, deadline and queues', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  it('an inbound reopen is claimed once; a person reopening is not a return', async () => {
    const conv = await newConversation(w.db, w.A, U.alice)
    await transferAsSystem(w.db, conv, 'pessoa', { to: U.bob })
    await sql(w.db, `UPDATE conversations SET status = 'closed' WHERE id = $1`, [conv])
    // The webhook (service role) reopens it.
    await sql(w.db, `UPDATE conversations SET status = 'open' WHERE id = $1`, [conv])
    const first = await sql<{ assigned_agent_id: string; owner_available: boolean }>(
      w.db, 'SELECT * FROM claim_reopened($1)', [conv])
    const second = await sql(w.db, 'SELECT * FROM claim_reopened($1)', [conv])
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ assigned_agent_id: U.bob, owner_available: false })
    expect(second).toHaveLength(0)

    // Bob online → available.
    await sql(w.db, `UPDATE conversations SET status = 'closed' WHERE id = $1`, [conv])
    await sql(w.db, `UPDATE conversations SET status = 'open' WHERE id = $1`, [conv])
    await online(w.db, U.bob, w.A)
    const [again] = await sql<{ owner_available: boolean }>(w.db, 'SELECT * FROM claim_reopened($1)', [conv])
    expect(again.owner_available).toBe(true)
    await offline(w.db, U.bob)

    // Alice reopening it in the inbox: nothing pending.
    await sql(w.db, `UPDATE conversations SET status = 'closed' WHERE id = $1`, [conv])
    await asUser(w.db, U.alice, `UPDATE conversations SET status = 'open' WHERE id = $1`, [conv])
    expect(await sql(w.db, 'SELECT * FROM claim_reopened($1)', [conv])).toHaveLength(0)
  })

  it('past the deadline: warns once per owner, or moves to the next person', async () => {
    const warn = await newTeam(w.db, w.A, { name: 'Recepção', members: [U.bob, U.mia] })
    await sql(w.db, `UPDATE teams SET sla_minutes = 15, sla_action = 'avisar' WHERE id = $1`, [warn])
    const late = await newConversation(w.db, w.A, U.alice)
    await sql(w.db, `SELECT transfer_conversation($1, 'pessoa', $2, 'ia', NULL, NULL, false, true, NULL)`, [late, U.bob])
    await sql(w.db, `UPDATE conversations SET team_id = $2 WHERE id = $1`, [late, warn])
    await sql(
      w.db,
      `UPDATE conversations SET needs_human_since = now() - interval '20 minutes',
              assigned_at = now() - interval '20 minutes' WHERE id = $1`,
      [late],
    )

    const [{ r: tick1 }] = await sql<{ r: { alerted: number; moved: unknown[] } }>(w.db, 'SELECT atendimento_tick() AS r')
    expect(tick1.alerted).toBe(1)
    const warned = await sql<{ user_id: string }>(
      w.db, `SELECT user_id FROM notifications WHERE type = 'conversation_overdue' AND conversation_id = $1 ORDER BY user_id`, [late])
    // The owner of the CRM and the person who has it.
    expect(warned.map((n) => n.user_id).sort()).toEqual([U.alice, U.bob].sort())
    const [{ r: tick2 }] = await sql<{ r: { alerted: number } }>(w.db, 'SELECT atendimento_tick() AS r')
    expect(tick2.alerted).toBe(0)

    // "Passar para o próximo": goes to Mia, never back to Bob.
    await sql(w.db, `UPDATE teams SET sla_action = 'proximo' WHERE id = $1`, [warn])
    const late2 = await newConversation(w.db, w.A, U.alice)
    await sql(w.db, `SELECT transfer_conversation($1, 'pessoa', $2, 'ia', NULL, NULL, false, true, NULL)`, [late2, U.bob])
    await sql(
      w.db,
      `UPDATE conversations SET team_id = $2, needs_human_since = now() - interval '20 minutes',
              assigned_at = now() - interval '20 minutes' WHERE id = $1`,
      [late2, warn],
    )
    const [{ r: tick3 }] = await sql<{ r: { moved: { conversation_id: string; to_user_id: string; source: string }[] } }>(
      w.db, 'SELECT atendimento_tick() AS r')
    expect(tick3.moved).toEqual([
      expect.objectContaining({ conversation_id: late2, to_user_id: U.mia, source: 'prazo' }),
    ])
    expect(await owner(w.db, late2)).toBe(U.mia)
    const [n] = await sql<{ body: string }>(
      w.db, `SELECT body FROM notifications WHERE user_id = $1 AND conversation_id = $2 AND type = 'conversation_assigned'`,
      [U.mia, late2])
    expect(n.body).toMatch(/passou do prazo e veio para você · Recepção · Sem resposta em 15 min$/)
  })

  it('the sweep gives a queued conversation to whoever of the setor came online', async () => {
    const team = await newTeam(w.db, w.A, { onlineOnly: true, members: [U.mia] })
    const conv = await newConversation(w.db, w.A, U.alice)
    expect(await toTeam(w.db, conv, team)).toMatchObject({ reason: 'queued' })
    const [{ r: idle }] = await sql<{ r: { moved: unknown[] } }>(w.db, 'SELECT atendimento_tick() AS r')
    expect(idle.moved).toEqual([])

    await online(w.db, U.mia, w.A)
    const [{ r: tick }] = await sql<{ r: { moved: { conversation_id: string; to_user_id: string }[] } }>(
      w.db, 'SELECT atendimento_tick() AS r')
    expect(tick.moved).toEqual([expect.objectContaining({ conversation_id: conv, to_user_id: U.mia })])
    expect(await owner(w.db, conv)).toBe(U.mia)
    await offline(w.db, U.mia)
  })

  it('the CRM rules: members read them, admins write them', async () => {
    await asUser(w.db, U.alice, `INSERT INTO inbox_settings (account_id, arrival_mode, return_days) VALUES ($1, 'rodizio', 3)`, [w.A])
    expect(await asUser(w.db, U.bob, 'SELECT arrival_mode FROM inbox_settings WHERE account_id = $1', [w.A])).toEqual([
      { arrival_mode: 'rodizio' },
    ])
    expect(
      await errorCode(asUser(w.db, U.bob, `UPDATE inbox_settings SET arrival_mode = 'fila_geral' WHERE account_id = $1 RETURNING 1`, [w.A])
        .then((rows) => { if (rows.length === 0) throw Object.assign(new Error('nada'), { code: 'none' }) })),
    ).toBe('none')
    expect(await errorCode(asUser(w.db, U.alice, `UPDATE inbox_settings SET arrival_mode = 'qualquer' WHERE account_id = $1`, [w.A]))).toBe('23514')
  })
})

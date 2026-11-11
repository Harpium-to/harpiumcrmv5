// ============================================================
// Migration 063 — quick replies with a file.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest'

import { applyMigration, errorCode, sql } from './harness'
import { buildWorld, U, type World } from './world'

const M063 = '063_respostas_rapidas_midia.sql'

describe('063 — quick replies with a file', () => {
  let w: World
  beforeAll(async () => {
    w = await buildWorld()
  })

  const insert = (kind: string, media: Record<string, string | null> = {}, text: string | null = null) =>
    sql(
      w.db,
      `INSERT INTO quick_replies (account_id, user_id, title, kind, content_text, media_kind, media_url, media_path, media_filename)
       VALUES ($1, $2, 'r', $3, $4, $5, $6, $7, $8)`,
      [
        w.A,
        U.alice,
        kind,
        text,
        media.media_kind ?? null,
        media.media_url ?? null,
        media.media_path ?? null,
        media.media_filename ?? null,
      ],
    )

  const FILE = {
    media_kind: 'image',
    media_url: 'https://p.supabase.co/storage/v1/object/public/chat-media/account-x/1-a.jpg',
    media_path: 'account-x/1-a.jpg',
    media_filename: 'a.jpg',
  }

  it('keeps a reply with a file, with or without a caption', async () => {
    await insert('media', FILE, 'Olha a foto')
    await insert('media', { ...FILE, media_kind: 'audio' })
    const rows = await sql<{ n: number }>(
      w.db,
      "SELECT count(*)::int AS n FROM quick_replies WHERE kind = 'media'",
    )
    expect(rows[0].n).toBe(2)
  })

  it('still keeps text and interactive replies', async () => {
    await insert('text', {}, 'Oi')
    await sql(
      w.db,
      `INSERT INTO quick_replies (account_id, user_id, title, kind, interactive_payload)
       VALUES ($1, $2, 'i', 'interactive', '{"kind":"buttons"}'::jsonb)`,
      [w.A, U.alice],
    )
  })

  it('refuses a media reply without its file, or of an unknown kind', async () => {
    expect(await errorCode(insert('media', { ...FILE, media_url: null }))).toBe('23514')
    expect(await errorCode(insert('media', { ...FILE, media_path: ' ' }))).toBe('23514')
    expect(await errorCode(insert('media', { ...FILE, media_kind: 'sticker' }))).toBe('23514')
  })

  it('refuses a file on a reply that is not a media reply', async () => {
    expect(await errorCode(insert('text', FILE, 'Oi'))).toBe('23514')
  })

  it('refuses kinds that do not exist', async () => {
    expect(await errorCode(insert('carousel', {}, 'x'))).toBe('23514')
  })

  it('is safe to run again', async () => {
    await applyMigration(w.db, M063)
    await insert('media', FILE)
    const checks = await sql<{ conname: string }>(
      w.db,
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'public.quick_replies'::regclass AND contype = 'c'
       ORDER BY conname`,
    )
    expect(checks.map((c) => c.conname)).toEqual([
      'quick_replies_kind_check',
      'quick_replies_media_check',
    ])
  })
})

// ============================================================
// Shared contact-note logic for the public API (v1):
// `GET/POST /api/v1/contacts/{id}/notes`.
//
// The API client is service-role (no user session), so RLS does not
// scope these queries: each one filters `account_id` itself, and the
// routes confirm the contact belongs to the account before reading or
// writing its notes.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ApiKeyContext } from '@/lib/auth/api-context';
import { resolveAuditUserId } from '@/lib/api/v1/contacts';

/** Long enough for a real note, short enough that a paste of a whole
 *  conversation is refused instead of stored. */
export const NOTE_MAX_LENGTH = 4000;

/** Notes are read newest-first and never paginated: a contact has a
 *  handful, and the callers (the Chrome extension) show the recent ones. */
export const NOTES_DEFAULT_LIMIT = 20;
export const NOTES_MAX_LIMIT = 50;

export interface ApiNote {
  id: string;
  text: string;
  /** Who wrote it; `null` when that person's profile is gone. */
  author: { id: string; name: string | null } | null;
  created_at: string;
}

export type NoteBody = { ok: true; text: string } | { ok: false; message: string };

/** Validate a `POST` body: `{ "text": "…" }`. */
export function parseNoteBody(body: unknown): NoteBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'O corpo da requisição precisa ser um objeto JSON' };
  }
  const raw = (body as Record<string, unknown>).text;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, message: "informe 'text' com o conteúdo da anotação" };
  }
  const text = raw.trim();
  if (text.length > NOTE_MAX_LENGTH) {
    return {
      ok: false,
      message: `'text' pode ter no máximo ${NOTE_MAX_LENGTH} caracteres`,
    };
  }
  return { ok: true, text };
}

/** `?limit=` for the list: a whole number from 1 to the maximum. */
export function parseNotesLimit(raw: string | null): number {
  const value = Number(raw);
  if (!raw || !Number.isInteger(value) || value < 1) return NOTES_DEFAULT_LIMIT;
  return Math.min(value, NOTES_MAX_LIMIT);
}

/** Project a `contact_notes` row into the public shape. */
export function serializeNote(
  row: Record<string, unknown>,
  authorNames: Map<string, string>
): ApiNote {
  const authorId = (row.user_id as string | null) ?? null;
  return {
    id: row.id as string,
    text: (row.note_text as string | null) ?? '',
    author: authorId ? { id: authorId, name: authorNames.get(authorId) ?? null } : null,
    created_at: row.created_at as string,
  };
}

/** `user_id → full_name` for the people who wrote `rows`. */
async function loadAuthorNames(
  db: SupabaseClient,
  rows: Array<Record<string, unknown>>
): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.user_id).filter((id): id is string => typeof id === 'string'))];
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  // A failure here costs the names, not the notes.
  const { data } = await db.from('profiles').select('user_id, full_name').in('user_id', ids);
  for (const profile of data ?? []) {
    if (profile.user_id && profile.full_name) {
      names.set(profile.user_id as string, profile.full_name as string);
    }
  }
  return names;
}

/** The contact's most recent notes, newest first. */
export async function listContactNotes(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  limit: number
): Promise<ApiNote[]> {
  const { data, error } = await db
    .from('contact_notes')
    .select('id, note_text, user_id, created_at')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const names = await loadAuthorNames(db, rows);
  return rows.map((row) => serializeNote(row, names));
}

/**
 * Who a note written through this key is by.
 *
 * Other API writes are attributed to the account (`resolveAuditUserId`)
 * because the column is an audit trail. A note's author is content: the
 * team reads "who wrote this". So it is the person the key belongs to —
 * for the Chrome extension's personal keys (migration 054) that is the
 * attendant — and the account only when that person is gone.
 */
export async function resolveNoteAuthor(ctx: ApiKeyContext): Promise<string> {
  return ctx.createdBy ?? (await resolveAuditUserId(ctx.supabase, ctx.accountId));
}

/** Add a note to the contact and return it. */
export async function createContactNote(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  authorId: string,
  text: string
): Promise<ApiNote> {
  const { data, error } = await db
    .from('contact_notes')
    .insert({
      account_id: accountId,
      contact_id: contactId,
      user_id: authorId,
      note_text: text,
    })
    .select('id, note_text, user_id, created_at')
    .single();
  if (error || !data) throw error ?? new Error('note insert returned no row');
  const row = data as Record<string, unknown>;
  return serializeNote(row, await loadAuthorNames(db, [row]));
}

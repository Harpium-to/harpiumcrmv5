// ============================================================
// Shared task logic for the public API (v1):
//   GET/POST /api/v1/contacts/{id}/tasks
//   GET      /api/v1/tasks
//   PATCH    /api/v1/tasks/{id}
//
// A task is a to-do about a contact, for a person (migration 060). The
// API client is service-role, so every query here filters `account_id`
// itself and the routes confirm the contact belongs to the account.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { isMissingTable } from '@/lib/auth/account-context';

export const TASK_TITLE_MAX = 200;
export const TASKS_MAX = 100;

const TASK_SELECT =
  'id, title, due_at, done_at, contact_id, assigned_to, created_at, contact:contacts(id, name, phone)';

export const TASK_STATUSES = ['open', 'done', 'all'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface ApiTask {
  id: string;
  title: string;
  /** When it should be done; `null` for a task with no date. */
  due_at: string | null;
  /** When it was marked done; `null` while open. */
  done_at: string | null;
  contact_id: string;
  contact: { id: string; name: string | null; phone: string | null } | null;
  /** Who it is for — the person reminded when it comes due. */
  assigned_to: { id: string; name: string | null } | null;
  created_at: string;
}

type Parsed<T> = { ok: true; values: T } | { ok: false; message: string };

function parseTitle(raw: unknown): Parsed<string> {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, message: "informe 'title' com o que precisa ser feito" };
  }
  const title = raw.trim();
  if (title.length > TASK_TITLE_MAX) {
    return { ok: false, message: `'title' pode ter no máximo ${TASK_TITLE_MAX} caracteres` };
  }
  return { ok: true, values: title };
}

/**
 * `due_at` as sent: an ISO date-time, or null for "no date". Stored in
 * UTC whatever offset it came with. A bare date ("2026-11-12") is
 * refused rather than guessed at: midnight UTC is the evening before in
 * Brazil, and a reminder at the wrong hour is worse than a 400.
 */
function parseDueAt(raw: unknown): Parsed<string | null> {
  if (raw === null) return { ok: true, values: null };
  const message = `'due_at' precisa ser uma data e hora ISO com fuso (ex.: 2026-11-12T14:00:00-03:00), ou null`;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(raw)) {
    return { ok: false, message };
  }
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return { ok: false, message };
  return { ok: true, values: new Date(time).toISOString() };
}

function asObject(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

/** Validate a `POST` body: `{ "title": "…", "due_at"?: "…" }`. */
export function parseTaskCreate(body: unknown): Parsed<{ title: string; due_at: string | null }> {
  const input = asObject(body);
  if (!input) return { ok: false, message: 'O corpo da requisição precisa ser um objeto JSON' };
  const title = parseTitle(input.title);
  if (!title.ok) return title;
  const due = 'due_at' in input ? parseDueAt(input.due_at) : ({ ok: true, values: null } as const);
  if (!due.ok) return due;
  return { ok: true, values: { title: title.values, due_at: due.values } };
}

/**
 * Validate a `PATCH` body into a column update. Only the keys present
 * are written. `done` is a boolean on the wire and a timestamp in the
 * table: `true` stamps now, `false` reopens.
 */
export function parseTaskPatch(body: unknown, now = new Date()): Parsed<Record<string, unknown>> {
  const input = asObject(body);
  if (!input) return { ok: false, message: 'O corpo da requisição precisa ser um objeto JSON' };
  const updates: Record<string, unknown> = {};

  if ('title' in input) {
    const title = parseTitle(input.title);
    if (!title.ok) return title;
    updates.title = title.values;
  }
  if ('due_at' in input) {
    const due = parseDueAt(input.due_at);
    if (!due.ok) return due;
    updates.due_at = due.values;
  }
  if ('done' in input) {
    if (typeof input.done !== 'boolean') {
      return { ok: false, message: `'done' precisa ser true ou false` };
    }
    updates.done_at = input.done ? now.toISOString() : null;
  }
  return { ok: true, values: updates };
}

/** `?status=` for the lists; anything else is the default, open. */
export function parseTaskStatus(raw: string | null): TaskStatus {
  return TASK_STATUSES.includes(raw as TaskStatus) ? (raw as TaskStatus) : 'open';
}

/** Project a `TASK_SELECT` row into the public shape. */
export function serializeTask(
  row: Record<string, unknown>,
  names: Map<string, string>
): ApiTask {
  const contact = row.contact as
    | { id: string; name?: string | null; phone?: string | null }
    | null
    | undefined;
  const assignee = (row.assigned_to as string | null) ?? null;
  return {
    id: row.id as string,
    title: row.title as string,
    due_at: (row.due_at as string | null) ?? null,
    done_at: (row.done_at as string | null) ?? null,
    contact_id: row.contact_id as string,
    contact: contact
      ? { id: contact.id, name: contact.name ?? null, phone: contact.phone ?? null }
      : null,
    assigned_to: assignee ? { id: assignee, name: names.get(assignee) ?? null } : null,
    created_at: row.created_at as string,
  };
}

/**
 * True when the database has no `contact_tasks` yet — migration 060 has
 * not been applied. The routes answer 503 with that said, instead of a
 * bare 500.
 */
export function isMissingTasksTable(error: unknown): boolean {
  return isMissingTable((error as { code?: string } | null) ?? null);
}

async function loadNames(
  db: SupabaseClient,
  rows: Array<Record<string, unknown>>
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(rows.map((r) => r.assigned_to).filter((id): id is string => typeof id === 'string')),
  ];
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  // A failure here costs the names, not the tasks.
  const { data } = await db.from('profiles').select('user_id, full_name').in('user_id', ids);
  for (const profile of data ?? []) {
    if (profile.user_id && profile.full_name) {
      names.set(profile.user_id as string, profile.full_name as string);
    }
  }
  return names;
}

async function serializeAll(
  db: SupabaseClient,
  rows: Array<Record<string, unknown>>
): Promise<ApiTask[]> {
  const names = await loadNames(db, rows);
  return rows.map((row) => serializeTask(row, names));
}

export interface TaskFilter {
  contactId?: string;
  /** Only tasks for this person. */
  assignedTo?: string;
  status: TaskStatus;
}

/**
 * Tasks of the account, soonest first; tasks with no date after the
 * dated ones. Done tasks, when asked for, come most recently done
 * first. Capped at `TASKS_MAX`.
 */
export async function listTasks(
  db: SupabaseClient,
  accountId: string,
  filter: TaskFilter
): Promise<ApiTask[]> {
  let query = db.from('contact_tasks').select(TASK_SELECT).eq('account_id', accountId);
  if (filter.contactId) query = query.eq('contact_id', filter.contactId);
  if (filter.assignedTo) query = query.eq('assigned_to', filter.assignedTo);
  if (filter.status === 'open') query = query.is('done_at', null);
  if (filter.status === 'done') query = query.not('done_at', 'is', null);

  query =
    filter.status === 'done'
      ? query.order('done_at', { ascending: false })
      : query
          .order('due_at', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true });

  const { data, error } = await query.limit(TASKS_MAX);
  if (error) throw error;
  return serializeAll(db, (data ?? []) as unknown as Array<Record<string, unknown>>);
}

/** Add a task about `contactId`, for `personId`. */
export async function createTask(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  personId: string,
  values: { title: string; due_at: string | null }
): Promise<ApiTask> {
  const { data, error } = await db
    .from('contact_tasks')
    .insert({
      account_id: accountId,
      contact_id: contactId,
      title: values.title,
      due_at: values.due_at,
      created_by: personId,
      assigned_to: personId,
    })
    .select(TASK_SELECT)
    .single();
  if (error || !data) throw error ?? new Error('task insert returned no row');
  return (await serializeAll(db, [data as unknown as Record<string, unknown>]))[0];
}

/**
 * Apply `updates` to one task of the account. `null` when there is no
 * such task (another account's task is "not found"; so is a malformed
 * id).
 */
export async function updateTask(
  db: SupabaseClient,
  accountId: string,
  taskId: string,
  updates: Record<string, unknown>
): Promise<ApiTask | null> {
  const base = () => db.from('contact_tasks');
  const request =
    Object.keys(updates).length > 0
      ? base().update(updates).eq('id', taskId).eq('account_id', accountId).select(TASK_SELECT)
      : base().select(TASK_SELECT).eq('id', taskId).eq('account_id', accountId);
  const { data, error } = await request.maybeSingle();
  if (error) {
    if (error.code === '22P02') return null;
    throw error;
  }
  if (!data) return null;
  return (await serializeAll(db, [data as unknown as Record<string, unknown>]))[0];
}

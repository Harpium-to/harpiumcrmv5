// ============================================================
// Shared deal logic for the public API (v1) deal + pipeline endpoints.
//
// The API client is service-role (no user session), so RLS does not
// scope these reads: every query filters `account_id` itself, and a
// stage is accepted only when it belongs to the deal's own pipeline —
// a stage id from another account's board must not be writable just
// because someone guessed or leaked it.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { num } from '@/lib/reports/aggregate';

/**
 * `*` so `closed_at` (migration 046) appears on its own once applied,
 * same as `CONVERSATION_SELECT`.
 */
export const DEAL_SELECT =
  '*, stage:pipeline_stages(id, name, color, position), pipeline:pipelines(id, name)';

/** `deals.status` CHECK values (migration 002). */
export const DEAL_STATUSES = ['open', 'won', 'lost'] as const;
export type ApiDealStatus = (typeof DEAL_STATUSES)[number];

export interface ApiStage {
  id: string;
  name: string;
  color: string;
  position: number;
}

export interface ApiDeal {
  id: string;
  title: string;
  value: number;
  currency: string | null;
  status: ApiDealStatus;
  notes: string | null;
  expected_close_date: string | null;
  /** When it reached won/lost; `null` while open or before migration 046. */
  closed_at: string | null;
  contact_id: string | null;
  conversation_id: string | null;
  pipeline: { id: string; name: string } | null;
  stage: ApiStage | null;
  created_at: string;
  updated_at: string | null;
}

export interface ApiPipeline {
  id: string;
  name: string;
  stages: ApiStage[];
}

/** Flatten a `DEAL_SELECT` row into the public deal shape. */
export function serializeDeal(row: Record<string, unknown>): ApiDeal {
  const stage = row.stage as ApiStage | null | undefined;
  const pipeline = row.pipeline as { id: string; name: string } | null | undefined;
  return {
    id: row.id as string,
    title: row.title as string,
    // NUMERIC arrives from PostgREST as a string.
    value: num(row.value),
    currency: (row.currency as string | null) ?? null,
    status: ((row.status as ApiDealStatus | null) ?? 'open'),
    notes: (row.notes as string | null) ?? null,
    expected_close_date: (row.expected_close_date as string | null) ?? null,
    closed_at: (row.closed_at as string | null) ?? null,
    contact_id: (row.contact_id as string | null) ?? null,
    conversation_id: (row.conversation_id as string | null) ?? null,
    pipeline: pipeline ? { id: pipeline.id, name: pipeline.name } : null,
    stage: stage
      ? { id: stage.id, name: stage.name, color: stage.color, position: stage.position }
      : null,
    created_at: row.created_at as string,
    updated_at: (row.updated_at as string | null) ?? null,
  };
}

/** Pipelines with their stages in board order. */
export function serializePipeline(row: Record<string, unknown>): ApiPipeline {
  const stages = ((row.stages as ApiStage[] | null | undefined) ?? [])
    .map((s) => ({ id: s.id, name: s.name, color: s.color, position: s.position }))
    .sort((a, b) => a.position - b.position);
  return { id: row.id as string, name: row.name as string, stages };
}

export type DealPatch =
  | { ok: true; updates: Record<string, unknown> }
  | { ok: false; message: string };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turn a `PATCH` body into a column update. Same contract as
 * `parseContactPatch`: only PRESENT keys are written, unknown keys are
 * ignored, and a wrong type is a 400 rather than a silent no-op.
 *
 * `stage_id` is only shape-checked here; whether the stage belongs to
 * the deal's pipeline needs the database, so the route checks that.
 */
export function parseDealPatch(body: Record<string, unknown>): DealPatch {
  const updates: Record<string, unknown> = {};

  if ('stage_id' in body) {
    if (typeof body.stage_id !== 'string' || body.stage_id === '') {
      return { ok: false, message: `'stage_id' precisa ser o ID de uma etapa` };
    }
    updates.stage_id = body.stage_id;
  }

  if ('status' in body) {
    if (!DEAL_STATUSES.includes(body.status as ApiDealStatus)) {
      return { ok: false, message: `'status' precisa ser um destes: ${DEAL_STATUSES.join(', ')}` };
    }
    updates.status = body.status;
  }

  if ('title' in body) {
    // NOT NULL in the table, and an untitled card is unreadable on the board.
    if (typeof body.title !== 'string' || body.title.trim() === '') {
      return { ok: false, message: `'title' precisa ser um texto não vazio` };
    }
    updates.title = body.title.trim();
  }

  if ('value' in body) {
    const value = body.value;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return { ok: false, message: `'value' precisa ser um número igual ou maior que 0` };
    }
    updates.value = value;
  }

  if ('notes' in body) {
    if (body.notes !== null && typeof body.notes !== 'string') {
      return { ok: false, message: `'notes' precisa ser texto ou null` };
    }
    updates.notes = body.notes;
  }

  if ('expected_close_date' in body) {
    const value = body.expected_close_date;
    if (value !== null && !(typeof value === 'string' && DATE_ONLY.test(value))) {
      return { ok: false, message: `'expected_close_date' precisa ser AAAA-MM-DD ou null` };
    }
    updates.expected_close_date = value;
  }

  return { ok: true, updates };
}

export interface DealCreateValues {
  contact_id: string;
  title: string;
  value: number;
  notes: string | null;
  expected_close_date: string | null;
  /** Where on the board; both optional — see `resolveDealPlacement`. */
  pipeline_id: string | null;
  stage_id: string | null;
}

export type DealCreate =
  | { ok: true; values: DealCreateValues }
  | { ok: false; message: string };

/**
 * Validate a `POST /api/v1/deals` body. `contact_id` and `title` are
 * required; the fields a deal shares with `PATCH` follow the same rules
 * (`parseDealPatch`). `status` is not accepted: a new deal is open, and
 * closing it is a separate, deliberate write.
 */
export function parseDealCreate(body: Record<string, unknown>): DealCreate {
  if (typeof body.contact_id !== 'string' || body.contact_id === '') {
    return { ok: false, message: "informe 'contact_id' com o ID do contato" };
  }
  if (!('title' in body)) {
    return { ok: false, message: "informe 'title'" };
  }
  if ('pipeline_id' in body && (typeof body.pipeline_id !== 'string' || body.pipeline_id === '')) {
    return { ok: false, message: `'pipeline_id' precisa ser o ID de um funil` };
  }

  const shared: Record<string, unknown> = {};
  for (const key of ['title', 'value', 'notes', 'expected_close_date', 'stage_id']) {
    if (key in body) shared[key] = body[key];
  }
  const patch = parseDealPatch(shared);
  if (!patch.ok) return patch;
  const { updates } = patch;

  return {
    ok: true,
    values: {
      contact_id: body.contact_id,
      title: updates.title as string,
      value: (updates.value as number | undefined) ?? 0,
      notes: (updates.notes as string | null | undefined) ?? null,
      expected_close_date: (updates.expected_close_date as string | null | undefined) ?? null,
      pipeline_id: (body.pipeline_id as string | undefined) ?? null,
      stage_id: (updates.stage_id as string | undefined) ?? null,
    },
  };
}

export type DealPlacement =
  | { ok: true; pipeline_id: string; stage_id: string }
  | { ok: false; message: string };

/** A pipeline of `accountId` by id, or null. A malformed id is "not found". */
async function findPipeline(
  db: SupabaseClient,
  accountId: string,
  pipelineId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('pipelines')
    .select('id')
    .eq('id', pipelineId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    if (error.code === '22P02') return null;
    throw error;
  }
  return (data?.id as string | undefined) ?? null;
}

/**
 * Where a new deal goes on the board.
 *
 *   stage_id given      that stage — it must be on a pipeline of this
 *                       account (and on `pipeline_id`, if both came)
 *   only pipeline_id    the first stage of that pipeline
 *   neither             the first stage of the account's first pipeline
 *
 * `pipeline_stages` has no `account_id` of its own, so a stage is only
 * trusted through its pipeline: a stage id from another account's board
 * must not be writable just because someone guessed or leaked it.
 */
export async function resolveDealPlacement(
  db: SupabaseClient,
  accountId: string,
  pipelineId: string | null,
  stageId: string | null
): Promise<DealPlacement> {
  if (stageId) {
    const { data: stage, error } = await db
      .from('pipeline_stages')
      .select('id, pipeline_id')
      .eq('id', stageId)
      .maybeSingle();
    if (error && error.code !== '22P02') throw error;
    const stagePipeline = (stage?.pipeline_id as string | undefined) ?? null;
    const owned = stagePipeline ? await findPipeline(db, accountId, stagePipeline) : null;
    if (!owned) {
      return { ok: false, message: `'stage_id' precisa ser uma etapa de um funil deste CRM` };
    }
    if (pipelineId && pipelineId !== owned) {
      return { ok: false, message: `'stage_id' precisa ser uma etapa do funil em 'pipeline_id'` };
    }
    return { ok: true, pipeline_id: owned, stage_id: stageId };
  }

  let pipeline: string | null;
  if (pipelineId) {
    pipeline = await findPipeline(db, accountId, pipelineId);
    if (!pipeline) {
      return { ok: false, message: `'pipeline_id' precisa ser um funil deste CRM` };
    }
  } else {
    const { data, error } = await db
      .from('pipelines')
      .select('id')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    pipeline = (data?.id as string | undefined) ?? null;
    if (!pipeline) {
      return { ok: false, message: 'Este CRM ainda não tem um funil. Crie um antes de abrir negócios.' };
    }
  }

  const { data: first, error } = await db
    .from('pipeline_stages')
    .select('id')
    .eq('pipeline_id', pipeline)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!first?.id) {
    return { ok: false, message: 'Esse funil não tem etapas.' };
  }
  return { ok: true, pipeline_id: pipeline, stage_id: first.id as string };
}

/** One deal in `accountId`, or null (another account's deal is "not found"). */
export async function getDealById(
  db: SupabaseClient,
  accountId: string,
  id: string
): Promise<ApiDeal | null> {
  const { data, error } = await db
    .from('deals')
    .select(DEAL_SELECT)
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle();
  // An id that isn't a uuid is a 22P02 from Postgres: for the caller it
  // is simply a deal that doesn't exist.
  if (error) {
    if (error.code === '22P02') return null;
    throw error;
  }
  return data ? serializeDeal(data as Record<string, unknown>) : null;
}

/** True when `stageId` is a stage of `pipelineId`. */
export async function stageBelongsToPipeline(
  db: SupabaseClient,
  stageId: string,
  pipelineId: string
): Promise<boolean> {
  const { data, error } = await db
    .from('pipeline_stages')
    .select('id')
    .eq('id', stageId)
    .eq('pipeline_id', pipelineId)
    .maybeSingle();
  if (error) {
    if (error.code === '22P02') return false;
    throw error;
  }
  return data != null;
}

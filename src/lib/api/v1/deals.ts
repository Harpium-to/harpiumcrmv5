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

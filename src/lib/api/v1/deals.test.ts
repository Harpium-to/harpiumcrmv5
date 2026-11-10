import { describe, it, expect } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  parseDealCreate,
  parseDealPatch,
  resolveDealPlacement,
  serializeDeal,
  serializePipeline,
} from './deals';

describe('serializeDeal', () => {
  const row = {
    id: 'd1',
    title: 'Implante',
    value: '1200.50', // NUMERIC arrives as a string
    currency: 'BRL',
    status: 'open',
    notes: null,
    expected_close_date: '2026-12-01',
    contact_id: 'c1',
    conversation_id: null,
    pipeline_id: 'p1',
    stage_id: 's2',
    account_id: 'acc', // internal — must not leak
    user_id: 'u1',
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-02T00:00:00Z',
    stage: { id: 's2', name: 'Proposta', color: '#f59e0b', position: 1 },
    pipeline: { id: 'p1', name: 'Vendas' },
    contact: { id: 'c1', name: 'Maria Souza', phone: '+5531999998888' },
  };

  it('coerces value to a number and projects the public shape', () => {
    const out = serializeDeal(row);
    expect(out.value).toBe(1200.5);
    expect(out.stage).toEqual({ id: 's2', name: 'Proposta', color: '#f59e0b', position: 1 });
    expect(out.pipeline).toEqual({ id: 'p1', name: 'Vendas' });
    expect(out).not.toHaveProperty('account_id');
    expect(out).not.toHaveProperty('user_id');
  });

  it('carries the contact as id, name and phone only', () => {
    expect(serializeDeal(row).contact).toEqual({
      id: 'c1',
      name: 'Maria Souza',
      phone: '+5531999998888',
    });
    // The embed may bring more columns one day; they must not leak.
    const wide = { ...row, contact: { id: 'c1', name: null, phone: '+55', email: 'x@y.z', account_id: 'acc' } };
    expect(serializeDeal(wide).contact).toEqual({ id: 'c1', name: null, phone: '+55' });
  });

  it('has no contact once the contact is deleted, or when the embed is absent', () => {
    expect(serializeDeal({ ...row, contact: null }).contact).toBeNull();
    const { contact: _gone, ...bare } = row;
    void _gone;
    expect(serializeDeal(bare).contact).toBeNull();
  });

  it('reads closed_at as null before migration 046', () => {
    expect(serializeDeal(row).closed_at).toBeNull();
    expect(serializeDeal({ ...row, closed_at: '2026-11-03T10:00:00Z' }).closed_at).toBe(
      '2026-11-03T10:00:00Z'
    );
  });
});

describe('serializePipeline', () => {
  it('orders stages by position, whatever order the embed returns', () => {
    const out = serializePipeline({
      id: 'p1',
      name: 'Vendas',
      stages: [
        { id: 'b', name: 'Proposta', color: '#000', position: 1 },
        { id: 'a', name: 'Novo', color: '#000', position: 0 },
      ],
    });
    expect(out.stages.map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('parseDealPatch', () => {
  it('updates only the keys present and ignores unknown ones', () => {
    expect(parseDealPatch({ stage_id: 's2', account_id: 'other' })).toEqual({
      ok: true,
      updates: { stage_id: 's2' },
    });
    expect(parseDealPatch({})).toEqual({ ok: true, updates: {} });
  });

  it('accepts each status and rejects anything else', () => {
    for (const s of ['open', 'won', 'lost']) {
      expect(parseDealPatch({ status: s })).toEqual({ ok: true, updates: { status: s } });
    }
    for (const s of ['active', 'ganho', null]) {
      expect(parseDealPatch({ status: s })).toMatchObject({ ok: false });
    }
  });

  it('requires a non-empty stage_id and title', () => {
    expect(parseDealPatch({ stage_id: '' })).toMatchObject({ ok: false });
    expect(parseDealPatch({ stage_id: 3 })).toMatchObject({ ok: false });
    expect(parseDealPatch({ title: '   ' })).toMatchObject({ ok: false });
    expect(parseDealPatch({ title: ' Implante ' })).toEqual({
      ok: true,
      updates: { title: 'Implante' },
    });
  });

  it('accepts value as a finite number of 0 or more', () => {
    expect(parseDealPatch({ value: 0 })).toMatchObject({ ok: true });
    expect(parseDealPatch({ value: 1999.9 })).toMatchObject({ ok: true });
    for (const v of [-1, '100', Infinity, null]) {
      expect(parseDealPatch({ value: v })).toMatchObject({ ok: false });
    }
  });

  it('accepts expected_close_date as YYYY-MM-DD or null', () => {
    expect(parseDealPatch({ expected_close_date: '2026-12-01' })).toMatchObject({ ok: true });
    expect(parseDealPatch({ expected_close_date: null })).toMatchObject({ ok: true });
    expect(parseDealPatch({ expected_close_date: '01/12/2026' })).toMatchObject({ ok: false });
  });
});

describe('parseDealCreate', () => {
  it('needs a contact and a title; everything else has a default', () => {
    expect(parseDealCreate({ contact_id: 'c1', title: '  Plano anual ' })).toEqual({
      ok: true,
      values: {
        contact_id: 'c1',
        title: 'Plano anual',
        value: 0,
        notes: null,
        expected_close_date: null,
        pipeline_id: null,
        stage_id: null,
      },
    });
    expect(parseDealCreate({ title: 'Plano' }).ok).toBe(false);
    expect(parseDealCreate({ contact_id: '', title: 'Plano' }).ok).toBe(false);
    expect(parseDealCreate({ contact_id: 'c1' }).ok).toBe(false);
    expect(parseDealCreate({ contact_id: 'c1', title: '   ' }).ok).toBe(false);
  });

  it('takes the optional fields under the same rules as PATCH', () => {
    const parsed = parseDealCreate({
      contact_id: 'c1',
      title: 'Plano',
      value: 4800,
      notes: 'Quer começar em dezembro',
      expected_close_date: '2026-12-01',
      pipeline_id: 'p1',
      stage_id: 's2',
    });
    expect(parsed).toEqual({
      ok: true,
      values: {
        contact_id: 'c1',
        title: 'Plano',
        value: 4800,
        notes: 'Quer começar em dezembro',
        expected_close_date: '2026-12-01',
        pipeline_id: 'p1',
        stage_id: 's2',
      },
    });
    expect(parseDealCreate({ contact_id: 'c1', title: 'Plano', value: -1 }).ok).toBe(false);
    expect(parseDealCreate({ contact_id: 'c1', title: 'Plano', value: '4800' }).ok).toBe(false);
    expect(parseDealCreate({ contact_id: 'c1', title: 'Plano', stage_id: '' }).ok).toBe(false);
    expect(parseDealCreate({ contact_id: 'c1', title: 'Plano', pipeline_id: 7 }).ok).toBe(false);
    expect(
      parseDealCreate({ contact_id: 'c1', title: 'Plano', expected_close_date: '01/12/2026' }).ok
    ).toBe(false);
  });

  it('ignores status: a new deal is always open', () => {
    const parsed = parseDealCreate({ contact_id: 'c1', title: 'Plano', status: 'won' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect('status' in parsed.values).toBe(false);
  });
});

describe('resolveDealPlacement', () => {
  // Two accounts, each with a board. `pipeline_stages` has no account
  // of its own — that is the whole reason this function exists.
  const tables: Record<string, Array<Record<string, unknown>>> = {
    pipelines: [
      { id: 'p1', account_id: 'acc', created_at: '2026-01-01' },
      { id: 'p2', account_id: 'acc', created_at: '2026-02-01' },
      { id: 'px', account_id: 'other', created_at: '2025-01-01' },
      { id: 'empty', account_id: 'acc', created_at: '2026-03-01' },
    ],
    pipeline_stages: [
      { id: 's1b', pipeline_id: 'p1', position: 1 },
      { id: 's1a', pipeline_id: 'p1', position: 0 },
      { id: 's2a', pipeline_id: 'p2', position: 0 },
      { id: 'sx', pipeline_id: 'px', position: 0 },
    ],
  };

  function db(source = tables): SupabaseClient {
    const from = (table: string) => {
      let rows = [...(source[table] ?? [])];
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          rows = rows.filter((r) => r[col] === val);
          return builder;
        },
        order: (col: string) => {
          rows.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1));
          return builder;
        },
        limit: (n: number) => {
          rows = rows.slice(0, n);
          return builder;
        },
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      };
      return builder;
    };
    return { from } as unknown as SupabaseClient;
  }

  it('with nothing named, starts on the first stage of the first pipeline', async () => {
    expect(await resolveDealPlacement(db(), 'acc', null, null)).toEqual({
      ok: true,
      pipeline_id: 'p1',
      stage_id: 's1a',
    });
  });

  it('with a pipeline, starts on its first stage', async () => {
    expect(await resolveDealPlacement(db(), 'acc', 'p2', null)).toEqual({
      ok: true,
      pipeline_id: 'p2',
      stage_id: 's2a',
    });
  });

  it('with a stage, uses it and finds its pipeline', async () => {
    expect(await resolveDealPlacement(db(), 'acc', null, 's1b')).toEqual({
      ok: true,
      pipeline_id: 'p1',
      stage_id: 's1b',
    });
    expect(await resolveDealPlacement(db(), 'acc', 'p1', 's1b')).toEqual({
      ok: true,
      pipeline_id: 'p1',
      stage_id: 's1b',
    });
  });

  it("refuses another account's stage or pipeline", async () => {
    expect((await resolveDealPlacement(db(), 'acc', null, 'sx')).ok).toBe(false);
    expect((await resolveDealPlacement(db(), 'acc', 'px', null)).ok).toBe(false);
    expect((await resolveDealPlacement(db(), 'acc', 'px', 'sx')).ok).toBe(false);
  });

  it('refuses a stage that is not on the named pipeline', async () => {
    expect((await resolveDealPlacement(db(), 'acc', 'p2', 's1a')).ok).toBe(false);
  });

  it('refuses ids that do not exist, a pipeline with no stages, and an account with no pipeline', async () => {
    expect((await resolveDealPlacement(db(), 'acc', null, 'nope')).ok).toBe(false);
    expect((await resolveDealPlacement(db(), 'acc', 'nope', null)).ok).toBe(false);
    expect((await resolveDealPlacement(db(), 'acc', 'empty', null)).ok).toBe(false);
    expect((await resolveDealPlacement(db(), 'nobody', null, null)).ok).toBe(false);
  });
});

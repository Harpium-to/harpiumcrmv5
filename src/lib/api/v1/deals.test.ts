import { describe, it, expect } from 'vitest';

import { parseDealPatch, serializeDeal, serializePipeline } from './deals';

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
  };

  it('coerces value to a number and projects the public shape', () => {
    const out = serializeDeal(row);
    expect(out.value).toBe(1200.5);
    expect(out.stage).toEqual({ id: 's2', name: 'Proposta', color: '#f59e0b', position: 1 });
    expect(out.pipeline).toEqual({ id: 'p1', name: 'Vendas' });
    expect(out).not.toHaveProperty('account_id');
    expect(out).not.toHaveProperty('user_id');
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

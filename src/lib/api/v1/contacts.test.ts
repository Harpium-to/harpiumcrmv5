import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  serializeContact,
  findOrCreateContact,
  parseContactPatch,
  ContactError,
} from './contacts';

describe('serializeContact', () => {
  it('flattens contact_tags(tags(*)) onto a tags array and nulls missing fields', () => {
    const row = {
      id: 'c1',
      phone: '+14155550123',
      name: 'Jane',
      email: null,
      company: 'Acme',
      avatar_url: null,
      temperature: 'warm',
      potential: 70,
      segment: 'Clínica',
      source: 'instagram',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      contact_tags: [
        { tags: { id: 't1', name: 'vip', color: '#fff' } },
        { tags: null }, // orphaned join — dropped
      ],
    };
    expect(serializeContact(row)).toEqual({
      id: 'c1',
      phone: '+14155550123',
      name: 'Jane',
      email: null,
      company: 'Acme',
      avatar_url: null,
      temperature: 'warm',
      potential: 70,
      segment: 'Clínica',
      source: 'instagram',
      city: null,
      job_title: null,
      instagram: null,
      website: null,
      opted_out: false,
      tags: [{ id: 't1', name: 'vip', color: '#fff' }],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    });
  });

  it('tolerates a row with no contact_tags key', () => {
    const row = {
      id: 'c2',
      phone: '+1',
      name: null,
      email: null,
      company: null,
      avatar_url: null,
      created_at: 'a',
      updated_at: 'b',
    };
    expect(serializeContact(row).tags).toEqual([]);
  });

  it('nulls the qualification fields on a row from before migration 045', () => {
    const out = serializeContact({ id: 'c3', phone: '+1', created_at: 'a', updated_at: 'b' });
    expect(out.temperature).toBeNull();
    expect(out.potential).toBeNull();
    expect(out.segment).toBeNull();
  });
});

describe('parseContactPatch', () => {
  it('turns opted_out into the moment, or clears it', () => {
    const on = parseContactPatch({ opted_out: true });
    expect(on.ok && typeof on.updates.opted_out_at).toBe('string');
    expect(parseContactPatch({ opted_out: false })).toEqual({ ok: true, updates: { opted_out_at: null } });
    expect(parseContactPatch({ opted_out: 'sim' }).ok).toBe(false);
  });

  it('updates only the keys present, accepting strings and null', () => {
    expect(parseContactPatch({ name: 'Ana', segment: null })).toEqual({
      ok: true,
      updates: { name: 'Ana', segment: null },
    });
    expect(parseContactPatch({})).toEqual({ ok: true, updates: {} });
  });

  it('ignores keys it does not know', () => {
    expect(parseContactPatch({ phone: '+1', owner_agent_id: 'x' })).toEqual({
      ok: true,
      updates: {},
    });
  });

  it('rejects a non-string text field', () => {
    expect(parseContactPatch({ source: 42 })).toMatchObject({ ok: false });
  });

  it('accepts each temperature and rejects anything else, null included', () => {
    for (const t of ['cold', 'warm', 'hot']) {
      expect(parseContactPatch({ temperature: t })).toEqual({
        ok: true,
        updates: { temperature: t },
      });
    }
    for (const t of ['HOT', 'morno', null, 1]) {
      expect(parseContactPatch({ temperature: t })).toMatchObject({ ok: false });
    }
  });

  it('accepts potential as an integer 0–100 or null', () => {
    for (const p of [0, 55, 100, null]) {
      expect(parseContactPatch({ potential: p })).toEqual({
        ok: true,
        updates: { potential: p },
      });
    }
    for (const p of [-1, 101, 50.5, '80']) {
      expect(parseContactPatch({ potential: p })).toMatchObject({ ok: false });
    }
  });
});

describe('findOrCreateContact', () => {
  const noopDb = {} as SupabaseClient;

  it('rejects a non-E.164 phone with a 400 ContactError', async () => {
    await expect(
      findOrCreateContact(noopDb, 'acc', 'user', { phone: 'not-a-number' })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      findOrCreateContact(noopDb, 'acc', 'user', { phone: 'not-a-number' })
    ).rejects.toBeInstanceOf(ContactError);
  });
});

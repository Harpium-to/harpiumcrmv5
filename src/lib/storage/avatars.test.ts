import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { avatarPathFromUrl, removeReplacedAvatar } from './avatars';

const BASE = 'https://proj.supabase.co';
const url = (path: string) => `${BASE}/storage/v1/object/public/avatars/${path}`;

describe('avatarPathFromUrl', () => {
  it('reads the object path out of a public avatar URL', () => {
    expect(avatarPathFromUrl(url('u1/agent-1.png'), BASE)).toBe('u1/agent-1.png');
    expect(avatarPathFromUrl(url('u1/a%20b.png'), BASE)).toBe('u1/a b.png');
  });

  it('refuses anything that is not one of our objects', () => {
    expect(avatarPathFromUrl(null, BASE)).toBeNull();
    expect(avatarPathFromUrl('not a url', BASE)).toBeNull();
    expect(avatarPathFromUrl('https://cdn.example.com/face.png', BASE)).toBeNull();
    // Same shape, someone else's host.
    expect(
      avatarPathFromUrl('https://evil.example/storage/v1/object/public/avatars/u1/x.png', BASE)
    ).toBeNull();
    // Another bucket.
    expect(
      avatarPathFromUrl(`${BASE}/storage/v1/object/public/flow-media/u1/x.png`, BASE)
    ).toBeNull();
    expect(avatarPathFromUrl(url('u1/'), BASE)).toBeNull();
    expect(avatarPathFromUrl(url('u1/%2E%2E/u2/x.png'), BASE)).toBeNull();
  });
});

/**
 * A client whose `agents` / `profiles` lookups return the given rows and
 * whose storage `remove` is a spy.
 */
function fakeDb(rows: { agents?: unknown[]; profiles?: unknown[]; agentsError?: { code: string } }) {
  const remove = vi.fn(async () => ({ data: [], error: null }));
  const lookup = (table: 'agents' | 'profiles') => {
    const result =
      table === 'agents' && rows.agentsError
        ? { data: null, error: rows.agentsError }
        : { data: rows[table] ?? [], error: null };
    const builder = {
      select: () => builder,
      eq: () => builder,
      neq: () => builder,
      limit: () => builder,
      then: <T,>(resolve: (r: typeof result) => T) => Promise.resolve(resolve(result)),
    };
    return builder;
  };
  const db = {
    from: (table: 'agents' | 'profiles') => lookup(table),
    storage: { from: () => ({ remove }) },
  } as unknown as SupabaseClient;
  return { db, remove };
}

describe('removeReplacedAvatar', () => {
  it('removes the old file once nothing else points at it', async () => {
    const { db, remove } = fakeDb({});
    const removed = await removeReplacedAvatar(db, url('u1/agent-1.png'), url('u1/agent-2.png'), { agentId: 'a1' }, BASE);
    expect(removed).toBe(true);
    expect(remove).toHaveBeenCalledWith(['u1/agent-1.png']);
  });

  it('keeps a file a duplicated agent still uses', async () => {
    const { db, remove } = fakeDb({ agents: [{ id: 'a2' }] });
    expect(await removeReplacedAvatar(db, url('u1/agent-1.png'), null, { agentId: 'a1' }, BASE)).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it('keeps a file a profile still uses', async () => {
    const { db, remove } = fakeDb({ profiles: [{ user_id: 'u9' }] });
    expect(await removeReplacedAvatar(db, url('u1/avatar-1.png'), null, { userId: 'u1' }, BASE)).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it('does nothing when the URL did not change or is not ours', async () => {
    const { db, remove } = fakeDb({});
    await removeReplacedAvatar(db, url('u1/a.png'), url('u1/a.png'), {}, BASE);
    await removeReplacedAvatar(db, 'https://cdn.example.com/a.png', null, {}, BASE);
    await removeReplacedAvatar(db, null, url('u1/a.png'), {}, BASE);
    expect(remove).not.toHaveBeenCalled();
  });

  it('keeps the file when it cannot tell whether it is in use', async () => {
    const { db, remove } = fakeDb({ agentsError: { code: '57014' } });
    expect(await removeReplacedAvatar(db, url('u1/a.png'), null, {}, BASE)).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it('still cleans a profile avatar before the agents table exists', async () => {
    const { db, remove } = fakeDb({ agentsError: { code: 'PGRST205' } });
    expect(await removeReplacedAvatar(db, url('u1/avatar-1.png'), null, { userId: 'u1' }, BASE)).toBe(true);
    expect(remove).toHaveBeenCalledOnce();
  });
});

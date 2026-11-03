// ============================================================
// Cleaning up a replaced avatar.
//
// Every avatar upload writes a NEW object (`avatar-<timestamp>.png`)
// so the browser cache never serves the old face under a new URL. The
// cost was that the old object stayed in the bucket forever. This
// removes it — carefully, because a public URL can be referenced from
// more than one row:
//
//   * duplicating an agent copies its `avatar_url`, so two agents can
//     point at one file, and
//   * the agent form takes a pasted URL, which can be anyone's avatar.
//
// So a file is deleted only when no agent or profile the caller can see
// still points at it. Anything else — an external URL, a file in
// another user's folder (the bucket policy only lets you delete under
// your own `auth.uid()`), a lookup that fails — leaves the file where
// it is. A stray file costs a few kilobytes; deleting one still in use
// breaks a picture for everyone looking at it.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export const AVATAR_BUCKET = 'avatars';

const PUBLIC_PREFIX = `/storage/v1/object/public/${AVATAR_BUCKET}/`;

/**
 * The object path inside the avatars bucket for one of its public URLs,
 * or null for any other URL. `supabaseUrl`, when given, must match the
 * URL's origin, so an external link that merely looks similar is never
 * read as one of ours.
 */
export function avatarPathFromUrl(
  url: string | null | undefined,
  supabaseUrl?: string
): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (supabaseUrl) {
    try {
      if (new URL(supabaseUrl).origin !== parsed.origin) return null;
    } catch {
      return null;
    }
  }
  // Only a URL exactly as the bucket hands it out. `new URL` quietly
  // resolves `..` and `%2E%2E`, so `avatars/u1/../u2/x.png` would come
  // out as someone else's object — and a row holding that string would
  // not match the rows holding the plain one in the in-use check below.
  if (parsed.href !== url) return null;
  if (!parsed.pathname.startsWith(PUBLIC_PREFIX)) return null;
  const path = decodeURIComponent(parsed.pathname.slice(PUBLIC_PREFIX.length));
  // A bare folder or a path climbing out of it is not an object we made.
  if (!path || path.endsWith('/') || path.split('/').includes('..')) return null;
  return path;
}

interface Keep {
  /** The agent being edited — its own row doesn't count as "in use". */
  agentId?: string;
  /** The profile being edited, likewise. */
  userId?: string;
}

/**
 * Delete `oldUrl`'s file after the row has moved on to `newUrl`.
 * Best-effort and never throws: call it only after the save succeeded.
 */
export async function removeReplacedAvatar(
  db: SupabaseClient,
  oldUrl: string | null | undefined,
  newUrl: string | null | undefined,
  keep: Keep = {},
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL
): Promise<boolean> {
  if (!oldUrl || oldUrl === newUrl) return false;
  const path = avatarPathFromUrl(oldUrl, supabaseUrl);
  if (!path) return false;

  try {
    let agents = db.from('agents').select('id').eq('avatar_url', oldUrl).limit(1);
    if (keep.agentId) agents = agents.neq('id', keep.agentId);
    let profiles = db.from('profiles').select('user_id').eq('avatar_url', oldUrl).limit(1);
    if (keep.userId) profiles = profiles.neq('user_id', keep.userId);

    const [agentRes, profileRes] = await Promise.all([agents, profiles]);
    // Can't tell whether it's in use → don't find out by deleting it.
    // (No `agents` table before migration 044 lands here too, which is
    // fine: then there is only the profile to protect.)
    if (profileRes.error) return false;
    if (!agentRes.error && (agentRes.data?.length ?? 0) > 0) return false;
    if (agentRes.error && agentRes.error.code !== '42P01' && agentRes.error.code !== 'PGRST205') {
      return false;
    }
    if ((profileRes.data?.length ?? 0) > 0) return false;

    const { error } = await db.storage.from(AVATAR_BUCKET).remove([path]);
    if (error) {
      console.warn('[avatars] could not remove replaced file:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[avatars] cleanup skipped:', err);
    return false;
  }
}

/** Undo an upload whose save then failed, so it doesn't become the orphan. */
export async function removeUploadedAvatar(db: SupabaseClient, path: string): Promise<void> {
  const { error } = await db.storage.from(AVATAR_BUCKET).remove([path]);
  if (error) console.warn('[avatars] could not remove unsaved upload:', error.message);
}

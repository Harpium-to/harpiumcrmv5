import type { AiConfigSnapshot } from './autoreply-status'

// ------------------------------------------------------------
// The account's AI config as the inbox banner reads it.
//
// It is the same for every conversation, so threads share one copy
// per account instead of each asking /api/ai/config. But it changes:
// someone turns the assistant on in Configurações › IA or activates an
// agent, usually in the same tab the inbox was already open in. A copy
// kept for the whole session hid the banner — and "Retomar IA" with it
// — until a reload. So a copy is reused only while it is fresh; after
// that, the next read (a thread opened, the tab back in view) asks
// the server again.
//
// Keyed by accountId: a multi-account user switching workspaces must
// not see the previous account's status. A failed read is never
// cached: it answers with the last good copy (or null) and the next
// read tries again.
// ------------------------------------------------------------

/** How long a copy is reused — long enough to click through threads
 *  without a request each, short enough that coming back from the
 *  settings screen reads the new config. */
export const AI_CONFIG_MAX_AGE_MS = 10_000

export interface AiConfigSnapshotCache {
  /** The account's config: from memory while fresh, else from the
   *  server. Concurrent reads share one request. */
  get(accountId: string): Promise<AiConfigSnapshot | null>
}

export function createAiConfigSnapshotCache(deps: {
  /** Reads the current account's config; null when the read failed. */
  load: () => Promise<AiConfigSnapshot | null>
  now?: () => number
  maxAgeMs?: number
}): AiConfigSnapshotCache {
  const now = deps.now ?? Date.now
  const maxAgeMs = deps.maxAgeMs ?? AI_CONFIG_MAX_AGE_MS
  const copies = new Map<string, { snapshot: AiConfigSnapshot; at: number }>()
  const inFlight = new Map<string, Promise<AiConfigSnapshot | null>>()

  return {
    get(accountId) {
      const copy = copies.get(accountId)
      if (copy && now() - copy.at < maxAgeMs) return Promise.resolve(copy.snapshot)

      const pending = inFlight.get(accountId)
      if (pending) return pending

      const request = deps
        .load()
        .catch(() => null)
        .then((snapshot) => {
          inFlight.delete(accountId)
          if (!snapshot) return copy?.snapshot ?? null
          copies.set(accountId, { snapshot, at: now() })
          return snapshot
        })
      inFlight.set(accountId, request)
      return request
    },
  }
}

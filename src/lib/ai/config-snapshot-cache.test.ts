import { describe, expect, it, vi } from 'vitest'

import type { AiConfigSnapshot } from './autoreply-status'
import { AI_CONFIG_MAX_AGE_MS, createAiConfigSnapshotCache } from './config-snapshot-cache'

const OFF: AiConfigSnapshot = { configured: true, has_key: true, is_active: true, auto_reply_enabled: false }
const ON: AiConfigSnapshot = { ...OFF, auto_reply_enabled: true }

function setup(...answers: (AiConfigSnapshot | null | Error)[]) {
  let clock = 1_000
  const load = vi.fn(async () => {
    const next = answers.shift() ?? null
    if (next instanceof Error) throw next
    return next
  })
  const cache = createAiConfigSnapshotCache({ load, now: () => clock })
  return {
    cache,
    load,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

describe('AI config snapshot cache (inbox banner)', () => {
  it('reuses a fresh copy across threads', async () => {
    const { cache, load, advance } = setup(OFF)
    expect(await cache.get('acc-1')).toBe(OFF)
    advance(AI_CONFIG_MAX_AGE_MS - 1)
    expect(await cache.get('acc-1')).toBe(OFF)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('reads the config again once the copy is stale — the agent was turned on meanwhile', async () => {
    const { cache, load, advance } = setup(OFF, ON)
    expect(await cache.get('acc-1')).toBe(OFF)
    advance(AI_CONFIG_MAX_AGE_MS)
    expect(await cache.get('acc-1')).toBe(ON)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('shares one request between reads that overlap', async () => {
    const { cache, load } = setup(ON)
    const [a, b] = await Promise.all([cache.get('acc-1'), cache.get('acc-1')])
    expect(a).toBe(ON)
    expect(b).toBe(ON)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('keeps one copy per account', async () => {
    const { cache, load } = setup(ON, OFF)
    expect(await cache.get('acc-1')).toBe(ON)
    expect(await cache.get('acc-2')).toBe(OFF)
    expect(await cache.get('acc-1')).toBe(ON)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['a failed response', null],
    ['a network error', new Error('offline')],
  ])('keeps the last good copy on %s and tries again next time', async (_, failure) => {
    const { cache, load, advance } = setup(ON, failure, OFF)
    expect(await cache.get('acc-1')).toBe(ON)
    advance(AI_CONFIG_MAX_AGE_MS)
    expect(await cache.get('acc-1')).toBe(ON)
    // The failure was not cached as fresh.
    expect(await cache.get('acc-1')).toBe(OFF)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('answers null when the very first read fails', async () => {
    const { cache } = setup(null, ON)
    expect(await cache.get('acc-1')).toBeNull()
    expect(await cache.get('acc-1')).toBe(ON)
  })
})

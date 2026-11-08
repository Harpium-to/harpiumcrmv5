import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { requestCoexistenceSync } from './coexistence'
import {
  COEXISTENCE_FINISH_EVENT,
  embeddedSignupExtras,
  resolveConnectionMode,
} from './embedded-signup-client'
import { requestSmbAppDataSync } from './meta-api'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('resolveConnectionMode', () => {
  it("the popup's event decides", () => {
    expect(resolveConnectionMode('cloud', COEXISTENCE_FINISH_EVENT)).toBe('coexistence')
    expect(resolveConnectionMode('coexistence', 'FINISH')).toBe('cloud')
    expect(resolveConnectionMode('coexistence', 'FINISH_ONLY_WABA')).toBe('cloud')
  })

  it('without an event, the option picked on the card', () => {
    expect(resolveConnectionMode('coexistence', null)).toBe('coexistence')
    expect(resolveConnectionMode('cloud', undefined)).toBe('cloud')
    expect(resolveConnectionMode('anything', '')).toBe('cloud')
  })
})

describe('embeddedSignupExtras', () => {
  it('coexistence asks for the WhatsApp Business app onboarding', () => {
    expect(embeddedSignupExtras('coexistence')).toEqual({
      setup: {},
      featureType: 'whatsapp_business_app_onboarding',
      sessionInfoVersion: '3',
    })
    expect(embeddedSignupExtras('cloud')).toEqual({ setup: {} })
  })
})

describe('requestSmbAppDataSync', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('posts the sync type for the number and returns the request id', async () => {
    fetchMock.mockResolvedValue(json({ messaging_product: 'whatsapp', request_id: 'REQ1' }))
    const id = await requestSmbAppDataSync({ phoneNumberId: 'PN1', accessToken: 'TOK', syncType: 'history' })
    expect(id).toBe('REQ1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/PN1\/smb_app_data$/)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer TOK')
    expect(JSON.parse(init.body)).toEqual({ messaging_product: 'whatsapp', sync_type: 'history' })
  })

  it("throws Meta's message", async () => {
    fetchMock.mockResolvedValue(json({ error: { message: 'Sync window expired', code: 100 } }, 400))
    await expect(
      requestSmbAppDataSync({ phoneNumberId: 'PN1', accessToken: 'TOK', syncType: 'smb_app_state_sync' }),
    ).rejects.toThrow('Sync window expired')
  })
})

describe('requestCoexistenceSync', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  function fakeDb(row: Record<string, unknown> | null) {
    const writes: Record<string, unknown>[] = []
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: row, error: null }),
      update: (patch: Record<string, unknown>) => {
        writes.push(patch)
        return { eq: async () => ({ error: null }) }
      },
    }
    return { db: { from: () => builder } as unknown as SupabaseClient, writes }
  }

  const ARGS = { accountId: 'acc-1', phoneNumberId: 'PN1', accessToken: 'TOK' }
  const syncTypes = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).sync_type)

  it('asks for contacts first, then history, and records both', async () => {
    fetchMock.mockImplementation(async () => json({ request_id: 'R' }))
    const { db, writes } = fakeDb({
      contacts_sync_requested_at: null,
      history_sync_requested_at: null,
      history_sync_status: null,
    })
    const result = await requestCoexistenceSync({ db, ...ARGS })
    expect(result).toEqual({ contacts: 'requested', history: 'requested', error: null })
    expect(syncTypes()).toEqual(['smb_app_state_sync', 'history'])
    expect(writes[0]).toHaveProperty('contacts_sync_requested_at')
    expect(writes[1]).toMatchObject({ history_sync_status: 'requested', history_sync_progress: 0 })
  })

  it('never asks twice for what Meta already accepted', async () => {
    const { db } = fakeDb({
      contacts_sync_requested_at: '2026-11-07T10:00:00Z',
      history_sync_requested_at: '2026-11-07T10:00:00Z',
      history_sync_status: 'importing',
    })
    const result = await requestCoexistenceSync({ db, ...ARGS })
    expect(result).toEqual({ contacts: 'already_requested', history: 'already_requested', error: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retries a failed history request only', async () => {
    fetchMock.mockImplementation(async () => json({ request_id: 'R' }))
    const { db } = fakeDb({
      contacts_sync_requested_at: '2026-11-07T10:00:00Z',
      history_sync_requested_at: '2026-11-07T10:00:00Z',
      history_sync_status: 'failed',
    })
    const result = await requestCoexistenceSync({ db, ...ARGS })
    expect(result.history).toBe('requested')
    expect(syncTypes()).toEqual(['history'])
  })

  it("records Meta's refusal without throwing", async () => {
    // A fresh Response per call: a body can only be read once.
    fetchMock.mockImplementation(async () => json({ error: { message: 'Not eligible' } }, 400))
    const { db, writes } = fakeDb({
      contacts_sync_requested_at: null,
      history_sync_requested_at: null,
      history_sync_status: null,
    })
    const result = await requestCoexistenceSync({ db, ...ARGS })
    expect(result).toEqual({ contacts: 'failed', history: 'failed', error: 'Not eligible' })
    expect(writes.at(-1)).toMatchObject({ history_sync_status: 'failed', history_sync_error: 'Not eligible' })
  })
})

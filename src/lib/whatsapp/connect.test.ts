import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('./meta-api', () => ({
  verifyPhoneNumber: vi.fn(),
  registerPhoneNumber: vi.fn(),
  subscribeWabaToApp: vi.fn(),
}))
vi.mock('./encryption', () => ({
  encrypt: (value: string) => `enc(${value})`,
}))

import { registerPhoneNumber, subscribeWabaToApp, verifyPhoneNumber } from './meta-api'
import { saveWhatsAppConnection } from './connect'

const verifyMock = vi.mocked(verifyPhoneNumber)
const registerMock = vi.mocked(registerPhoneNumber)
const subscribeMock = vi.mocked(subscribeWabaToApp)

const PHONE_INFO = { id: 'PN1', display_phone_number: '+55 63 3333-0000', verified_name: 'Cliente' }

interface FakeOptions {
  /** Row another account holds for the same number. */
  claimed?: Record<string, unknown> | null
  /** This account's current row. */
  existing?: Record<string, unknown> | null
  writeError?: { message: string } | null
}

type Write = { op: 'insert' | 'update'; table: string; row: Record<string, unknown> }

// Just enough of the Supabase query builder for saveWhatsAppConnection:
// the ownership check is the only query with .neq(), everything else
// reads the caller's own row.
function fakeDb(opts: FakeOptions) {
  const writes: Write[] = []
  const from = (table: string) => {
    let isClaimQuery = false
    const builder = {
      select: () => builder,
      eq: () => builder,
      neq: () => {
        isClaimQuery = true
        return builder
      },
      maybeSingle: async () =>
        isClaimQuery
          ? { data: opts.claimed ?? null, error: null }
          : { data: opts.existing ?? null, error: null },
      update: (row: Record<string, unknown>) => {
        writes.push({ op: 'update', table, row })
        return { eq: async () => ({ error: opts.writeError ?? null }) }
      },
      insert: async (row: Record<string, unknown>) => {
        writes.push({ op: 'insert', table, row })
        return { error: opts.writeError ?? null }
      },
    }
    return builder
  }
  return { client: { from } as unknown as SupabaseClient, writes }
}

function baseArgs(db: SupabaseClient) {
  return {
    db,
    admin: db,
    accountId: 'acct-1',
    userId: 'user-1',
    phoneNumberId: 'PN1',
    wabaId: 'WABA1',
    accessToken: 'TOKEN',
  }
}

beforeEach(() => {
  verifyMock.mockReset().mockResolvedValue(PHONE_INFO)
  registerMock.mockReset().mockResolvedValue({ success: true, alreadyRegistered: false })
  subscribeMock.mockReset().mockResolvedValue(undefined)
})

describe('saveWhatsAppConnection', () => {
  it('connects a new number: verifies, registers with the PIN, subscribes and inserts encrypted', async () => {
    const { client, writes } = fakeDb({})
    const result = await saveWhatsAppConnection({ ...baseArgs(client), pin: '123456' })

    expect(result).toMatchObject({
      ok: true,
      registered: true,
      registrationSkipped: false,
      registrationError: null,
      phoneInfo: PHONE_INFO,
    })
    expect(registerMock).toHaveBeenCalledWith({ phoneNumberId: 'PN1', accessToken: 'TOKEN', pin: '123456' })
    expect(subscribeMock).toHaveBeenCalledWith({ wabaId: 'WABA1', accessToken: 'TOKEN' })

    expect(writes).toHaveLength(1)
    const [write] = writes
    expect(write.op).toBe('insert')
    expect(write.row).toMatchObject({
      account_id: 'acct-1',
      user_id: 'user-1',
      phone_number_id: 'PN1',
      waba_id: 'WABA1',
      access_token: 'enc(TOKEN)',
      status: 'connected',
      last_registration_error: null,
    })
    expect(write.row.registered_at).toEqual(expect.any(String))
    expect(write.row.subscribed_apps_at).toEqual(expect.any(String))
    // The plaintext token never reaches the row.
    expect(JSON.stringify(write.row)).not.toContain('"TOKEN"')
  })

  it('refuses a number another account already holds, before calling Meta', async () => {
    const { client, writes } = fakeDb({ claimed: { account_id: 'acct-2' } })
    const result = await saveWhatsAppConnection({ ...baseArgs(client), pin: '123456' })
    expect(result).toMatchObject({ ok: false, status: 409 })
    expect(verifyMock).not.toHaveBeenCalled()
    expect(writes).toHaveLength(0)
  })

  it('rejects a malformed PIN', async () => {
    const { client } = fakeDb({})
    const result = await saveWhatsAppConnection({ ...baseArgs(client), pin: '12ab' })
    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(verifyMock).not.toHaveBeenCalled()
  })

  it('stops when Meta refuses the credentials', async () => {
    verifyMock.mockRejectedValue(new Error('Invalid OAuth access token'))
    const { client, writes } = fakeDb({})
    const result = await saveWhatsAppConnection({ ...baseArgs(client), pin: '123456' })
    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(result.ok === false && result.error).toContain('Invalid OAuth access token')
    expect(writes).toHaveLength(0)
  })

  it('still saves when /register fails, marked disconnected with the reason', async () => {
    registerMock.mockRejectedValue(new Error('Two-step verification PIN mismatch'))
    const { client, writes } = fakeDb({})
    const result = await saveWhatsAppConnection({ ...baseArgs(client), pin: '123456' })
    expect(result).toMatchObject({
      ok: true,
      registered: false,
      registrationError: 'Two-step verification PIN mismatch',
    })
    expect(writes[0].row).toMatchObject({
      status: 'disconnected',
      registered_at: null,
      connected_at: null,
      last_registration_error: 'Two-step verification PIN mismatch',
    })
  })

  it('skips /register without a PIN (Meta test numbers) and says so', async () => {
    const { client, writes } = fakeDb({})
    const result = await saveWhatsAppConnection({ ...baseArgs(client) })
    expect(registerMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, registered: false, registrationSkipped: true })
    expect(writes[0].row).toMatchObject({ status: 'connected', registered_at: null })
  })

  it('does not re-register the same registered number when no PIN is given', async () => {
    const existing = {
      id: 'cfg-1',
      phone_number_id: 'PN1',
      registered_at: '2026-11-06T10:00:00.000Z',
      verify_token: 'enc(old-verify)',
    }
    const { client, writes } = fakeDb({ existing })
    const result = await saveWhatsAppConnection({ ...baseArgs(client) })
    expect(registerMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, registered: true, registrationSkipped: false })
    expect(writes[0].op).toBe('update')
    expect(writes[0].row).toMatchObject({
      registered_at: '2026-11-06T10:00:00.000Z',
      // A blank verify token keeps the saved one.
      verify_token: 'enc(old-verify)',
    })
  })

  it("doesn't carry the old number's registration over to a new number", async () => {
    const existing = {
      id: 'cfg-1',
      phone_number_id: 'OLD_PN',
      registered_at: '2026-11-06T10:00:00.000Z',
      verify_token: null,
    }
    const { client, writes } = fakeDb({ existing })
    const result = await saveWhatsAppConnection({ ...baseArgs(client) })
    expect(result).toMatchObject({ ok: true, registered: false, registrationSkipped: true })
    expect(writes[0].row.registered_at).toBeNull()
  })

  it('treats a failed webhook subscription as non-fatal', async () => {
    subscribeMock.mockRejectedValue(new Error('boom'))
    const { client, writes } = fakeDb({})
    const result = await saveWhatsAppConnection({ ...baseArgs(client), pin: '123456' })
    expect(result).toMatchObject({ ok: true, registered: true })
    expect(writes[0].row.subscribed_apps_at).toBeNull()
  })

  it('reports a failed write', async () => {
    const { client } = fakeDb({ writeError: { message: 'denied' } })
    const result = await saveWhatsAppConnection({ ...baseArgs(client), pin: '123456' })
    expect(result).toMatchObject({ ok: false, status: 500 })
  })
})

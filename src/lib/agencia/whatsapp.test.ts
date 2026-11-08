import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/whatsapp/meta-api', () => ({ verifyPhoneNumber: vi.fn() }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: vi.fn() }))

import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  loadWhatsAppDetail,
  loadWhatsAppStatuses,
  summarizeWhatsApp,
  type WhatsAppConfigRow,
} from './whatsapp'

const verifyMock = vi.mocked(verifyPhoneNumber)
const decryptMock = vi.mocked(decrypt)

const OK_ROW: WhatsAppConfigRow & { access_token: string } = {
  account_id: 'acc-1',
  phone_number_id: 'PN1',
  status: 'connected',
  registered_at: '2026-11-06T10:00:00Z',
  last_registration_error: null,
  access_token: 'enc',
}

describe('summarizeWhatsApp', () => {
  it('connected when registered and up', () => {
    expect(summarizeWhatsApp(OK_ROW)).toEqual({ state: 'connected', reason: null })
  })

  it('none without a row or a number', () => {
    expect(summarizeWhatsApp(null).state).toBe('none')
    expect(summarizeWhatsApp({ ...OK_ROW, phone_number_id: null }).state).toBe('none')
  })

  it("attention with Meta's registration error first", () => {
    const s = summarizeWhatsApp({ ...OK_ROW, status: 'disconnected', last_registration_error: 'PIN mismatch' })
    expect(s.state).toBe('attention')
    expect(s.reason).toContain('PIN mismatch')
  })

  it('attention when marked down', () => {
    expect(summarizeWhatsApp({ ...OK_ROW, status: 'disconnected' }).reason).toMatch(/desconectada/)
  })

  it('attention when saved but never registered', () => {
    expect(summarizeWhatsApp({ ...OK_ROW, registered_at: null }).reason).toMatch(/registrado/)
  })

  it('says why when Meta cut the connection (W3)', () => {
    const removed = summarizeWhatsApp({ ...OK_ROW, status: 'disconnected', status_reason: 'partner_removed' })
    expect(removed.state).toBe('attention')
    expect(removed.reason).toMatch(/removeu o acesso/)
    const offboarded = summarizeWhatsApp({
      ...OK_ROW,
      status: 'disconnected',
      status_reason: 'account_offboarded',
    })
    expect(offboarded.reason).toMatch(/app WhatsApp Business/)
  })

  it('ignores a leftover reason once connected again', () => {
    expect(summarizeWhatsApp({ ...OK_ROW, status_reason: 'partner_removed' })).toEqual({
      state: 'connected',
      reason: null,
    })
  })
})

// Minimal query builder: whatsapp_config answers `row`, messages
// answers `lastMessage`. Every chain method returns the builder.
function fakeAdmin(opts: {
  row?: object | null
  rows?: object[]
  error?: { message: string } | null
  lastMessage?: string | null
}) {
  const calls: { table: string; filters: unknown[][] }[] = []
  const from = (table: string) => {
    const entry = { table, filters: [] as unknown[][] }
    calls.push(entry)
    const result =
      table === 'messages'
        ? { data: opts.lastMessage ? [{ created_at: opts.lastMessage }] : [], error: null }
        : { data: opts.rows ?? [], error: opts.error ?? null }
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (...args: unknown[]) => {
        entry.filters.push(args)
        return builder
      },
      order: () => builder,
      limit: () => Promise.resolve(result),
      maybeSingle: () => Promise.resolve({ data: opts.row ?? null, error: opts.error ?? null }),
      then: (resolve: (v: unknown) => unknown) => resolve(result),
    }
    return builder
  }
  return { client: { from } as unknown as SupabaseClient, calls }
}

beforeEach(() => {
  verifyMock.mockReset().mockResolvedValue({
    id: 'PN1',
    display_phone_number: '+55 63 3333-0000',
    verified_name: 'Clínica Sol',
    quality_rating: 'GREEN',
  })
  decryptMock.mockReset().mockReturnValue('TOKEN')
})

describe('loadWhatsAppStatuses', () => {
  it('maps every CRM to its state', async () => {
    const { client } = fakeAdmin({
      rows: [OK_ROW, { ...OK_ROW, account_id: 'acc-2', registered_at: null }],
    })
    const map = await loadWhatsAppStatuses(client)
    expect(map?.get('acc-1')?.state).toBe('connected')
    expect(map?.get('acc-2')?.state).toBe('attention')
    expect(map?.get('acc-3')).toBeUndefined()
  })

  it('returns null on a read error so the table can fall back', async () => {
    const { client } = fakeAdmin({ error: { message: 'boom' } })
    expect(await loadWhatsAppStatuses(client)).toBeNull()
  })
})

describe('loadWhatsAppDetail', () => {
  it('with read consent: number, name, quality and last inbound', async () => {
    const { client, calls } = fakeAdmin({ row: OK_ROW, lastMessage: '2026-11-07T12:00:00Z' })
    const d = await loadWhatsAppDetail(client, 'acc-1', { personal: true })
    expect(d).toMatchObject({
      state: 'connected',
      detailsAllowed: true,
      lastInboundAt: '2026-11-07T12:00:00Z',
      phone: { displayPhoneNumber: '+55 63 3333-0000', verifiedName: 'Clínica Sol', qualityRating: 'GREEN' },
    })
    expect(verifyMock).toHaveBeenCalledWith({ phoneNumberId: 'PN1', accessToken: 'TOKEN' })
    // Only this CRM's WhatsApp customer messages are looked at.
    const msgFilters = calls.find((c) => c.table === 'messages')?.filters
    expect(msgFilters).toEqual(
      expect.arrayContaining([
        ['conversations.account_id', 'acc-1'],
        ['conversations.channel', 'whatsapp'],
        ['sender_type', 'customer'],
      ]),
    )
  })

  it('flags a coexistence connection', async () => {
    const { client } = fakeAdmin({ row: { ...OK_ROW, connection_mode: 'coexistence' } })
    const d = await loadWhatsAppDetail(client, 'acc-1', { personal: true })
    expect(d.coexistence).toBe(true)
  })

  it('with metrics-only consent: status, but no number and no message time', async () => {
    const { client, calls } = fakeAdmin({ row: OK_ROW, lastMessage: '2026-11-07T12:00:00Z' })
    const d = await loadWhatsAppDetail(client, 'acc-1', { personal: false })
    expect(d).toMatchObject({ state: 'connected', detailsAllowed: false, phone: null, lastInboundAt: null })
    // The messages table isn't even read.
    expect(calls.some((c) => c.table === 'messages')).toBe(false)
  })

  it('not connected: no Meta call', async () => {
    const { client } = fakeAdmin({ row: null })
    const d = await loadWhatsAppDetail(client, 'acc-1', { personal: true })
    expect(d.state).toBe('none')
    expect(verifyMock).not.toHaveBeenCalled()
  })

  it('a token Meta refuses turns the status to attention, with the reason', async () => {
    verifyMock.mockRejectedValue(new Error('Error validating access token'))
    const { client } = fakeAdmin({ row: OK_ROW })
    const d = await loadWhatsAppDetail(client, 'acc-1', { personal: true })
    expect(d.state).toBe('attention')
    expect(d.reason).toContain('Error validating access token')
    expect(d.phone).toBeNull()
  })

  it('an unreadable token says to reconnect, without calling Meta', async () => {
    decryptMock.mockImplementation(() => {
      throw new Error('bad key')
    })
    const { client } = fakeAdmin({ row: OK_ROW })
    const d = await loadWhatsAppDetail(client, 'acc-1', { personal: true })
    expect(d.state).toBe('attention')
    expect(d.reason).toMatch(/Conecte o WhatsApp de novo/)
    expect(verifyMock).not.toHaveBeenCalled()
  })

  it('a read error is shown as attention, not as "not connected"', async () => {
    const { client } = fakeAdmin({ error: { message: 'boom' } })
    const d = await loadWhatsAppDetail(client, 'acc-1', { personal: true })
    expect(d.state).toBe('attention')
  })
})

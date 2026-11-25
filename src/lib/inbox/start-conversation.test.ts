import { beforeEach, describe, expect, it, vi } from 'vitest'

const provider = vi.fn()
const uazapiConfig = vi.fn()
const checkNumber = vi.fn()
const resolve = vi.fn()

vi.mock('@/lib/channels/whatsapp-route', () => ({
  resolveWhatsAppProvider: (...a: unknown[]) => provider(...a),
}))
vi.mock('@/lib/uazapi/config', () => ({
  getUazapiConfig: (...a: unknown[]) => uazapiConfig(...a),
  isUazapiReady: (c: { ready?: boolean } | null) => Boolean(c?.ready),
}))
vi.mock('@/lib/uazapi/api', () => ({
  checkUazapiNumber: (...a: unknown[]) => checkNumber(...a),
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (s: string) => `plain:${s}` }))
vi.mock('@/lib/whatsapp/resolve-conversation', () => ({
  resolveConversationByPhone: (...a: unknown[]) => resolve(...a),
}))

const { normalizeTypedPhone, startConversation, StartConversationError, TEAM_STARTED_SOURCE } =
  await import('./start-conversation')

// Minimal chain for the `contacts.source` update.
const updates: Array<Record<string, unknown>> = []
const db = {
  from: () => ({
    update: (row: Record<string, unknown>) => {
      updates.push(row)
      return { eq: () => ({ is: async () => ({ error: null }) }) }
    },
  }),
} as never

beforeEach(() => {
  vi.clearAllMocks()
  updates.length = 0
  provider.mockResolvedValue('meta')
  resolve.mockResolvedValue({ conversationId: 'conv-1', contactId: 'ct-1', contactCreated: true })
})

describe('normalizeTypedPhone', () => {
  it('adds 55 to a Brazilian number typed with DDD', () => {
    expect(normalizeTypedPhone('(63) 99208-5436')).toBe('5563992085436')
    expect(normalizeTypedPhone('63 9208-5436')).toBe('556392085436')
    expect(normalizeTypedPhone('0 63 99208-5436')).toBe('5563992085436')
  })

  it('keeps a number already in international form', () => {
    expect(normalizeTypedPhone('+55 63 99208-5436')).toBe('5563992085436')
    expect(normalizeTypedPhone('5563992085436')).toBe('5563992085436')
    expect(normalizeTypedPhone('+1 555 620 2983')).toBe('15556202983')
  })

  it('refuses what cannot be a phone', () => {
    expect(normalizeTypedPhone('')).toBeNull()
    expect(normalizeTypedPhone('99208-5436')).toBeNull()
    expect(normalizeTypedPhone('55 63 9')).toBeNull()
    expect(normalizeTypedPhone('+55 63 99208-54361')).toBeNull()
  })
})

describe('startConversation', () => {
  it('opens the conversation and marks a new contact as started by the team', async () => {
    const r = await startConversation(db, { accountId: 'acc', phone: '63 99208-5436', name: ' Ana ' })
    expect(resolve).toHaveBeenCalledWith(db, 'acc', '+5563992085436', 'Ana')
    expect(r).toEqual({ conversationId: 'conv-1', contactId: 'ct-1', contactCreated: true, provider: 'meta' })
    expect(updates).toEqual([{ source: TEAM_STARTED_SOURCE }])
    expect(checkNumber).not.toHaveBeenCalled()
  })

  it('leaves an existing contact as it was', async () => {
    resolve.mockResolvedValue({ conversationId: 'conv-1', contactId: 'ct-1', contactCreated: false })
    await startConversation(db, { accountId: 'acc', phone: '63992085436' })
    expect(updates).toEqual([])
  })

  it('refuses a bad number and a CRM without WhatsApp, creating nothing', async () => {
    await expect(startConversation(db, { accountId: 'acc', phone: '123' })).rejects.toMatchObject({
      code: 'bad_phone',
      status: 400,
    })
    provider.mockResolvedValue(null)
    await expect(startConversation(db, { accountId: 'acc', phone: '63992085436' })).rejects.toBeInstanceOf(
      StartConversationError,
    )
    expect(resolve).not.toHaveBeenCalled()
  })

  it('QR code: stops when the phone says the number has no WhatsApp', async () => {
    provider.mockResolvedValue('uazapi')
    uazapiConfig.mockResolvedValue({ ready: true, base_url: 'https://u', instance_token: 'enc' })
    checkNumber.mockResolvedValue(false)
    await expect(startConversation(db, { accountId: 'acc', phone: '63992085436' })).rejects.toMatchObject({
      code: 'no_whatsapp',
    })
    expect(checkNumber).toHaveBeenCalledWith({ baseUrl: 'https://u', token: 'plain:enc' }, '5563992085436')
    expect(resolve).not.toHaveBeenCalled()
  })

  it("QR code: goes ahead when the phone can't tell", async () => {
    provider.mockResolvedValue('uazapi')
    uazapiConfig.mockResolvedValue({ ready: true, base_url: 'https://u', instance_token: 'enc' })
    checkNumber.mockResolvedValue(null)
    const r = await startConversation(db, { accountId: 'acc', phone: '63992085436' })
    expect(r.provider).toBe('uazapi')
  })
})

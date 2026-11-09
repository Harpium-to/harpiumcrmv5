import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------
// The agency console on the unofficial path (D1): a CRM connected by
// QR code shows that connection's state — above all, the phone having
// dropped — instead of "WhatsApp not connected".
// ---------------------------------------------------------------------

vi.mock('@/lib/whatsapp/meta-api', () => ({ verifyPhoneNumber: vi.fn() }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'TOKEN' }))
vi.mock('@/lib/uazapi/api', () => ({ getUazapiStatus: vi.fn() }))

import { getUazapiStatus } from '@/lib/uazapi/api'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import {
  loadWhatsAppDetail,
  loadWhatsAppStatuses,
  summarizeUnofficial,
  type UazapiStatusRow,
} from './whatsapp'

const liveMock = vi.mocked(getUazapiStatus)

const UAZ: UazapiStatusRow = {
  account_id: 'acc-q',
  base_url: 'https://harpium.uazapi.com',
  instance_token: 'enc',
  enabled: true,
  status: 'connected',
  paired_phone: '5563999990000',
}

/** Answers by table; `single` rows for maybeSingle, `rows` for lists. */
function fakeAdmin(tables: Record<string, { rows?: object[]; single?: object | null; error?: object }>) {
  const from = (table: string) => {
    const t = tables[table] ?? {}
    const list = { data: t.rows ?? [], error: t.error ?? null }
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => Promise.resolve(list),
      maybeSingle: () => Promise.resolve({ data: t.single ?? null, error: t.error ?? null }),
      then: (resolve: (v: unknown) => unknown) => resolve(list),
    }
    return builder
  }
  return { from } as unknown as SupabaseClient
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('summarizeUnofficial', () => {
  it('reads the cached state in the order an operator would act', () => {
    expect(summarizeUnofficial(null).state).toBe('none')
    expect(summarizeUnofficial({ ...UAZ, instance_token: null }).state).toBe('none')
    expect(summarizeUnofficial({ ...UAZ, enabled: false }).reason).toMatch(/desligada/)
    expect(summarizeUnofficial(UAZ)).toEqual({ state: 'connected', reason: null })
    expect(summarizeUnofficial({ ...UAZ, status: 'connecting' }).reason).toMatch(/ainda não foi lido/)
    expect(summarizeUnofficial({ ...UAZ, status: 'disconnected' }).reason).toMatch(
      /ler o QR code de novo/,
    )
  })
})

describe('loadWhatsAppStatuses', () => {
  it('a CRM on the QR code shows that connection, even with an old Meta row', async () => {
    const map = await loadWhatsAppStatuses(
      fakeAdmin({
        whatsapp_config: {
          rows: [
            {
              account_id: 'acc-q',
              phone_number_id: 'PN',
              status: 'connected',
              registered_at: '2026-11-01T00:00:00Z',
              last_registration_error: null,
            },
          ],
        },
        accounts: { rows: [{ id: 'acc-q', whatsapp_path: 'nao_oficial' }] },
        uazapi_config: { rows: [{ ...UAZ, status: 'disconnected' }] },
      }),
    )
    expect(map?.get('acc-q')).toEqual({
      state: 'attention',
      reason: expect.stringMatching(/celular desconectou/),
    })
  })

  it('a CRM that chose the official path keeps the Meta state, whatever its QR row says', async () => {
    const map = await loadWhatsAppStatuses(
      fakeAdmin({
        whatsapp_config: {
          rows: [
            {
              account_id: 'acc-q',
              phone_number_id: 'PN',
              status: 'connected',
              registered_at: '2026-11-01T00:00:00Z',
              last_registration_error: null,
            },
          ],
        },
        accounts: { rows: [{ id: 'acc-q', whatsapp_path: 'oficial' }] },
        uazapi_config: { rows: [UAZ] },
      }),
    )
    expect(map?.get('acc-q')?.state).toBe('connected')
  })

  it('before 059, an enabled QR connection still counts as the CRM’s WhatsApp', async () => {
    const map = await loadWhatsAppStatuses(
      fakeAdmin({
        whatsapp_config: { rows: [] },
        accounts: { error: { message: 'column accounts.whatsapp_path does not exist' } },
        uazapi_config: { rows: [UAZ] },
      }),
    )
    expect(map?.get('acc-q')?.state).toBe('connected')
  })
})

describe('loadWhatsAppDetail on the unofficial path', () => {
  it('asks the gateway, shows the number with consent, and never calls Meta', async () => {
    liveMock.mockResolvedValue({
      status: 'connected',
      connected: true,
      loggedIn: true,
      qrcode: null,
      paircode: null,
      phone: '5563999990000',
      profileName: 'Clínica Sol',
    })
    const detail = await loadWhatsAppDetail(
      fakeAdmin({
        accounts: { single: { whatsapp_path: 'nao_oficial' } },
        uazapi_config: { single: UAZ },
        messages: { rows: [{ created_at: '2026-11-09T10:00:00Z' }] },
      }),
      'acc-q',
      { personal: true },
    )
    expect(detail).toMatchObject({
      state: 'connected',
      path: 'nao_oficial',
      phone: { displayPhoneNumber: '+5563999990000', verifiedName: 'Clínica Sol', qualityRating: null },
      lastInboundAt: '2026-11-09T10:00:00Z',
    })
    expect(verifyPhoneNumber).not.toHaveBeenCalled()
  })

  it('the phone dropped: attention, and no number without consent', async () => {
    liveMock.mockResolvedValue({
      status: 'disconnected',
      connected: false,
      loggedIn: false,
      qrcode: null,
      paircode: null,
      phone: null,
      profileName: null,
    })
    const detail = await loadWhatsAppDetail(
      fakeAdmin({
        accounts: { single: { whatsapp_path: 'nao_oficial' } },
        uazapi_config: { single: UAZ },
      }),
      'acc-q',
      { personal: false },
    )
    expect(detail.state).toBe('attention')
    expect(detail.reason).toMatch(/ler o QR code de novo/)
    expect(detail.phone).toBeNull()
    expect(detail.lastInboundAt).toBeNull()
  })

  it('a gateway that cannot be reached is attention with the reason', async () => {
    liveMock.mockRejectedValue(new Error('Falha ao consultar status: HTTP 401'))
    const detail = await loadWhatsAppDetail(
      fakeAdmin({
        accounts: { single: { whatsapp_path: 'nao_oficial' } },
        uazapi_config: { single: UAZ },
      }),
      'acc-q',
      { personal: true },
    )
    expect(detail).toMatchObject({ state: 'attention', path: 'nao_oficial' })
    expect(detail.reason).toMatch(/HTTP 401/)
  })
})

import { describe, expect, it } from 'vitest'

import { unofficialConnection } from './whatsapp-connection'

describe('unofficialConnection', () => {
  it('a paired QR-code number is connected', () => {
    expect(
      unofficialConnection({
        effectivePath: 'nao_oficial',
        provider: 'uazapi',
        naoOficial: { configured: true, status: 'connected' },
      }),
    ).toEqual({ configured: true, connected: true })
  })

  it('a QR-code number that dropped, or is still pairing, is not', () => {
    for (const status of ['disconnected', 'connecting', 'hibernated', null]) {
      expect(
        unofficialConnection({
          effectivePath: 'nao_oficial',
          provider: 'uazapi',
          naoOficial: { configured: true, status },
        }),
      ).toEqual({ configured: true, connected: false })
    }
  })

  it('the unofficial path with nothing set up yet', () => {
    expect(
      unofficialConnection({ effectivePath: 'nao_oficial', provider: null, naoOficial: { configured: false } }),
    ).toEqual({ configured: false, connected: false })
  })

  it('a ready Evolution instance counts as connected', () => {
    expect(
      unofficialConnection({ effectivePath: 'nao_oficial', provider: 'evolution', naoOficial: { evolution: true } }),
    ).toEqual({ configured: true, connected: true })
  })

  it('leaves the official path (and no choice) to the official-API check', () => {
    expect(unofficialConnection({ effectivePath: 'oficial', provider: 'meta' })).toBeNull()
    expect(unofficialConnection({ effectivePath: null })).toBeNull()
    expect(unofficialConnection(null)).toBeNull()
  })
})

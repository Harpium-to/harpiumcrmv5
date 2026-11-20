import { describe, expect, it } from 'vitest'

import {
  DEFAULT_INBOX_SETTINGS,
  arrivalTarget,
  decideReturn,
  parseInboxSettings,
  type InboxSettings,
} from './chegada'

const NOW = new Date('2026-11-20T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)
const settings = (patch: Partial<InboxSettings> = {}): InboxSettings => ({ ...DEFAULT_INBOX_SETTINGS, ...patch })

describe('parseInboxSettings', () => {
  it('fills the defaults and drops what it does not know', () => {
    expect(parseInboxSettings(null)).toEqual(DEFAULT_INBOX_SETTINGS)
    expect(
      parseInboxSettings({
        arrival_mode: 'por_canal',
        arrival_by_channel: { whatsapp: 'team-1', instagram: '', telegram: 3 },
        return_mode: 'xyz',
        return_days: 1000,
      }),
    ).toEqual({
      arrivalMode: 'por_canal',
      arrivalByChannel: { whatsapp: 'team-1' },
      returnMode: 'mesma_pessoa',
      returnDays: 365,
    })
  })
})

describe('arrivalTarget', () => {
  it('maps each rule', () => {
    expect(arrivalTarget(settings(), 'whatsapp', 't-entry')).toBeNull()
    expect(arrivalTarget(settings({ arrivalMode: 'rodizio' }), 'whatsapp', null)).toEqual({ kind: 'rodizio' })
    expect(arrivalTarget(settings({ arrivalMode: 'setor_entrada' }), 'whatsapp', 't-entry')).toEqual({ kind: 'setor', teamId: 't-entry' })
    expect(arrivalTarget(settings({ arrivalMode: 'setor_entrada' }), 'whatsapp', null)).toBeNull()
    const byChannel = settings({ arrivalMode: 'por_canal', arrivalByChannel: { whatsapp: 't-wa', instagram: 'rodizio' } })
    expect(arrivalTarget(byChannel, 'whatsapp', null)).toEqual({ kind: 'setor', teamId: 't-wa' })
    expect(arrivalTarget(byChannel, 'instagram', null)).toEqual({ kind: 'rodizio' })
    expect(arrivalTarget(byChannel, 'email', null)).toBeNull()
  })
})

describe('decideReturn', () => {
  const base = {
    settings: settings(),
    ownerId: 'u-ana' as string | null,
    ownerAvailable: true,
    teamId: null as string | null,
    lastHumanAt: daysAgo(3) as Date | null,
    now: NOW,
    arrival: null,
  }

  it('the same person within the window, when available', () => {
    expect(decideReturn(base)).toEqual({ kind: 'manter' })
  })

  it('that person away: the setor, else the arrival rule, else wait for them', () => {
    expect(decideReturn({ ...base, ownerAvailable: false, teamId: 't-fin' })).toEqual({
      kind: 'distribuir',
      target: { kind: 'setor', teamId: 't-fin' },
    })
    expect(decideReturn({ ...base, ownerAvailable: false, arrival: { kind: 'rodizio' } })).toEqual({
      kind: 'distribuir',
      target: { kind: 'rodizio' },
    })
    expect(decideReturn({ ...base, ownerAvailable: false })).toEqual({ kind: 'manter' })
  })

  it('past the window, or never talked to a person: start over', () => {
    expect(decideReturn({ ...base, lastHumanAt: daysAgo(30) })).toEqual({ kind: 'recomecar' })
    expect(decideReturn({ ...base, lastHumanAt: null })).toEqual({ kind: 'recomecar' })
  })

  it('"ia" always starts over; "distribuir" always distributes', () => {
    expect(decideReturn({ ...base, settings: settings({ returnMode: 'ia' }) })).toEqual({ kind: 'recomecar' })
    expect(
      decideReturn({ ...base, settings: settings({ returnMode: 'distribuir' }), arrival: { kind: 'rodizio' } }),
    ).toEqual({ kind: 'distribuir', target: { kind: 'rodizio' } })
    expect(decideReturn({ ...base, settings: settings({ returnMode: 'distribuir' }) })).toEqual({ kind: 'nada' })
  })
})

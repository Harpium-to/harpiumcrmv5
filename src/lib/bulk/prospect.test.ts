import { describe, expect, it } from 'vitest'

import { BULK_DAILY_LIMIT, dayKey } from './plan'
import {
  easter,
  holidays,
  isOpen,
  isWorkingDay,
  nextWorkingDay,
  parseVariations,
  planProspectTimes,
  PROSPECT_EXAMPLES,
  rampLimit,
  VariationError,
} from './prospect'
import { brakeReason, type BrakeRow } from './prospect-brake'
import { isOptOutReply } from './prospect-reply'

const at = (iso: string) => Date.parse(iso)
/** Brasília wall-clock "HH:MM" of an instant. */
const clock = (ms: number) => new Date(ms - 3 * 3_600_000).toISOString().slice(11, 16)

describe('the calendar', () => {
  it('knows Easter and the holidays that hang on it', () => {
    expect(easter(2026)).toBe('2026-04-05')
    expect(easter(2027)).toBe('2027-03-28')
    const h = holidays(2026)
    for (const day of ['2026-02-16', '2026-02-17', '2026-04-03', '2026-06-04', '2026-11-20', '2026-12-25']) {
      expect(h.has(day)).toBe(true)
    }
  })
  it('working days and hours, in Brasília', () => {
    expect(isWorkingDay('2026-11-17')).toBe(true) // Tuesday
    expect(isWorkingDay('2026-11-21')).toBe(false) // Saturday
    expect(isWorkingDay('2026-11-20')).toBe(false) // Consciência Negra
    expect(nextWorkingDay('2026-11-19')).toBe('2026-11-23')
    expect(isOpen(at('2026-11-17T12:00:00Z'))).toBe(true) // 9h
    expect(isOpen(at('2026-11-17T11:59:00Z'))).toBe(false) // 8h59
    expect(isOpen(at('2026-11-17T20:59:00Z'))).toBe(true) // 17h59
    expect(isOpen(at('2026-11-17T21:00:00Z'))).toBe(false) // 18h
  })
  it('the daily ceiling grows with the weeks', () => {
    expect(rampLimit('2026-11-17', '2026-11-17')).toBe(20)
    expect(rampLimit('2026-11-23', '2026-11-17')).toBe(20)
    expect(rampLimit('2026-11-24', '2026-11-17')).toBe(40)
    expect(rampLimit('2026-12-01', '2026-11-17')).toBe(60)
    expect(rampLimit('2027-03-01', '2026-11-17')).toBe(80)
  })
})

describe('planProspectTimes', () => {
  const base = { firstDay: '2026-11-17', prospectByDay: {}, allByDay: {}, random: () => 0.5 }

  it('spaces sends 2 minutes apart (random 0.5) inside working hours', () => {
    const times = planProspectTimes({ ...base, n: 3, afterMs: at('2026-11-17T13:00:00Z') })
    expect(times.map(clock)).toEqual(['10:02', '10:04', '10:06'])
  })

  it('waits for 9h, and skips the weekend and holidays', () => {
    const early = planProspectTimes({ ...base, n: 1, afterMs: at('2026-11-17T09:00:00Z') })
    expect(clock(early[0])).toMatch(/^09:/)
    // Thursday 17h59 → Friday is a holiday (20/11) → Monday morning.
    const late = planProspectTimes({ ...base, n: 2, afterMs: at('2026-11-19T20:58:00Z') })
    expect(late.map(dayKey)).toEqual(['2026-11-23', '2026-11-23'])
  })

  it('20 a day in the first week; the rest moves to the next working day', () => {
    const times = planProspectTimes({ ...base, n: 45, afterMs: at('2026-11-17T12:00:00Z') })
    const perDay: Record<string, number> = {}
    for (const t of times) perDay[dayKey(t)] = (perDay[dayKey(t)] ?? 0) + 1
    expect(perDay).toEqual({ '2026-11-17': 20, '2026-11-18': 20, '2026-11-19': 5 })
    expect(times.every(isOpen)).toBe(true)
  })

  it('counts what is already planned, and the CRM-wide ceiling', () => {
    const times = planProspectTimes({
      ...base,
      firstDay: '2026-10-01',
      n: 5,
      afterMs: at('2026-11-17T12:00:00Z'),
      prospectByDay: { '2026-11-17': 78 },
      allByDay: { '2026-11-18': BULK_DAILY_LIMIT },
    })
    expect(times.map(dayKey)).toEqual(['2026-11-17', '2026-11-17', '2026-11-19', '2026-11-19', '2026-11-19'])
  })
})

describe('the texts', () => {
  it('needs three different ones, each with SAIR and no link', () => {
    expect(parseVariations(PROSPECT_EXAMPLES)).toHaveLength(3)
    expect(() => parseVariations(PROSPECT_EXAMPLES.slice(0, 2))).toThrow(VariationError)
    expect(() => parseVariations([...PROSPECT_EXAMPLES.slice(0, 2), PROSPECT_EXAMPLES[0]])).toThrow('pelo menos 3')
    expect(() => parseVariations([...PROSPECT_EXAMPLES.slice(0, 2), 'Oi! Responda se quiser.'])).toThrow('SAIR')
    expect(() =>
      parseVariations([...PROSPECT_EXAMPLES.slice(0, 2), 'Veja https://site.com e responda SAIR se não quiser']),
    ).toThrow('links')
  })
})

describe('SAIR', () => {
  it('reads the usual ways of saying stop, and nothing more', () => {
    for (const text of ['SAIR', 'sair.', 'Pare', 'Não quero', 'nao tenho interesse, obrigado', 'Me tira da lista!', 'stop']) {
      expect(isOptOutReply(text)).toBe(true)
    }
    for (const text of ['Quero saber mais', 'Pode sair amanhã?', 'Não quero agora, mas me chama mês que vem com o preço', '', null]) {
      expect(isOptOutReply(text)).toBe(false)
    }
  })
})

describe('the brake', () => {
  const row = (status: string, i: number, replied = false): BrakeRow => ({
    status,
    processed_at: new Date(Date.UTC(2026, 10, 17, 12, i)).toISOString(),
    replied_at: replied ? '2026-11-17T15:00:00Z' : null,
  })

  it('stops after three failures in a row', () => {
    expect(brakeReason([row('sent', 1, true), row('failed', 2), row('failed', 3), row('failed', 4)])).toMatch(
      /últimas mensagens falharam/,
    )
    expect(brakeReason([row('failed', 1), row('failed', 2), row('sent', 3, true)])).toBeNull()
  })

  it('stops when more than 10% failed', () => {
    const rows = [...Array.from({ length: 16 }, (_, i) => row('sent', i, i === 0)), row('failed', 20), row('sent', 21), row('failed', 22)]
    expect(brakeReason(rows)).toMatch(/10%/)
  })

  it('stops after 30 sent and nobody answered', () => {
    const silent = Array.from({ length: 30 }, (_, i) => row('sent', i))
    expect(brakeReason(silent)).toMatch(/ninguém respondeu/)
    expect(brakeReason([...silent.slice(1), row('sent', 40, true)])).toBeNull()
    expect(brakeReason([...silent.slice(1), row('scheduled', 40)])).toBeNull()
  })
})

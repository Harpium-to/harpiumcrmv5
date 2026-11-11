import { describe, expect, it } from 'vitest'

import { buildIcs, foldLine, icsText, type IcsEvent } from './ics'

const calendar = { id: 'c1', name: 'Dr. João', timezone: 'America/Sao_Paulo' }
const now = new Date('2030-01-01T00:00:00Z')

const event = (over: Partial<IcsEvent> = {}): IcsEvent => ({
  id: 'e1',
  kind: 'appointment',
  title: 'Retorno',
  notes: null,
  starts_at: '2030-01-07T12:00:00.000Z',
  ends_at: '2030-01-07T12:30:00.000Z',
  status: 'confirmed',
  updated_at: '2030-01-02T10:00:00.000Z',
  contact: { name: 'Ana Souza', phone: '5511900000001' },
  ...over,
})

const lines = (ics: string) => ics.split('\r\n')

describe('icsText', () => {
  it('escapes what the format reserves', () => {
    expect(icsText('Sala 2; trazer exames, por favor\\ok')).toBe(
      'Sala 2\; trazer exames\\, por favor\\\\ok',
    )
    expect(icsText('linha 1\nlinha 2')).toBe('linha 1\\nlinha 2')
  })
})

describe('foldLine', () => {
  it('leaves a short line alone', () => {
    expect(foldLine('SUMMARY:Ana')).toBe('SUMMARY:Ana')
  })

  it('folds at 75 bytes, continuing with a space', () => {
    const folded = foldLine(`DESCRIPTION:${'a'.repeat(200)}`)
    const parts = folded.split('\r\n')
    expect(parts.length).toBeGreaterThan(2)
    expect(parts[0]).toHaveLength(75)
    for (const part of parts.slice(1)) {
      expect(part.startsWith(' ')).toBe(true)
      expect(part.length).toBeLessThanOrEqual(75)
    }
    // Unfolding gives the line back.
    expect(folded.replace(/\r\n /g, '')).toBe(`DESCRIPTION:${'a'.repeat(200)}`)
  })

  it('never cuts an accented letter in half', () => {
    const line = `SUMMARY:${'ção'.repeat(40)}`
    const folded = foldLine(line)
    const encoder = new TextEncoder()
    for (const part of folded.split('\r\n')) {
      expect(encoder.encode(part).length).toBeLessThanOrEqual(75)
    }
    expect(folded.replace(/\r\n /g, '')).toBe(line)
  })
})

describe('buildIcs', () => {
  it('is a calendar named after the agenda', () => {
    const out = lines(buildIcs({ calendar, events: [], now }))
    expect(out[0]).toBe('BEGIN:VCALENDAR')
    expect(out).toContain('X-WR-CALNAME:Dr. João')
    expect(out.at(-2)).toBe('END:VCALENDAR')
    expect(out.at(-1)).toBe('')
  })

  it('writes an appointment with who, what, when and how it stands', () => {
    const out = lines(buildIcs({ calendar, events: [event()], now }))
    expect(out).toContain('UID:e1@agenda.harpium')
    expect(out).toContain('DTSTART:20300107T120000Z')
    expect(out).toContain('DTEND:20300107T123000Z')
    expect(out).toContain('DTSTAMP:20300102T100000Z')
    expect(out).toContain('SUMMARY:Ana Souza — Retorno')
    expect(out).toContain('DESCRIPTION:Situação: Confirmado\\nWhatsApp: 5511900000001')
    expect(out).toContain('STATUS:CONFIRMED')
    expect(out).toContain('TRANSP:OPAQUE')
  })

  it('leaves cancelled ones out, so a following calendar drops them', () => {
    const ics = buildIcs({ calendar, events: [event({ status: 'cancelled' })], now })
    expect(ics).not.toContain('BEGIN:VEVENT')
  })

  it('marks one that waits for approval as tentative', () => {
    expect(buildIcs({ calendar, events: [event({ status: 'pending' })], now })).toContain(
      'STATUS:TENTATIVE',
    )
  })

  it('a block is named by its reason and does not count as busy', () => {
    const out = lines(
      buildIcs({
        calendar,
        events: [event({ kind: 'block', title: 'Férias', contact: null })],
        now,
      }),
    )
    expect(out).toContain('SUMMARY:Férias')
    expect(out).toContain('TRANSP:TRANSPARENT')
    expect(out.some((l) => l.startsWith('DESCRIPTION'))).toBe(false)
  })

  it('names an appointment with no contact and no title', () => {
    expect(
      buildIcs({ calendar, events: [event({ title: null, contact: null })], now }),
    ).toContain('SUMMARY:Agendamento')
  })
})

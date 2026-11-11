import { describe, expect, it } from 'vitest'

import { describeAgendaError, formatDuration } from './status'
import { DEFAULT_WEEK, fromWeekDraft, nextRange, toWeekDraft } from './week'

describe('toWeekDraft', () => {
  it('always has seven days, Monday first', () => {
    const draft = toWeekDraft([])
    expect(draft.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(draft.every((d) => !d.open && d.ranges.length === 1)).toBe(true)
  })

  it('reads what the database stores, in order', () => {
    const draft = toWeekDraft([
      { weekday: 1, starts: '14:00:00', ends: '18:00:00' },
      { weekday: 1, starts: '08:00:00', ends: '12:00:00' },
    ])
    expect(draft[0]).toEqual({
      weekday: 1,
      open: true,
      ranges: [
        { starts: '08:00', ends: '12:00' },
        { starts: '14:00', ends: '18:00' },
      ],
    })
    expect(draft[1].open).toBe(false)
  })

  it('round-trips the default week', () => {
    expect(fromWeekDraft(toWeekDraft(DEFAULT_WEEK))).toEqual({ rows: DEFAULT_WEEK })
  })
})

describe('fromWeekDraft', () => {
  const day = (ranges: [string, string][], open = true) => [
    { weekday: 2, open, ranges: ranges.map(([starts, ends]) => ({ starts, ends })) },
  ]

  it('a closed day saves nothing, whatever its fields hold', () => {
    expect(fromWeekDraft(day([['18:00', '08:00']], false))).toEqual({ rows: [] })
  })

  it('refuses an end before the start, naming the day', () => {
    expect(fromWeekDraft(day([['18:00', '08:00']]))).toEqual({
      error: 'Em terça-feira, o fim precisa ser depois do início.',
    })
  })

  it('refuses two periods that overlap', () => {
    expect(
      fromWeekDraft(
        day([
          ['08:00', '13:00'],
          ['12:00', '18:00'],
        ]),
      ),
    ).toEqual({ error: 'Em terça-feira, os dois períodos se sobrepõem.' })
  })

  it('refuses an empty field', () => {
    expect(fromWeekDraft(day([['', '12:00']]))).toEqual({
      error: 'Preencha os horários de terça-feira.',
    })
  })

  it('saves the periods in order even if typed the other way round', () => {
    expect(
      fromWeekDraft(
        day([
          ['14:00', '18:00'],
          ['08:00', '12:00'],
        ]),
      ),
    ).toEqual({
      rows: [
        { weekday: 2, starts: '08:00', ends: '12:00' },
        { weekday: 2, starts: '14:00', ends: '18:00' },
      ],
    })
  })
})

describe('nextRange', () => {
  it('after a morning comes the afternoon', () => {
    expect(
      nextRange({ weekday: 1, open: true, ranges: [{ starts: '08:00', ends: '12:00' }] }),
    ).toEqual({ starts: '14:00', ends: '18:00' })
  })

  it('after a full day comes something later that still fits', () => {
    expect(
      nextRange({ weekday: 1, open: true, ranges: [{ starts: '09:00', ends: '17:00' }] }),
    ).toEqual({ starts: '18:00', ends: '20:00' })
  })
})

describe('words', () => {
  it('formats a length the way people say it', () => {
    expect(formatDuration(30)).toBe('30 min')
    expect(formatDuration(60)).toBe('1h')
    expect(formatDuration(90)).toBe('1h30')
  })

  it('turns the database’s refusals into sentences', () => {
    expect(describeAgendaError({ code: '23P01' }, 'x')).toBe(
      'Esse horário já está ocupado nesta agenda.',
    )
    expect(describeAgendaError({ code: 'XX000' }, 'Não consegui salvar.')).toBe(
      'Não consegui salvar.',
    )
    expect(describeAgendaError(null, 'Não consegui salvar.')).toBe('Não consegui salvar.')
  })
})

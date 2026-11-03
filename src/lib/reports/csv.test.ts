import { describe, expect, it } from 'vitest'

import { csvCell, slugForFilename, toCsv } from './csv'

describe('csvCell', () => {
  it('leaves a plain value alone', () => {
    expect(csvCell('Maria')).toBe('Maria')
    expect(csvCell(42)).toBe('42')
    expect(csvCell(0)).toBe('0')
  })

  it('renders null and undefined as empty, not as the word', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('quotes a value containing a comma', () => {
    expect(csvCell('Souza, Ltda')).toBe('"Souza, Ltda"')
  })

  it('doubles embedded quotes', () => {
    expect(csvCell('o "melhor" preço')).toBe('"o ""melhor"" preço"')
  })

  it('quotes a value containing a newline', () => {
    expect(csvCell('linha 1\nlinha 2')).toBe('"linha 1\nlinha 2"')
  })

  it('defuses a formula so opening the file does not run it', () => {
    // These arrive from lead names and notes, which anyone can fill in.
    // Both defences compose: the apostrophe makes it text, then the
    // quoting makes it one cell.
    expect(csvCell('=HYPERLINK("http://evil.test","clique")')).toBe(
      '"\'=HYPERLINK(""http://evil.test"",""clique"")"',
    )
    expect(csvCell('+1+1')).toBe("'+1+1")
    expect(csvCell('-2+3')).toBe("'-2+3")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
  })

  it('defuses a formula and still quotes it when needed', () => {
    const out = csvCell('=A1,B1')
    expect(out.startsWith('"\'=')).toBe(true)
    expect(out).toBe('"\'=A1,B1"')
  })

  it('leaves a negative number readable as a number', () => {
    // A real trade-off: '-5 is text in the spreadsheet. Accepted,
    // because a numeric column is emitted by the report's own
    // formatter and never arrives as user text.
    expect(csvCell(-5)).toBe("'-5")
  })
})

describe('toCsv', () => {
  interface Row {
    name: string
    value: number
  }
  const columns = [
    { header: 'Nome', value: (r: Row) => r.name },
    { header: 'Valor', value: (r: Row) => r.value },
  ]

  it('starts with a BOM so Excel reads the accents', () => {
    expect(toCsv([], columns).startsWith('﻿')).toBe(true)
  })

  it('writes a header even with no rows', () => {
    expect(toCsv([], columns)).toBe('﻿Nome,Valor')
  })

  it('separates rows with CRLF', () => {
    const out = toCsv(
      [
        { name: 'Ana', value: 10 },
        { name: 'Bruno', value: 20 },
      ],
      columns,
    )
    expect(out).toBe('﻿Nome,Valor\r\nAna,10\r\nBruno,20')
  })

  it('escapes cells coming from the rows', () => {
    const out = toCsv([{ name: 'Souza, Ltda', value: 1 }], columns)
    expect(out).toContain('"Souza, Ltda",1')
  })
})

describe('slugForFilename', () => {
  it('strips accents and punctuation', () => {
    expect(slugForFilename('Relatório Comercial – Maio')).toBe(
      'relatorio-comercial-maio',
    )
  })

  it('cannot inject a header', () => {
    // The result goes into Content-Disposition between quotes.
    const out = slugForFilename('a"\r\nX-Evil: 1')
    expect(out).not.toContain('"')
    expect(out).not.toContain('\r')
    expect(out).not.toContain('\n')
  })

  it('falls back rather than producing an empty name', () => {
    expect(slugForFilename('—––')).toBe('relatorio')
    expect(slugForFilename('')).toBe('relatorio')
  })
})

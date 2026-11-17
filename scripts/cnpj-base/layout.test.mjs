import { describe, expect, it } from 'vitest'

import {
  NumberSet,
  cnae,
  date,
  empresa,
  estabelecimento,
  isMobile,
  meiBasico,
  money,
  municipio,
  packBasico,
  parseLine,
  phone,
  responsavel,
  stripPersonalNumber,
} from './layout.mjs'

// Lines in the Receita's own layout (2026-11), with made-up data.
const EST =
  '"12345678";"0001";"90";"1";"CLINICA SORRISO";"02";"20200110";"00";"";"";"20190305";"8630504";"8630503,8650004";"AVENIDA";"T 63";"1234";"SALA 5";"SETOR BUENO";"74230100";"GO";"9373";"62";"32221111";"62";"999998888";"";"";"CONTATO@SORRISO.COM.BR";"";""'

describe('parseLine', () => {
  it('splits quoted fields, keeping ";" and doubled quotes inside them', () => {
    expect(parseLine('"a";"b;c";"d ""e""";""')).toEqual(['a', 'b;c', 'd "e"', ''])
    expect(parseLine('"0001";"GUAJARA-MIRIM"')).toEqual(['0001', 'GUAJARA-MIRIM'])
  })
  it('reads the 30 columns of an establishment', () => {
    expect(parseLine(EST)).toHaveLength(30)
  })
})

describe('small values', () => {
  it('phones: DDD + 8 or 9 digits, else nothing', () => {
    expect(phone('62', '32221111')).toBe('6232221111')
    expect(phone('062', '999998888')).toBe('62999998888')
    expect(phone('', '32221111')).toBeNull()
    expect(phone('62', '1234')).toBeNull()
    expect(phone('62', '00000000')).toBeNull()
  })
  it('mobile or landline', () => {
    expect(isMobile('62999998888')).toBe(true)
    expect(isMobile('6299998888')).toBe(true)
    expect(isMobile('6232221111')).toBe(false)
    expect(isMobile(null)).toBe(false)
  })
  it('dates and money', () => {
    expect(date('20190305')).toBe('2019-03-05')
    expect(date('00000000')).toBeNull()
    expect(date('')).toBeNull()
    expect(money('5000,00')).toBe(5000)
    expect(money('1.250.000,50')).toBe(1250000.5)
    expect(money('')).toBeNull()
  })
  it('a MEI name loses the CPF, at the end or the old prefix', () => {
    expect(stripPersonalNumber('MARIA DA SILVA 12345678900')).toBe('MARIA DA SILVA')
    expect(stripPersonalNumber('12.345.678 MARIA DA SILVA')).toBe('MARIA DA SILVA')
    expect(stripPersonalNumber('MARIA DA SILVA 123.456.789-00')).toBe('MARIA DA SILVA')
    expect(stripPersonalNumber('MARIA DA SILVA12345678900')).toBe('MARIA DA SILVA')
    expect(stripPersonalNumber('MARIA DA SILVA 123456789-00')).toBe('MARIA DA SILVA')
    expect(stripPersonalNumber('MARIA DA SILVA 12.345.678')).toBe('MARIA DA SILVA')
    expect(stripPersonalNumber('PADARIA 24 HORAS LTDA')).toBe('PADARIA 24 HORAS LTDA')
  })
})

describe('estabelecimento', () => {
  it('maps an active one', () => {
    expect(estabelecimento(parseLine(EST), '2026-11')).toEqual({
      cnpj: '12345678000190',
      basico: '12345678',
      matriz: true,
      nome_fantasia: 'CLINICA SORRISO',
      abertura: '2019-03-05',
      cnae: '8630504',
      endereco: 'AVENIDA T 63, 1234 - SALA 5',
      bairro: 'SETOR BUENO',
      cep: '74230100',
      uf: 'GO',
      municipio: 9373,
      telefone1: '6232221111',
      telefone2: '62999998888',
      email: 'contato@sorriso.com.br',
      tem_celular: true,
      lote: '2026-11',
    })
  })
  it('leaves out who is not active, and other states when asked', () => {
    const closed = parseLine(EST.replace('"02";"20200110"', '"08";"20200110"'))
    expect(estabelecimento(closed, '2026-11')).toBeNull()
    expect(estabelecimento(parseLine(EST), '2026-11', new Set(['TO']))).toBeNull()
    expect(estabelecimento(parseLine(EST), '2026-11', new Set(['GO']))).not.toBeNull()
  })
  it('accepts the CNPJ with letters (since July 2026)', () => {
    const row = estabelecimento(parseLine(EST.replace('"12345678"', '"12ABC345"')), '2026-11')
    expect(row?.cnpj).toBe('12ABC345000190')
  })
})

describe('empresa, MEI and who answers for it', () => {
  it('a company keeps its name; a MEI loses the CPF', () => {
    const ltda = parseLine('"12345678";"CLINICA SORRISO LTDA";"2062";"49";"50000,00";"01";""')
    expect(empresa(ltda, '2026-11', false)).toEqual({
      basico: '12345678',
      razao_social: 'CLINICA SORRISO LTDA',
      natureza: '2062',
      porte: '01',
      capital: 50000,
      mei: false,
      lote: '2026-11',
    })
    const mei = parseLine('"87654321";"JOAO PEREIRA 98765432100";"2135";"50";"1000,00";"01";""')
    expect(empresa(mei, '2026-11', true)).toMatchObject({ razao_social: 'JOAO PEREIRA', mei: true })
  })
  it('reads the MEI option from the Simples file', () => {
    expect(meiBasico(parseLine('"87654321";"S";"20200101";"00000000";"S";"20200101";"00000000"'))).toBe('87654321')
    expect(meiBasico(parseLine('"12345678";"S";"20200101";"00000000";"N";"00000000";"00000000"'))).toBeNull()
  })
  it('keeps the administrator and never the masked CPF', () => {
    const admin = parseLine('"12345678";"2";"ANA SOUZA";"***123456**";"49";"20190305";"";"***000000**";"";"00";"5"')
    expect(responsavel(admin, '2026-11')).toEqual({ basico: '12345678', nome: 'ANA SOUZA', lote: '2026-11' })
    const partner = parseLine('"12345678";"2";"BIA LIMA";"***654321**";"22";"20190305";"";"***000000**";"";"00";"5"')
    expect(responsavel(partner, '2026-11')).toBeNull()
    const company = parseLine('"12345678";"1";"HOLDING SA";"11222333000144";"49";"20190305";"";"";"";"00";"0"')
    expect(responsavel(company, '2026-11')).toBeNull()
  })
  it('activities and cities', () => {
    expect(cnae(parseLine('"8630504";"Atividade odontológica"'))).toEqual({
      codigo: '8630504',
      descricao: 'Atividade odontológica',
    })
    expect(municipio(parseLine('"9373";"GOIANIA"'))).toEqual({ codigo: 9373, nome: 'GOIANIA' })
  })
})

describe('NumberSet', () => {
  it('finds what was added, after sealing, with letters in the CNPJ', () => {
    const set = new NumberSet(2)
    for (const b of ['12345678', '00000001', '12ABC345', '12345678']) set.add(packBasico(b))
    set.seal()
    expect(set.size).toBe(3)
    expect(set.has(packBasico('12ABC345'))).toBe(true)
    expect(set.has(packBasico('00000001'))).toBe(true)
    expect(set.has(packBasico('99999999'))).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { MAX_LEAD_BODY_BYTES, formPairsToPayload, parseLeadBody } from './body'

describe('parseLeadBody', () => {
  it('reads JSON, with or without the right header', () => {
    expect(parseLeadBody('application/json', '{"nome":"Ana"}')).toEqual({
      ok: true,
      payload: { nome: 'Ana' },
    })
    expect(parseLeadBody('text/plain', '{"nome":"Ana"}')).toEqual({
      ok: true,
      payload: { nome: 'Ana' },
    })
    expect(parseLeadBody(null, '[{"nome":"Ana"}]')).toEqual({
      ok: true,
      payload: { nome: 'Ana' },
    })
  })

  it('reads url-encoded forms', () => {
    const r = parseLeadBody(
      'application/x-www-form-urlencoded; charset=utf-8',
      'nome=Ana+Lima&telefone=%2B5563999990000',
    )
    expect(r).toEqual({ ok: true, payload: { nome: 'Ana Lima', telefone: '+5563999990000' } })
    // Same body without the header.
    expect(parseLeadBody(null, 'nome=Ana&email=a%40b.com')).toEqual({
      ok: true,
      payload: { nome: 'Ana', email: 'a@b.com' },
    })
  })

  it('refuses unreadable and oversized bodies', () => {
    expect(parseLeadBody('application/json', '')).toEqual({ ok: false, error: 'formato_invalido' })
    expect(parseLeadBody('application/json', '{nope')).toEqual({ ok: false, error: 'formato_invalido' })
    expect(parseLeadBody('application/json', '"texto"')).toEqual({ ok: false, error: 'formato_invalido' })
    expect(parseLeadBody('application/json', '[1,2]')).toEqual({ ok: false, error: 'formato_invalido' })
    const big = JSON.stringify({ x: 'a'.repeat(MAX_LEAD_BODY_BYTES) })
    expect(parseLeadBody('application/json', big)).toEqual({ ok: false, error: 'muito_grande' })
  })
})

describe('formPairsToPayload', () => {
  it('nests bracket and dot keys, so a form can carry Harpium Lead v1', () => {
    const p = formPairsToPayload([
      ['versao', '1'],
      ['contato[nome]', 'Ana'],
      ['contato.telefone', '+5563999990000'],
      ['etiquetas[]', 'a'],
      ['etiquetas[]', 'b'],
      ['respostas[0][pergunta]', 'Faturamento'],
      ['respostas[0][resposta]', '100 mil'],
    ])
    expect(p).toEqual({
      versao: '1',
      contato: { nome: 'Ana', telefone: '+5563999990000' },
      etiquetas: ['a', 'b'],
      respostas: [{ pergunta: 'Faturamento', resposta: '100 mil' }],
    })
  })

  it('turns a repeated plain key into a list', () => {
    expect(formPairsToPayload([['servico', 'Site'], ['servico', 'SEO']])).toEqual({
      servico: ['Site', 'SEO'],
    })
  })

  it('ignores prototype keys and absurd indexes', () => {
    const p = formPairsToPayload([
      ['__proto__[x]', '1'],
      ['a[constructor]', '1'],
      ['lista[99999]', 'x'],
      ['ok', 'sim'],
    ])
    expect(p).toEqual({ lista: [], ok: 'sim' })
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })
})

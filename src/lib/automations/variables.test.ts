import { describe, expect, it } from 'vitest'

import { renderTemplate, usesContactVariables } from './variables'

const contact = {
  'contato.primeiro_nome': 'Ana',
  'contato.nome': 'Ana Souza',
  'contato.empresa': 'Planejados Silva',
  'contato.cidade': '',
  'campo.faturamento': '75 a 150 mil',
}

describe('renderTemplate', () => {
  it('fills contact, field, lead and message variables', () => {
    expect(
      renderTemplate(
        'Oi {{ contato.primeiro_nome }}, da {{contato.empresa}}! Faturamento: {{ campo.faturamento }}. Origem {{ vars.origem }}. Você disse: {{ message.text }}',
        { contact, vars: { origem: 'quiz' }, messageText: 'quero orçamento' },
      ),
    ).toBe(
      'Oi Ana, da Planejados Silva! Faturamento: 75 a 150 mil. Origem quiz. Você disse: quero orçamento',
    )
  })

  it('in a message, closes the gap an empty variable leaves', () => {
    const v = { contact: {} }
    const o = { closeGaps: true }
    expect(renderTemplate('Olá {{ contato.primeiro_nome }}, tudo bem?', v, o)).toBe('Olá, tudo bem?')
    expect(renderTemplate('Olá {{ contato.primeiro_nome }}!', v, o)).toBe('Olá!')
    expect(renderTemplate('Vi que você é de {{ contato.cidade }} e quer ajuda', { contact }, o)).toBe(
      'Vi que você é de e quer ajuda',
    )
    expect(renderTemplate('{{ contato.primeiro_nome }}, tudo bem?\nAbraço', v, o)).toBe('tudo bem?\nAbraço')
  })

  it('outside a message, an empty variable is just empty', () => {
    expect(renderTemplate('[{{ campo.nao_existe }}]', { contact })).toBe('[]')
    expect(renderTemplate('{"nome":"{{ contato.nome }}"}', { contact })).toBe('{"nome":"Ana Souza"}')
  })

  it('keeps the old {{ vars.* }} behaviour', () => {
    expect(renderTemplate('{{ vars.rota }}-{{ vars.nada }}', { vars: { rota: 'A' } })).toBe('A-')
    expect(renderTemplate('{{ desconhecido }}', {})).toBe('')
  })
})

describe('usesContactVariables', () => {
  it('only when contato.* or campo.* appear', () => {
    expect(usesContactVariables('Oi {{ contato.nome }}')).toBe(true)
    expect(usesContactVariables('Oi {{campo.x}}')).toBe(true)
    expect(usesContactVariables('Oi {{ vars.nome }}')).toBe(false)
    expect(usesContactVariables('Oi contato.nome')).toBe(false)
  })
})

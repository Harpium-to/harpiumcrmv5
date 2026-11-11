import { describe, expect, it } from 'vitest'

import { menuFromInteractive } from './menu'

describe('menuFromInteractive', () => {
  it('turns reply buttons into label|id choices, header in bold on top', () => {
    expect(
      menuFromInteractive({
        kind: 'buttons',
        header: 'Agenda',
        body: 'Qual horário?',
        footer: 'Responda tocando',
        buttons: [
          { id: 'manha', title: 'Manhã' },
          { id: 'tarde', title: 'Tarde | noite' },
        ],
      }),
    ).toEqual({
      type: 'button',
      text: '*Agenda*\n\nQual horário?',
      choices: ['Manhã|manha', 'Tarde / noite|tarde'],
      footerText: 'Responda tocando',
    })
  })

  it('turns a list into sections and rows, keeping the ids', () => {
    expect(
      menuFromInteractive({
        kind: 'list',
        body: 'Escolha o serviço',
        button_label: 'Ver serviços',
        sections: [
          {
            title: 'Cabelo',
            rows: [
              { id: 'corte', title: 'Corte', description: 'Com lavagem' },
              { id: 'escova', title: 'Escova' },
            ],
          },
          { rows: [{ id: 'outro', title: 'Outro' }] },
        ],
      }),
    ).toEqual({
      type: 'list',
      text: 'Escolha o serviço',
      choices: ['[Cabelo]', 'Corte|corte|Com lavagem', 'Escova|escova', 'Outro|outro'],
      listButton: 'Ver serviços',
    })
  })

  it('refuses an id that would arrive back broken', () => {
    // Flows match the tapped id exactly; a shifted id would silently
    // send the customer down the wrong branch.
    expect(() =>
      menuFromInteractive({
        kind: 'buttons',
        body: 'x',
        buttons: [{ id: 'a|b', title: 'A' }],
      }),
    ).toThrow(/id de opção inválido/)
  })
})

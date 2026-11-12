import { describe, expect, it } from 'vitest'

import {
  answerLines,
  conditionHolds,
  evaluate,
  fieldError,
  formatPhone,
  funnelScreens,
  groupMatches,
  hasContactKey,
  interpolate,
  normalizeFieldValue,
  varsFrom,
  visibleSteps,
} from './engine'
import { sanitizeDefinition } from './validate'
import type { QuizField } from './types'

const quiz = sanitizeDefinition({
  intro: { enabled: true, headline: 'Oi', cta: 'Começar' },
  steps: [
    {
      id: 'perfil',
      type: 'choice',
      label: 'Perfil',
      title: 'Quem é você?',
      options: [
        { id: 'pf', label: 'Pessoa física' },
        { id: 'pj', label: 'Empresa' },
      ],
    },
    {
      id: 'porte',
      type: 'choice',
      label: 'Porte',
      title: 'Qual o porte?',
      options: [
        { id: 'p', label: 'Pequena' },
        { id: 'g', label: 'Grande' },
      ],
      showIf: [{ stepId: 'perfil', op: 'is', optionIds: ['pj'] }],
    },
    {
      id: 'canais',
      type: 'choice',
      label: 'Canais',
      title: 'Onde anuncia?',
      multiple: true,
      options: [
        { id: 'meta', label: 'Meta' },
        { id: 'google', label: 'Google' },
        { id: 'nenhum', label: 'Nenhum' },
      ],
    },
    {
      id: 'contato',
      type: 'fields',
      label: 'Contato',
      title: 'Seus dados',
      fields: [
        { id: 'nome', kind: 'name', label: 'Nome', required: true },
        { id: 'fone', kind: 'phone', label: 'WhatsApp', required: true },
        { id: 'obs', kind: 'longtext', label: 'Observação', required: false },
      ],
    },
  ],
  results: [
    { id: 'quente', name: 'Quente', route: 'A', tags: ['vip'], title: 'Boa' },
    { id: 'frio', name: 'Frio', route: 'C', title: 'Obrigado' },
    { id: 'meio', name: 'Morno', route: 'B', title: 'Quase' },
  ],
  rules: [
    {
      resultId: 'quente',
      match: 'all',
      conditions: [
        { stepId: 'perfil', op: 'is', optionIds: ['pj'] },
        { stepId: 'porte', op: 'is', optionIds: ['g'] },
      ],
    },
    { resultId: 'frio', match: 'any', conditions: [{ stepId: 'canais', op: 'is', optionIds: ['nenhum'] }] },
  ],
  defaultResultId: 'meio',
  tagRules: [
    { tag: 'anuncia', match: 'any', conditions: [{ stepId: 'canais', op: 'is', optionIds: ['meta', 'google'] }] },
    {
      tag: 'so-quente',
      match: 'all',
      conditions: [{ stepId: 'perfil', op: 'is', optionIds: ['pj'] }],
      resultIds: ['quente'],
    },
  ],
  settings: { tags: ['quiz'] },
})

describe('conditions', () => {
  it('treats an unanswered question as "is not"', () => {
    const is = { stepId: 'perfil', op: 'is' as const, optionIds: ['pj'] }
    const isNot = { ...is, op: 'is_not' as const }
    expect(conditionHolds(is, {})).toBe(false)
    expect(conditionHolds(isNot, {})).toBe(true)
    expect(conditionHolds(is, { perfil: 'pj' })).toBe(true)
    expect(conditionHolds(isNot, { perfil: 'pj' })).toBe(false)
  })

  it('matches a multiple answer when any chosen option is listed', () => {
    const c = { stepId: 'canais', op: 'is' as const, optionIds: ['google'] }
    expect(conditionHolds(c, { canais: ['meta', 'google'] })).toBe(true)
    expect(conditionHolds(c, { canais: ['meta'] })).toBe(false)
  })

  it('never matches a group with no condition', () => {
    expect(groupMatches([], 'all', { perfil: 'pj' })).toBe(false)
    expect(groupMatches([], 'any', { perfil: 'pj' })).toBe(false)
  })
})

describe('screens', () => {
  it('hides a conditional step until its condition holds', () => {
    expect(visibleSteps(quiz, {}).map((s) => s.id)).toEqual(['perfil', 'canais', 'contato'])
    expect(visibleSteps(quiz, { perfil: 'pj' }).map((s) => s.id)).toEqual([
      'perfil',
      'porte',
      'canais',
      'contato',
    ])
  })

  it('lists the funnel with the entry and the result', () => {
    expect(funnelScreens(quiz)).toEqual(['intro', 'perfil', 'porte', 'canais', 'contato', 'result'])
  })
})

describe('evaluate', () => {
  it('takes the first rule that matches, top to bottom', () => {
    const both = evaluate(quiz, { perfil: 'pj', porte: 'g', canais: ['nenhum'] })!
    expect(both.result.id).toBe('quente')
    expect(evaluate(quiz, { perfil: 'pf', canais: ['nenhum'] })!.result.id).toBe('frio')
  })

  it('falls back to the default result', () => {
    const outcome = evaluate(quiz, { perfil: 'pf', canais: ['meta'] })!
    expect(outcome.result.id).toBe('meio')
    expect(outcome.route).toBe('B')
    expect(outcome.reasons).toEqual([])
  })

  it('ignores the answer of a step the visitor no longer sees', () => {
    // "porte" was answered as a company, then the profile changed.
    expect(evaluate(quiz, { perfil: 'pf', porte: 'g', canais: ['meta'] })!.result.id).toBe('meio')
  })

  it('collects the quiz tags, the result tags and the earned ones, once each', () => {
    const outcome = evaluate(quiz, { perfil: 'pj', porte: 'g', canais: ['meta', 'google'] })!
    expect(outcome.tags).toEqual(['quiz', 'vip', 'anuncia', 'so-quente'])
    // The same answers that earn "so-quente" do not when the result is another.
    expect(evaluate(quiz, { perfil: 'pj', porte: 'p', canais: ['meta'] })!.tags).toEqual([
      'quiz',
      'anuncia',
    ])
  })

  it('says why, in the words of the answers', () => {
    expect(evaluate(quiz, { perfil: 'pj', porte: 'g' })!.reasons).toEqual([
      'Perfil: Empresa',
      'Porte: Grande',
    ])
  })
})

describe('text', () => {
  it('fills the variables', () => {
    const vars = varsFrom({ name: 'Ana Maria Souza', company: 'Loja X', phone: '+5563912345678' })
    expect(interpolate('Prazer, {nome}. A {empresa} está pronta?', vars)).toBe(
      'Prazer, Ana. A Loja X está pronta?',
    )
    expect(interpolate('Fica de olho no {whatsapp}.', vars)).toBe('Fica de olho no (63) 91234-5678.')
  })

  it('reads well when there is no name', () => {
    expect(interpolate('Prazer, {nome}. O que descreve melhor?', {})).toBe(
      'Prazer. O que descreve melhor?',
    )
    expect(interpolate('{nome}, quanto faz sentido investir?', {})).toBe(
      'Quanto faz sentido investir?',
    )
    expect(interpolate('A {empresa} tem perfil.', {})).toBe('A sua empresa tem perfil.')
  })

  it('leaves a text with no variable exactly as written', () => {
    expect(interpolate('preço  baixo ?', {})).toBe('preço  baixo ?')
  })

  it('formats Brazilian phones and leaves the rest alone', () => {
    expect(formatPhone('+5511912345678')).toBe('(11) 91234-5678')
    expect(formatPhone('+551132345678')).toBe('(11) 3234-5678')
    expect(formatPhone('+351912345678')).toBe('+351912345678')
  })
})

describe('fields', () => {
  const field = (kind: QuizField['kind'], required = true): QuizField => ({
    id: 'f',
    kind,
    label: 'x',
    required,
  })

  it('stores a phone with the country code', () => {
    expect(normalizeFieldValue(field('phone'), '(63) 91234-5678')).toBe('+5563912345678')
    expect(normalizeFieldValue(field('phone'), '+351 912 345 678')).toBe('+351912345678')
    expect(normalizeFieldValue(field('phone'), 'abc')).toBe('')
  })

  it('stores an Instagram handle whatever way it was typed', () => {
    expect(normalizeFieldValue(field('instagram'), 'https://www.instagram.com/loja.x/')).toBe('@loja.x')
    expect(normalizeFieldValue(field('instagram'), '@@loja')).toBe('@loja')
    expect(normalizeFieldValue(field('instagram'), 'loja')).toBe('@loja')
  })

  it('checks what was typed', () => {
    expect(fieldError(field('phone'), '(63) 9123')).toBe('Informe o WhatsApp com DDD.')
    expect(fieldError(field('phone'), '(63) 91234-5678')).toBeNull()
    expect(fieldError(field('email'), 'ana@')).toBe('Informe um e-mail válido.')
    expect(fieldError(field('email'), 'ana@loja.com.br')).toBeNull()
    expect(fieldError(field('name'), ' ')).toBe('Informe o seu nome.')
    expect(fieldError(field('number'), 'dez')).toBe('Informe um número.')
    expect(fieldError(field('number'), '10,5')).toBeNull()
  })

  it('lets an optional field stay empty, but still checks it when filled', () => {
    expect(fieldError(field('email', false), '')).toBeNull()
    expect(fieldError(field('email', false), 'x')).toBe('Informe um e-mail válido.')
  })

  it('needs a phone or an e-mail to reach someone', () => {
    expect(hasContactKey({ name: 'Ana' })).toBe(false)
    expect(hasContactKey({ email: 'a@b.co' })).toBe(true)
  })
})

describe('answerLines', () => {
  it('lists what was answered, without the contact details', () => {
    expect(
      answerLines(quiz, {
        perfil: 'pj',
        porte: 'p',
        canais: ['meta', 'google'],
        nome: 'Ana',
        fone: '+5563912345678',
        obs: 'Ligar à tarde',
      }),
    ).toEqual([
      { key: 'perfil', question: 'Perfil', answer: 'Empresa' },
      { key: 'porte', question: 'Porte', answer: 'Pequena' },
      { key: 'canais', question: 'Canais', answer: 'Meta, Google' },
      { key: 'obs', question: 'Observação', answer: 'Ligar à tarde' },
    ])
  })
})

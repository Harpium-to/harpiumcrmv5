import { describe, expect, it } from 'vitest'

import { lastStep, mergeSteps, parseSessionUpdate } from './session'
import { findQuizModel } from './templates'

const quiz = findQuizModel('moveis-planejados')!.definition
const SID = 'b6f0c1de-0000-4000-8000-000000000001'

describe('parseSessionUpdate', () => {
  it('refuses what the page would never send', () => {
    expect(parseSessionUpdate(quiz, null)).toBeNull()
    expect(parseSessionUpdate(quiz, 'x')).toBeNull()
    expect(parseSessionUpdate(quiz, { sid: 'short' })).toBeNull()
    expect(parseSessionUpdate(quiz, { sid: 'has spaces and <tags>' })).toBeNull()
  })

  it('keeps only screens and options the quiz has', () => {
    const update = parseSessionUpdate(quiz, {
      sid: SID,
      steps: ['tipo', 'intro', 'hacked', 'cargo'],
      answers: { tipo: 'loja', cargo: 'presidente', faturamento: ['ate30'], extra: 'x' },
    })!
    // In the quiz's order, whatever order they came in.
    expect(update.steps).toEqual(['intro', 'tipo', 'cargo'])
    expect(update.answers).toEqual({ tipo: 'loja' })
  })

  it('tidies the fields and cuts them to size', () => {
    const update = parseSessionUpdate(quiz, {
      sid: SID,
      answers: {
        primeiro_nome: `  ${'A'.repeat(500)}  `,
        whatsapp: '(63) 91234-5678',
        instagram: 'https://instagram.com/loja.x',
        empresa: 42,
      },
    })!
    expect((update.answers.primeiro_nome as string).length).toBe(80)
    expect(update.answers.whatsapp).toBe('+5563912345678')
    expect(update.answers.instagram).toBe('@loja.x')
    expect(update.answers.empresa).toBeUndefined()
  })

  it('reads the campaign, and only the campaign', () => {
    const update = parseSessionUpdate(quiz, {
      sid: SID,
      utms: { utm_campaign: 'nov', utm_content: 'video-1', fbclid: 'abc', utm_evil: 'x', utm_source: 7 },
    })!
    expect(update.utms).toEqual({ utm_campaign: 'nov', utm_content: 'video-1', fbclid: 'abc' })
  })

  it('counts a visit as done only if it saw the result screen', () => {
    expect(parseSessionUpdate(quiz, { sid: SID, done: true, steps: ['contato'] })!.done).toBe(false)
    expect(parseSessionUpdate(quiz, { sid: SID, done: true, steps: ['contato', 'result'] })!.done).toBe(true)
    expect(parseSessionUpdate(quiz, { sid: SID, done: 'yes', steps: ['result'] })!.done).toBe(false)
  })

  it('notices the hidden field a robot filled', () => {
    expect(parseSessionUpdate(quiz, { sid: SID, website: '' })!.trap).toBe(false)
    expect(parseSessionUpdate(quiz, { sid: SID, website: 'http://spam' })!.trap).toBe(true)
  })

  it('ignores an event id that is not one', () => {
    expect(parseSessionUpdate(quiz, { sid: SID, eventId: '<script>' })!.eventId).toBeNull()
    expect(parseSessionUpdate(quiz, { sid: SID, eventId: SID })!.eventId).toBe(SID)
  })
})

describe('screens seen', () => {
  it('never loses one, and stays in the quiz\'s order', () => {
    expect(mergeSteps(quiz, ['intro', 'nome', 'tipo'], ['nome'])).toEqual(['intro', 'nome', 'tipo'])
    expect(mergeSteps(quiz, ['tipo'], ['intro', 'cargo'])).toEqual(['intro', 'tipo', 'cargo'])
  })

  it('says where the visit stopped', () => {
    expect(lastStep(['intro', 'nome', 'tipo'])).toBe('tipo')
    expect(lastStep(['intro', 'contato', 'result'])).toBe('contato')
    expect(lastStep([])).toBeNull()
  })
})

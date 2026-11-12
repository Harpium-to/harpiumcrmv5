import { afterEach, describe, expect, it, vi } from 'vitest'

import { isValidSlug, proposeSlug, publicQuizUrl, quizHostUrl, slugFromName, slugProblem } from './slug'

describe('slugs', () => {
  it('turns a name into an address', () => {
    expect(slugFromName('Quiz Móveis Planejados!')).toBe('quiz-moveis-planejados')
    expect(slugFromName('  --Olá, Mundo--  ')).toBe('ola-mundo')
    expect(slugFromName('!!!')).toBe('')
  })

  it('proposes a valid address for any name', () => {
    for (const name of ['Quiz Móveis Planejados', '!!!', 'a', 'x'.repeat(200)]) {
      const slug = proposeSlug(name, 'a1b2c3')
      expect(isValidSlug(slug), slug).toBe(true)
      expect(slug.endsWith('a1b2c3')).toBe(true)
    }
  })

  it('accepts only lowercase letters, digits and inner hyphens', () => {
    expect(isValidSlug('diagnostico-2026')).toBe(true)
    expect(isValidSlug('Diagnostico')).toBe(false)
    expect(isValidSlug('-abc')).toBe(false)
    expect(isValidSlug('abc-')).toBe(false)
    expect(isValidSlug('a--b')).toBe(false)
    expect(isValidSlug('ab')).toBe(false)
    expect(isValidSlug('a/b')).toBe(false)
    expect(isValidSlug('../etc')).toBe(false)
  })

  it('keeps a few addresses for the app itself', () => {
    expect(isValidSlug('api')).toBe(false)
    expect(slugProblem('api')).toBe('Esse endereço é reservado. Escolha outro.')
  })

  it('says what is wrong in words', () => {
    expect(slugProblem('ab')).toContain('pelo menos 3')
    expect(slugProblem('Com Espaço')).toContain('letras minúsculas')
    expect(slugProblem('diagnostico')).toBeNull()
  })
})

describe('the public link', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('lives on the CRM\'s own address by default', () => {
    vi.stubEnv('NEXT_PUBLIC_QUIZ_URL', '')
    expect(quizHostUrl()).toBeNull()
    expect(publicQuizUrl('https://crm.test/', 'diagnostico')).toBe('https://crm.test/q/diagnostico')
  })

  it('moves to the quizzes\' own domain, short, when one is set', () => {
    vi.stubEnv('NEXT_PUBLIC_QUIZ_URL', 'https://quiz.harpium.com.br/')
    expect(publicQuizUrl('https://crm.test', 'diagnostico')).toBe('https://quiz.harpium.com.br/diagnostico')
  })

  it('ignores a value that is not a plain origin', () => {
    vi.stubEnv('NEXT_PUBLIC_QUIZ_URL', 'quiz.harpium.com.br/q')
    expect(quizHostUrl()).toBeNull()
  })
})

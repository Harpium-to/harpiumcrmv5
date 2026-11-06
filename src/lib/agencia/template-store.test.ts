import { describe, expect, it } from 'vitest'

import { templateSlug } from './template-store'

describe('templateSlug', () => {
  it('drops accents and punctuation', () => {
    expect(templateSlug('Clínica da Casa — Unidade 2!', 'abc123')).toBe(
      'clinica-da-casa-unidade-2-abc123',
    )
  })

  it('never comes out empty', () => {
    expect(templateSlug('!!!', 'x')).toBe('modelo-x')
  })
})

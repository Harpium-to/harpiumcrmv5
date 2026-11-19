import { describe, expect, it } from 'vitest'

import { parseBlocks, safeHref } from './harpi-markdown'

describe('Harpi markdown', () => {
  it('splits paragraphs, lists and headings', () => {
    expect(parseBlocks('Oi\n\n- um\n- dois\n\n1. a\n2. b\n### Título')).toEqual([
      { kind: 'p', text: 'Oi' },
      { kind: 'ul', items: ['um', 'dois'] },
      { kind: 'ol', items: ['a', 'b'] },
      { kind: 'h', text: 'Título' },
    ])
  })

  it('links only go inside the CRM or to https', () => {
    expect(safeHref('/contacts?contact=1')).toEqual({ internal: true, href: '/contacts?contact=1' })
    expect(safeHref('https://harpium.com.br')).toEqual({ internal: false, href: 'https://harpium.com.br' })
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('//evil.com')).toBeNull()
    expect(safeHref('http://inseguro.com')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'

import { checkDefinition, cleanTag, cleanUrl, sanitizeDefinition } from './validate'

const base = {
  intro: { enabled: true, headline: 'Oi', cta: 'Começar' },
  steps: [
    {
      id: 'a',
      type: 'choice',
      label: 'A',
      title: 'Primeira?',
      options: [
        { id: 'x', label: 'X' },
        { id: 'y', label: 'Y' },
      ],
    },
    {
      id: 'b',
      type: 'choice',
      label: 'B',
      title: 'Segunda?',
      options: [
        { id: 'x', label: 'X' },
        { id: 'y', label: 'Y' },
      ],
    },
    {
      id: 'c',
      type: 'fields',
      label: 'Contato',
      title: 'Contato',
      fields: [{ id: 'fone', kind: 'phone', label: 'WhatsApp', required: true }],
    },
  ],
  results: [{ id: 'r1', name: 'Um', route: 'A', title: 'Pronto' }],
}

describe('sanitizeDefinition', () => {
  it('answers with a playable quiz whatever it is given', () => {
    for (const junk of [null, undefined, 42, 'x', [], { steps: 'no', results: 7 }]) {
      const def = sanitizeDefinition(junk)
      expect(def.version).toBe(1)
      expect(def.steps).toEqual([])
      expect(def.results).toHaveLength(1)
      expect(def.defaultResultId).toBe(def.results[0].id)
      expect(def.appearance.accent).toBe('#22ced2')
    }
  })

  it('drops a condition that points at a question asked later', () => {
    const def = sanitizeDefinition({
      ...base,
      steps: [
        { ...base.steps[0], showIf: [{ stepId: 'b', op: 'is', optionIds: ['x'] }] },
        { ...base.steps[1], showIf: [{ stepId: 'a', op: 'is', optionIds: ['x'] }] },
        base.steps[2],
      ],
    })
    expect(def.steps[0].showIf).toBeUndefined()
    expect(def.steps[1].showIf).toEqual([{ stepId: 'a', op: 'is', optionIds: ['x'] }])
  })

  it('drops references to steps, options and results that are not there', () => {
    const def = sanitizeDefinition({
      ...base,
      rules: [
        { resultId: 'r1', match: 'any', conditions: [{ stepId: 'a', op: 'is', optionIds: ['x', 'gone'] }] },
        { resultId: 'ghost', match: 'any', conditions: [{ stepId: 'a', op: 'is', optionIds: ['x'] }] },
        { resultId: 'r1', match: 'any', conditions: [{ stepId: 'gone', op: 'is', optionIds: ['x'] }] },
        // A field screen is not something a rule can read.
        { resultId: 'r1', match: 'any', conditions: [{ stepId: 'c', op: 'is', optionIds: ['x'] }] },
      ],
      defaultResultId: 'ghost',
      tagRules: [{ tag: 'T', conditions: [{ stepId: 'a', op: 'is', optionIds: ['y'] }], resultIds: ['ghost', 'r1'] }],
    })
    expect(def.rules).toHaveLength(3)
    expect(def.rules[0].conditions).toEqual([{ stepId: 'a', op: 'is', optionIds: ['x'] }])
    expect(def.rules[1].conditions).toEqual([])
    expect(def.rules[2].conditions).toEqual([])
    expect(def.defaultResultId).toBe('r1')
    expect(def.tagRules[0]).toMatchObject({ tag: 't', match: 'all', resultIds: ['r1'] })
  })

  it('never keeps two things with the same id', () => {
    const def = sanitizeDefinition({
      ...base,
      steps: [base.steps[0], { ...base.steps[1], id: 'a' }, { ...base.steps[2], id: 'intro' }],
    })
    const ids = def.steps.map((s) => s.id)
    expect(new Set(ids).size).toBe(3)
    expect(ids[0]).toBe('a')
    // 'intro' and 'result' are the report's own screen names.
    expect(ids).not.toContain('intro')
  })

  it('cuts texts to size and only keeps safe links', () => {
    const def = sanitizeDefinition({
      ...base,
      intro: { headline: 'x'.repeat(999), cta: '' },
      appearance: { accent: 'red', logoUrl: 'javascript:alert(1)' },
      settings: { pixelId: 'abc 123-456', privacyUrl: 'javascript:alert(1)', tags: ['Olá Mundo', 'olá mundo', ''] },
      results: [
        {
          id: 'r1',
          name: 'Um',
          title: 'Pronto',
          pixel: { kind: 'custom', name: 'Meu Evento!' },
          blocks: [
            { type: 'button', label: 'Ir', kind: 'link', url: 'javascript:alert(1)' },
            { type: 'button', label: 'Site', kind: 'link', url: 'loja.com.br/oferta' },
            { type: 'button', label: 'Zap', kind: 'whatsapp', url: '+55 (63) 91234-5678' },
            { type: 'text', text: '' },
            { type: 'nope', text: 'x' },
          ],
        },
      ],
    })
    expect(def.intro.headline).toHaveLength(200)
    expect(def.intro.cta).toBe('Começar')
    expect(def.appearance).toEqual({ brandName: undefined, logoUrl: undefined, accent: '#22ced2' })
    expect(def.settings.pixelId).toBe('123456')
    expect(def.settings.privacyUrl).toBeUndefined()
    expect(def.settings.tags).toEqual(['ola-mundo'])
    expect(def.results[0].pixel).toEqual({ kind: 'custom', name: 'MeuEvento' })
    expect(def.results[0].blocks.map((b) => (b.type === 'button' ? b.url : b.type))).toEqual([
      '',
      'https://loja.com.br/oferta',
      '5563912345678',
    ])
  })
})

describe('checkDefinition', () => {
  it('passes a complete quiz', () => {
    expect(checkDefinition(sanitizeDefinition(base)).errors).toEqual([])
  })

  it('says what is missing, in words', () => {
    const def = sanitizeDefinition({
      intro: { enabled: true, headline: '' },
      steps: [
        { id: 'a', type: 'choice', label: 'A', title: 'Só uma?', options: [{ id: 'x', label: 'X' }] },
        { id: 'n', type: 'fields', label: 'Nome', title: 'Nome', fields: [{ id: 'nome', kind: 'name', label: 'Nome' }] },
      ],
      results: [{ id: 'r1', name: 'Um', title: '' }],
    })
    const { errors } = checkDefinition(def)
    expect(errors).toContain('A tela de entrada está sem título.')
    expect(errors).toContain('Pergunta 1 ("A") precisa de pelo menos duas opções.')
    expect(errors).toContain('O resultado "Um" está sem título.')
    expect(errors.some((e) => e.includes('WhatsApp ou de e-mail'))).toBe(true)
  })

  it('warns about a result no rule reaches and a button with no link', () => {
    const def = sanitizeDefinition({
      ...base,
      results: [
        { id: 'r1', name: 'Um', title: 'Pronto', blocks: [{ type: 'button', label: 'Comprar', url: '' }] },
        { id: 'r2', name: 'Dois', title: 'Pronto' },
      ],
      defaultResultId: 'r1',
    })
    const { errors, warnings } = checkDefinition(def)
    expect(errors).toEqual([])
    expect(warnings).toContain('Nenhuma regra leva ao resultado "Dois".')
    expect(warnings).toContain('O botão "Comprar" do resultado "Um" está sem link.')
  })
})

describe('helpers', () => {
  it('writes tags the way the CRM does', () => {
    expect(cleanTag('  Verba Baixa ')).toBe('verba-baixa')
    expect(cleanTag('decisor:SIM')).toBe('decisor:sim')
    expect(cleanTag('Móveis & Cia')).toBe('moveis-cia')
  })

  it('only lets through addresses a visitor can safely open', () => {
    expect(cleanUrl('https://x.com/a')).toBe('https://x.com/a')
    expect(cleanUrl('x.com/a')).toBe('https://x.com/a')
    expect(cleanUrl('#secao')).toBe('#secao')
    expect(cleanUrl('javascript:alert(1)')).toBe('')
    expect(cleanUrl('data:text/html,x')).toBe('')
  })
})

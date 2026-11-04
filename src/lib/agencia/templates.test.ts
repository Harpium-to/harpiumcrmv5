import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  describeApplySummary,
  describeCounts,
  parseTemplateContent,
  templateCounts,
} from './templates'

/** The three built-in templates, straight from migration 053. */
function builtIns(): Record<string, unknown> {
  const sql = readFileSync(
    join(__dirname, '../../../supabase/migrations/053_modelos_nicho.sql'),
    'utf8',
  )
  const out: Record<string, unknown> = {}
  // Each VALUES tuple opens with "(\n  '<slug>',\n  '<name>',".
  const re = /\(\s*\n\s*'([a-z-]+)',\s*\n\s*'[^'\n]+',[\s\S]*?\$json\$([\s\S]*?)\$json\$/g
  for (const m of sql.matchAll(re)) out[m[1]] = JSON.parse(m[2])
  return out
}

describe('the built-in templates', () => {
  const all = builtIns()

  it('are the three the agency chose', () => {
    expect(Object.keys(all).sort()).toEqual(['academia', 'clinica-medica', 'servicos'])
  })

  it.each(['academia', 'clinica-medica', 'servicos'])('%s passes the same validation as an edit', (slug) => {
    const r = parseTemplateContent(all[slug])
    expect(r.ok ? [] : r.errors).toEqual([])
  })

  it('the clinic template has what the plan promised', () => {
    expect(describeCounts(templateCounts(all['clinica-medica']))).toBe(
      '1 funil (6 etapas), 5 etiquetas, 4 campos, 5 respostas rápidas, 2 automações',
    )
  })
})

describe('parseTemplateContent', () => {
  it('accepts an empty template', () => {
    expect(parseTemplateContent({})).toEqual({
      ok: true,
      content: { pipelines: [], tags: [], custom_fields: [], quick_replies: [], automations: [] },
    })
  })

  it('collects every problem instead of stopping at the first', () => {
    const r = parseTemplateContent({
      pipelines: [{ name: 'Vendas', stages: [] }, { name: 'vendas', stages: [{ name: 'A' }] }],
      tags: [{ name: 'Quente', color: 'red' }],
      custom_fields: [{ name: 'Nascimento', type: 'date' }],
      quick_replies: [{ title: 'Oi' }],
      automations: [
        {
          name: 'X',
          trigger: 'tag_added',
          steps: [
            { type: 'send_webhook', config: { url: 'https://x' } },
            { type: 'create_deal', config: { pipeline: 'Vendas', stage: 'Fechado', title: 'T' } },
            { type: 'wait', config: { amount: 0, unit: 'weeks' } },
          ],
        },
      ],
    })
    expect(r.ok).toBe(false)
    const errors = r.ok ? [] : r.errors
    expect(errors).toEqual(
      expect.arrayContaining([
        'Funil "Vendas": precisa de pelo menos uma etapa.',
        'Funil repetido: "vendas".',
        'Etiqueta "Quente": cor precisa ser #RRGGBB.',
        'Campo "Nascimento": só o tipo "text" é suportado.',
        'Resposta rápida 1: precisa de título e texto.',
        'Automação "X": gatilho "tag_added" não pode ir num modelo.',
        'Automação "X", passo 1: tipo "send_webhook" não pode ir num modelo.',
        'Automação "X", passo 2: o funil "Vendas" não tem a etapa "Fechado".',
        'Automação "X", passo 3: espera precisa de "amount" > 0 e "unit" (minutes, hours, days).',
      ]),
    )
  })

  it('a keyword automation needs its keywords', () => {
    const r = parseTemplateContent({
      automations: [{ name: 'K', trigger: 'keyword_match', steps: [{ type: 'close_conversation', config: {} }] }],
    })
    expect(r.ok ? [] : r.errors).toEqual(['Automação "K": palavra-chave precisa de "keywords".'])
  })

  it('a deal step may point at a funnel the CRM already has', () => {
    const r = parseTemplateContent({
      automations: [
        {
          name: 'D',
          trigger: 'first_inbound_message',
          steps: [{ type: 'create_deal', config: { pipeline: 'Do cliente', stage: 'Novo', title: 'Lead' } }],
        },
      ],
    })
    expect(r.ok).toBe(true)
  })

  it('rejects anything that is not an object', () => {
    expect(parseTemplateContent([])).toEqual({
      ok: false,
      errors: ['O conteúdo precisa ser um objeto JSON.'],
    })
  })
})

describe('describeApplySummary', () => {
  it('says what was created and what was already there', () => {
    expect(
      describeApplySummary({ pipelines: 1, stages: 5, tags: 2, custom_fields: 0, quick_replies: 1, automations: 0, skipped: 3 }),
    ).toBe(
      'Criado: 1 funil (5 etapas), 2 etiquetas, 0 campos, 1 resposta rápida, 0 automações. 3 itens já existiam e ficaram como estavam.',
    )
  })
})

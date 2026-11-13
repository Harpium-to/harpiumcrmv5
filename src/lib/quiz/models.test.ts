import { describe, expect, it } from 'vitest'

import { evaluate, visibleBlocks, visibleSteps } from './engine'
import { findQuizModel, QUIZ_MODELS, summarizeModel } from './templates'
import { checkDefinition } from './validate'
import type { QuizAnswers, QuizDefinition } from './types'

/** The questions whose answer can change the result: read by a rule or by a condition to show a screen. */
function decisive(def: QuizDefinition): Set<string> {
  return new Set([
    ...def.rules.flatMap((r) => r.conditions.map((c) => c.stepId)),
    ...def.steps.flatMap((s) => (s.showIf ?? []).map((c) => c.stepId)),
  ])
}

/**
 * Every way through a quiz's decisive questions: one set of answers per
 * combination of their options (any other question takes its first
 * option, since it cannot change the result). Conditions only read
 * earlier answers, so answering in the order of the screens is enough.
 */
function* everyPath(
  def: QuizDefinition,
  answers: QuizAnswers = {},
  keys: Set<string> = decisive(def),
): Generator<QuizAnswers> {
  const next = visibleSteps(def, answers).find((s) => s.type === 'choice' && answers[s.id] === undefined)
  if (!next || next.type !== 'choice') {
    yield answers
    return
  }
  const choices = keys.has(next.id) ? next.options : next.options.slice(0, 1)
  for (const option of choices) yield* everyPath(def, { ...answers, [next.id]: option.id }, keys)
}

const model = (key: string) => {
  const found = findQuizModel(key)
  if (!found) throw new Error(`no model ${key}`)
  return found.definition
}

describe('the list of models', () => {
  it('has one key per model', () => {
    const keys = QUIZ_MODELS.map((m) => m.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('shows the niches first, the general ones next and Harpium’s own last', () => {
    const groups = QUIZ_MODELS.map((m) => m.group)
    const order = ['nicho', 'geral', 'interno']
    expect(groups).toEqual([...groups].sort((a, b) => order.indexOf(a) - order.indexOf(b)))
    expect(QUIZ_MODELS[QUIZ_MODELS.length - 1].key).toBe('moveis-planejados')
    expect(QUIZ_MODELS.filter((m) => m.group === 'interno').map((m) => m.key)).toEqual(['moveis-planejados'])
    expect(QUIZ_MODELS.filter((m) => m.group === 'nicho').length).toBeGreaterThanOrEqual(10)
  })

  it('covers every niche a CRM can have, except "outro"', () => {
    const covered = new Set(QUIZ_MODELS.map((m) => m.niche).filter(Boolean))
    for (const niche of ['medical_clinic', 'dental_aesthetic', 'gym', 'real_estate', 'education', 'law', 'retail', 'services']) {
      expect(covered.has(niche as never), niche).toBe(true)
    }
  })

  it('summarizes a model for the "Novo quiz" window', () => {
    expect(summarizeModel(findQuizModel('academia')!)).toMatchObject({
      key: 'academia',
      segment: 'Academia e studio',
      niche: 'gym',
      questions: 7,
      results: [
        { name: 'Qualificado · começa esta semana', route: 'A' },
        { name: 'Morno · começa este mês', route: 'B' },
        { name: 'Frio · só pesquisando', route: 'C' },
      ],
    })
  })
})

describe.each(QUIZ_MODELS.map((m) => [m.key, m] as const))('model %s', (_key, m) => {
  const def = m.definition

  it('can be published as it comes, and every result has a way in', () => {
    expect(checkDefinition(def).errors).toEqual([])
    expect(checkDefinition(def).warnings.filter((w) => w.startsWith('Nenhuma regra'))).toEqual([])
  })

  it('reaches every result with real answers', () => {
    const reached = new Set<string>()
    let paths = 0
    for (const answers of everyPath(def)) {
      reached.add(evaluate(def, answers)!.result.id)
      if (++paths > 100_000) throw new Error('too many paths')
    }
    expect([...reached].sort()).toEqual(def.results.map((r) => r.id).sort())
  })

  it('only says {nome} after asking for it', () => {
    let named = false
    for (const step of def.steps) {
      const text = [step.title, step.type === 'choice' ? (step.context ?? '') : ''].join(' ')
      if (text.includes('{nome}')) expect(named, `${step.id}: ${step.title}`).toBe(true)
      if (step.type === 'fields' && step.fields.some((f) => f.kind === 'name')) named = true
    }
  })

  it('asks for the contact on the last screen', () => {
    const last = def.steps[def.steps.length - 1]
    expect(last.type).toBe('fields')
    if (last.type === 'fields') {
      expect(last.fields.some((f) => f.kind === 'phone' || f.kind === 'email')).toBe(true)
    }
  })

  if (m.group === 'nicho') {
    it('fires the Lead event only for qualified results', () => {
      for (const result of def.results) {
        if (result.route === 'A') expect(result.pixel, result.id).toEqual({ kind: 'standard', name: 'Lead' })
        else expect(result.pixel.kind, result.id).toBe('custom')
      }
    })

    it('asks for the WhatsApp, required', () => {
      const fields = def.steps.flatMap((s) => (s.type === 'fields' ? s.fields : []))
      expect(fields.some((f) => f.kind === 'phone' && f.required)).toBe(true)
    })
  }
})

describe('Clínica médica', () => {
  const def = model('clinica-medica')
  const base = { motivo: 'sintoma', periodo: 'manha' }

  it('sorts by urgency and by how the person pays', () => {
    expect(evaluate(def, { ...base, urgencia: 'sem_pressa', pagamento: 'particular' })!.result.id).toBe('informar')
    expect(evaluate(def, { ...base, urgencia: 'semana', pagamento: 'particular' })!.result.id).toBe('prioridade')
    expect(evaluate(def, { ...base, urgencia: 'semana', pagamento: 'nao_sei' })!.result.id).toBe('orientar')
  })

  it('asks which health plan only to who uses one', () => {
    const ids = (a: QuizAnswers) => visibleSteps(def, a).map((s) => s.id)
    expect(ids({ pagamento: 'particular' })).not.toContain('convenio')
    expect(ids({ pagamento: 'convenio' })).toContain('convenio')
  })

  it('shows the emergency notice to who is in pain, whatever the result', () => {
    for (const pagamento of ['particular', 'nao_sei']) {
      const answers = { ...base, urgencia: 'hoje', pagamento }
      const result = evaluate(def, answers)!.result
      expect(visibleBlocks(result, def, answers).some((b) => 'text' in b && b.text.includes('192')), pagamento).toBe(true)
      expect(evaluate(def, answers)!.tags).toContain('urgente')
    }
  })
})

describe('Imobiliária', () => {
  const def = model('imobiliaria')

  it('sends who wants to sell to the listing result', () => {
    expect(evaluate(def, { intencao: 'vender', tipo: 'casa', prazo: 'pesquisando' })!.result.id).toBe('captacao')
  })

  it('qualifies a renter in a hurry, though renting never asks how to pay', () => {
    const answers = { intencao: 'alugar', tipo: 'apto', quartos: '2', valor_aluguel: 'ate1500', prazo: '30dias' }
    expect(visibleSteps(def, answers).map((s) => s.id)).not.toContain('pagamento')
    expect(evaluate(def, answers)!.result.id).toBe('visitar')
  })

  it('keeps a buyer who does not know how to pay as warm', () => {
    const answers = { intencao: 'comprar', tipo: 'casa', quartos: '3', valor_compra: 'ate300', pagamento: 'nao_sei', prazo: '30dias' }
    expect(evaluate(def, answers)!.result.id).toBe('planejando')
  })

  it('asks the questions of each path only', () => {
    const ids = (a: QuizAnswers) => visibleSteps(def, a).map((s) => s.id)
    expect(ids({ intencao: 'comprar', tipo: 'terreno' })).not.toContain('quartos')
    expect(ids({ intencao: 'alugar', tipo: 'apto' })).toEqual(
      expect.arrayContaining(['quartos', 'valor_aluguel']),
    )
    expect(ids({ intencao: 'vender', tipo: 'apto' })).toContain('valor_venda')
    expect(ids({ intencao: 'vender', tipo: 'apto' })).not.toContain('valor_compra')
  })
})

describe('Advocacia', () => {
  const def = model('advocacia')

  it('treats a notification as urgent even when the person says there is no rush', () => {
    const outcome = evaluate(def, { area: 'trabalhista', quem: 'pessoa', situacao: 'notificacao', urgencia: 'sem_pressa' })!
    expect(outcome.result.id).toBe('urgente')
    expect(outcome.tags).toEqual(expect.arrayContaining(['urgente', 'area:trabalhista']))
  })

  it('asks about the current lawyer only when there is a case running', () => {
    const ids = (a: QuizAnswers) => visibleSteps(def, a).map((s) => s.id)
    expect(ids({ situacao: 'acao' })).not.toContain('advogado')
    expect(ids({ situacao: 'processo' })).toContain('advogado')
  })
})

describe('Pesquisa de satisfação', () => {
  const def = model('pesquisa-satisfacao')

  it('splits promoters, neutrals and detractors', () => {
    expect(evaluate(def, { nota: 'n10' })!.result.id).toBe('promotor')
    expect(evaluate(def, { nota: 'n9' })!.result.id).toBe('promotor')
    expect(evaluate(def, { nota: 'n8' })!.result.id).toBe('neutro')
    expect(evaluate(def, { nota: 'n7' })!.result.id).toBe('neutro')
    expect(evaluate(def, { nota: 'n6' })!.result.id).toBe('detrator')
    expect(evaluate(def, { nota: 'n0' })!.result.tags).toContain('nps:detrator')
  })

  it('sends nothing to the Pixel and lets the contact be left out', () => {
    expect(def.results.every((r) => r.pixel.kind === 'none')).toBe(true)
    const fields = def.steps.flatMap((s) => (s.type === 'fields' ? s.fields : []))
    expect(fields.every((f) => !f.required)).toBe(true)
  })
})

describe('Loja e e-commerce', () => {
  it('shows the coupon on every result', () => {
    const def = model('varejo')
    for (const result of def.results) {
      expect(result.blocks.some((b) => b.type === 'highlight' && b.text.includes('PRESENTE10')), result.id).toBe(true)
    }
  })
})

describe('Serviços para empresas', () => {
  const def = model('servicos-b2b')

  it('rules out a company with no budget, whatever else it answered', () => {
    const answers = { cargo: 'dono', porte: '100mais', faturamento: '1mmais', desafio: 'vender', prazo: 'ja', investimento: 'sem' }
    expect(evaluate(def, answers)!.route).toBe('C')
  })

  it('flags a qualified company with a small budget for the sales team', () => {
    const answers = { cargo: 'dono', porte: '6a20', faturamento: '200a1m', desafio: 'vender', prazo: 'ja', investimento: 'ate2k' }
    const outcome = evaluate(def, answers)!
    expect(outcome.route).toBe('A')
    expect(outcome.tags).toEqual(expect.arrayContaining(['decisor:sim', 'verba-baixa', 'desafio:vendas']))
  })
})

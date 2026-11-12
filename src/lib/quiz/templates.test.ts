import { describe, expect, it } from 'vitest'

import { contactFrom, evaluate, visibleBlocks, visibleSteps } from './engine'
import { publicDefinition } from './public'
import { findQuizModel, QUIZ_MODELS } from './templates'
import { checkDefinition, sanitizeDefinition } from './validate'
import type { QuizAnswers } from './types'

const planejados = findQuizModel('moveis-planejados')!.definition

// ---------------------------------------------------------------------
// The rule of the original quiz (quiz-planejados/src/quiz/rota.ts),
// kept here as the answer sheet: the model must decide every possible
// combination of answers the way that code did.
// ---------------------------------------------------------------------
interface Original {
  tipo: string
  cargo: string
  decisao?: string
  faturamento: string
  investimento: string
  prazo: string
}

function originalRule(r: Original): { rota: 'A' | 'B' | 'C'; tags: string[] } {
  const tags = [r.cargo === 'dono' ? 'decisor:sim' : 'decisor:nao']
  if (r.cargo === 'gerente' && r.decisao === 'so_dono') tags.push('prioridade-baixa')

  if (
    r.tipo === 'arquiteto' ||
    r.tipo === 'outro' ||
    ['ate30', '30a50'].includes(r.faturamento) ||
    r.investimento === 'sem_verba'
  ) {
    return { rota: 'C', tags }
  }
  if (
    (r.cargo !== 'dono' && r.cargo !== 'gerente') ||
    r.faturamento === '50a75' ||
    r.prazo === 'pesquisando'
  ) {
    return { rota: 'B', tags }
  }
  if (!['2500a5000', '5000a10000', '10000mais'].includes(r.investimento)) tags.push('verba-baixa')
  return { rota: 'A', tags }
}

const OPTIONS = (id: string) => {
  const step = planejados.steps.find((s) => s.id === id)
  if (!step || step.type !== 'choice') throw new Error(`no choice step ${id}`)
  return step.options.map((o) => o.id)
}

describe('the "Móveis planejados" model', () => {
  it('decides every combination of answers like the original quiz', () => {
    let checked = 0
    for (const tipo of OPTIONS('tipo')) {
      for (const cargo of OPTIONS('cargo')) {
        const decisions = cargo === 'gerente' ? OPTIONS('decisao') : [undefined]
        for (const decisao of decisions) {
          for (const faturamento of OPTIONS('faturamento')) {
            for (const investimento of OPTIONS('investimento')) {
              for (const prazo of OPTIONS('prazo')) {
                const answers: QuizAnswers = { tipo, cargo, faturamento, investimento, prazo }
                if (decisao) answers.decisao = decisao
                const want = originalRule({ tipo, cargo, decisao, faturamento, investimento, prazo })
                const got = evaluate(planejados, answers)!
                expect(got.route, JSON.stringify(answers)).toBe(want.rota)
                expect([...got.tags].sort(), JSON.stringify(answers)).toEqual(
                  ['quiz-planejados', ...want.tags].sort(),
                )
                checked++
              }
            }
          }
        }
      }
    }
    // 5 tipos × (3 cargos + gerente × 3 decisões) × 6 × 5 × 4
    expect(checked).toBe(5 * 6 * 6 * 5 * 4)
  })

  it('asks who decides only to managers, and forgets the answer if they stop being one', () => {
    const ids = (a: QuizAnswers) => visibleSteps(planejados, a).map((s) => s.id)
    expect(ids({ cargo: 'dono' })).not.toContain('decisao')
    expect(ids({ cargo: 'gerente' })).toContain('decisao')
    // Answered as a manager, then went back and chose owner: the
    // "só o dono decide" answer must not tag this lead.
    const outcome = evaluate(planejados, {
      tipo: 'loja',
      cargo: 'dono',
      decisao: 'so_dono',
      faturamento: '75a150',
      investimento: '5000a10000',
      prazo: 'ja',
    })!
    expect(outcome.tags).not.toContain('prioridade-baixa')
    expect(outcome.tags).toContain('decisor:sim')
  })

  it('has the same screens as the original, in order', () => {
    expect(planejados.steps.map((s) => s.id)).toEqual([
      'nome',
      'tipo',
      'cargo',
      'decisao',
      'faturamento',
      'ticket',
      'origem',
      'desafio',
      'investimento',
      'prazo',
      'contato',
    ])
    expect(planejados.intro.headline).toBe('Sua loja vende por indicação ou porque tem um sistema?')
  })

  it('shows the manager the "bring the owner" line, and everyone else the other', () => {
    const a = planejados.results.find((r) => r.id === 'a')!
    const text = (answers: QuizAnswers) =>
      visibleBlocks(a, planejados, answers)
        .filter((b) => b.type === 'highlight')
        .map((b) => (b.type === 'highlight' ? b.text : ''))
    expect(text({ cargo: 'gerente' })).toHaveLength(1)
    expect(text({ cargo: 'gerente' })[0]).toContain('o ideal é que o dono participe')
    expect(text({ cargo: 'dono' })).toHaveLength(1)
    expect(text({ cargo: 'dono' })[0]).toContain('em instantes')
  })

  it('tells the warm lead what comes first, by the challenge they named', () => {
    const b = planejados.results.find((r) => r.id === 'b')!
    const first = (desafio: string) => {
      const block = visibleBlocks(b, planejados, { desafio })[0]
      return block.type === 'text' ? block.text : ''
    }
    expect(first('preco')).toBe(
      'Antes de investir em tráfego, vale ajustar o que vem primeiro: a forma como sua marca comunica valor.',
    )
    expect(first('poucos')).toContain('um posicionamento que faça a loja ser lembrada')
  })

  it('fires Lead only for the qualified result', () => {
    const pixel = Object.fromEntries(planejados.results.map((r) => [r.id, r.pixel]))
    expect(pixel.a).toEqual({ kind: 'standard', name: 'Lead' })
    expect(pixel.b).toEqual({ kind: 'custom', name: 'QuizMorno' })
    expect(pixel.c).toEqual({ kind: 'custom', name: 'QuizDesqualificado' })
  })

  it('reads the contact from the name and contact screens', () => {
    expect(
      contactFrom(planejados, {
        primeiro_nome: 'Ana',
        whatsapp: '+5563912345678',
        empresa: 'Planejados Silva',
        cidade: 'Palmas / TO',
        instagram: '@planejadossilva',
      }),
    ).toEqual({
      name: 'Ana',
      phone: '+5563912345678',
      company: 'Planejados Silva',
      city: 'Palmas / TO',
      instagram: '@planejadossilva',
    })
  })
})

describe('every built-in model', () => {
  it('is already clean: sanitizing it again changes nothing', () => {
    for (const model of QUIZ_MODELS) {
      expect(sanitizeDefinition(model.definition), model.key).toEqual(model.definition)
    }
  })

  it('can be published as it comes (the result links are the only reminder)', () => {
    for (const model of QUIZ_MODELS) {
      expect(checkDefinition(model.definition).errors, model.key).toEqual([])
    }
    const { warnings } = checkDefinition(planejados)
    expect(warnings.some((w) => w.includes('Quero meu Raio-X'))).toBe(true)
  })
})

describe('publicDefinition', () => {
  it('keeps the team\'s own words on the server', () => {
    const pub = publicDefinition(planejados)
    expect(pub.results.map((r) => r.name)).toEqual(['', '', ''])
    expect(pub.tagRules).toEqual([])
    expect(pub.settings.tags).toEqual([])
    expect(JSON.stringify(pub)).not.toContain('verba-baixa')
    // (The Pixel event names stay: the browser is what fires them.)
    expect(JSON.stringify(pub)).not.toContain('C · Desqualificado')
    // …and still decides the same result, so the page can show it at once.
    const answers = { tipo: 'arquiteto', cargo: 'dono', faturamento: '300mais', investimento: '10000mais', prazo: 'ja' }
    expect(evaluate(pub, answers)!.result.id).toBe(evaluate(planejados, answers)!.result.id)
  })
})

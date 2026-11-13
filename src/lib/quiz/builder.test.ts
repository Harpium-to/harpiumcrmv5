import { describe, expect, it } from 'vitest'

import {
  addResult,
  addRule,
  addStep,
  choicesBefore,
  duplicateResult,
  duplicateStep,
  moveItem,
  moveStep,
  newStep,
  removeOption,
  removeResult,
  removeStep,
  STEP_KINDS,
  stepKindLabel,
} from './builder'
import { findQuizModel } from './templates'
import { checkDefinition, sanitizeDefinition } from './validate'

const quiz = findQuizModel('moveis-planejados')!.definition
const ids = (def: typeof quiz) => def.steps.map((s) => s.id)

describe('screens', () => {
  it('offers a starting point for every kind, each one publishable as it comes', () => {
    for (const { kind } of STEP_KINDS) {
      const step = newStep(kind)
      const clean = sanitizeDefinition({ ...quiz, steps: [...quiz.steps, step] })
      expect(clean.steps[clean.steps.length - 1], kind).toEqual(step)
      expect(checkDefinition(clean).errors, kind).toEqual([])
    }
    expect(stepKindLabel(newStep('multi'))).toBe('Múltipla escolha')
    expect(stepKindLabel(newStep('phone'))).toBe('WhatsApp')
    expect(stepKindLabel(newStep('contact'))).toBe('Campos')
  })

  it('adds a screen after the one in focus, or at the end', () => {
    const after = addStep(quiz, 'message', 'tipo')
    expect(ids(after.def).indexOf(after.id)).toBe(ids(quiz).indexOf('tipo') + 1)
    const end = addStep(quiz, 'choice')
    expect(ids(end.def)[ids(end.def).length - 1]).toBe(end.id)
    // The original is untouched.
    expect(quiz.steps).toHaveLength(11)
  })

  it('removing a question removes what read its answer', () => {
    const def = removeStep(quiz, 'cargo')
    expect(ids(def)).not.toContain('cargo')
    // "decisao" only showed to managers: the condition is gone, so it shows to all.
    expect(def.steps.find((s) => s.id === 'decisao')!.showIf).toBeUndefined()
    // Rule B lost its "cargo" condition and kept the other two.
    expect(def.rules.find((r) => r.resultId === 'b')!.conditions.map((c) => c.stepId)).toEqual([
      'faturamento',
      'prazo',
    ])
    // Tag rules that only read "cargo" are left with no condition, so they never apply.
    expect(def.tagRules.find((t) => t.tag === 'decisor:sim')!.conditions).toEqual([])
    // The result blocks that depended on it now show to everyone.
    const highlights = def.results.find((r) => r.id === 'a')!.blocks.filter((b) => b.type === 'highlight')
    expect(highlights.every((b) => b.showIf === undefined)).toBe(true)
  })

  it('moving a question above the one it depends on drops the dependency', () => {
    const from = ids(quiz).indexOf('decisao')
    const to = ids(quiz).indexOf('tipo')
    const def = moveStep(quiz, from, to)
    expect(ids(def).indexOf('decisao')).toBeLessThan(ids(def).indexOf('cargo'))
    expect(def.steps.find((s) => s.id === 'decisao')!.showIf).toBeUndefined()
    // Moving it down keeps the condition.
    const down = moveStep(quiz, from, from + 2)
    expect(down.steps.find((s) => s.id === 'decisao')!.showIf).toHaveLength(1)
    expect(moveStep(quiz, 3, 99)).toBe(quiz)
  })

  it('copies a screen with ids of its own', () => {
    const copy = duplicateStep(quiz, 'contato')!
    const original = quiz.steps.find((s) => s.id === 'contato')!
    const made = copy.def.steps.find((s) => s.id === copy.id)!
    expect(made.label).toBe('Contato (cópia)')
    if (made.type !== 'fields' || original.type !== 'fields') throw new Error('fields expected')
    const all = [...original.fields, ...made.fields].map((f) => f.id)
    expect(new Set(all).size).toBe(all.length)
    expect(sanitizeDefinition(copy.def).steps).toHaveLength(12)
  })

  it('removing an option removes the conditions that named it', () => {
    const def = removeOption(quiz, 'faturamento', '50a75')
    const ruleB = def.rules.find((r) => r.resultId === 'b')!
    expect(ruleB.conditions.map((c) => c.stepId)).toEqual(['cargo', 'prazo'])
    const ruleC = def.rules.find((r) => r.resultId === 'c')!
    expect(ruleC.conditions.find((c) => c.stepId === 'faturamento')!.optionIds).toEqual(['ate30', '30a50'])
  })

  it('lists only the choice questions asked before a screen', () => {
    expect(choicesBefore(quiz, 'decisao').map((s) => s.id)).toEqual(['tipo', 'cargo'])
    expect(choicesBefore(quiz, 'nome')).toEqual([])
    expect(choicesBefore(quiz, 'nope')).toEqual([])
  })
})

describe('results', () => {
  it('removing a result removes the rules that led to it', () => {
    const def = removeResult(quiz, 'c')
    expect(def.results.map((r) => r.id)).toEqual(['a', 'b'])
    expect(def.rules.map((r) => r.resultId)).toEqual(['b'])
    expect(def.defaultResultId).toBe('a')
  })

  it('removing the default hands that place to another result', () => {
    const def = removeResult(quiz, 'a')
    expect(def.defaultResultId).toBe('c')
    // "verba-baixa" was only for result A: with A gone it applies to any result.
    expect(def.tagRules.find((t) => t.tag === 'verba-baixa')!.resultIds).toBeUndefined()
  })

  it('never removes the last result', () => {
    const one = removeResult(removeResult(quiz, 'a'), 'b')
    expect(one.results).toHaveLength(1)
    expect(removeResult(one, one.results[0].id)).toBe(one)
  })

  it('adds and copies results', () => {
    const added = addResult(quiz)
    expect(added.def.results).toHaveLength(4)
    const copy = duplicateResult(quiz, 'b')!
    const made = copy.def.results.find((r) => r.id === copy.id)!
    expect(made.name).toBe('B · Morno (cópia)')
    expect(made.blocks).toHaveLength(quiz.results[1].blocks.length)
    expect(made.blocks[0].id).not.toBe(quiz.results[1].blocks[0].id)
  })

  it('a new rule points at a result that is not the default', () => {
    const def = addRule(quiz)
    const rule = def.rules[def.rules.length - 1]
    expect(rule.resultId).not.toBe(def.defaultResultId)
    expect(rule.conditions).toEqual([])
  })
})

describe('moveItem', () => {
  it('moves one item and leaves the list alone when the move is impossible', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    const list = ['a', 'b']
    expect(moveItem(list, 0, 5)).toBe(list)
    expect(moveItem(list, 1, 1)).toBe(list)
  })
})

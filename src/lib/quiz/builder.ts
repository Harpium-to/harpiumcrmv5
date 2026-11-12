// ============================================================
// What the builder does to a quiz: add, remove, move and copy screens,
// results and rules.
//
// Every operation takes a definition and answers with a new one.
// Operations that change the structure finish with sanitizeDefinition,
// which is what keeps the quiz coherent: removing a question removes
// the conditions and rules that read it, and moving a question above
// the one it depends on drops that dependency.
//
// Text edits do not go through here (and are not sanitized on every
// keystroke — that would trim the space someone just typed).
//
// Pure — no I/O.
// ============================================================

import { FIELD_LABEL, blankResult, newId, sanitizeDefinition } from './validate'
import type {
  ChoiceStep,
  FieldKind,
  QuizDefinition,
  QuizField,
  QuizResult,
  QuizStep,
  ResultBlock,
} from './types'

// ------------------------------------------------------------
// Screens
// ------------------------------------------------------------

export const STEP_KINDS = [
  { kind: 'choice', label: 'Escolha única', hint: 'Um toque escolhe e avança' },
  { kind: 'multi', label: 'Múltipla escolha', hint: 'A pessoa pode marcar várias' },
  { kind: 'text', label: 'Texto curto', hint: 'Uma linha' },
  { kind: 'longtext', label: 'Texto longo', hint: 'Um parágrafo' },
  { kind: 'number', label: 'Número', hint: 'Quantidade, valor, idade' },
  { kind: 'name', label: 'Nome', hint: 'Vira o nome do contato e o {nome}' },
  { kind: 'phone', label: 'WhatsApp', hint: 'Com DDD; vira o telefone do contato' },
  { kind: 'email', label: 'E-mail', hint: 'Vira o e-mail do contato' },
  { kind: 'contact', label: 'Bloco de contato', hint: 'WhatsApp, empresa, cidade e Instagram' },
  { kind: 'message', label: 'Mensagem', hint: 'Uma tela só com texto e um botão' },
] as const
export type StepKind = (typeof STEP_KINDS)[number]['kind']

const FIELD_PLACEHOLDER: Partial<Record<FieldKind, string>> = {
  name: 'Seu nome',
  phone: '(11) 91234-5678',
  email: 'voce@email.com',
  company: 'Nome da empresa',
  city: 'Ex.: Palmas / TO',
  instagram: '@suaempresa',
}

export function newField(kind: FieldKind, required = true): QuizField {
  return {
    id: newId('f'),
    kind,
    label: FIELD_LABEL[kind],
    placeholder: FIELD_PLACEHOLDER[kind],
    required,
  }
}

export function newStep(kind: StepKind): QuizStep {
  const id = newId('s')
  switch (kind) {
    case 'choice':
    case 'multi':
      return {
        id,
        type: 'choice',
        label: 'Nova pergunta',
        title: 'Qual é a sua pergunta?',
        multiple: kind === 'multi' ? true : undefined,
        options: [
          { id: newId('o'), label: 'Primeira opção' },
          { id: newId('o'), label: 'Segunda opção' },
        ],
      }
    case 'message':
      return {
        id,
        type: 'message',
        label: 'Mensagem',
        title: 'Um recado antes de continuar',
        text: 'Escreva aqui o que a pessoa precisa saber.',
        cta: 'Continuar',
      }
    case 'contact':
      return {
        id,
        type: 'fields',
        label: 'Contato',
        title: 'Para onde enviamos o resultado?',
        cta: 'Ver meu resultado',
        fields: [
          newField('phone'),
          newField('company'),
          newField('city'),
          newField('instagram', false),
        ],
      }
    case 'name':
      return {
        id,
        type: 'fields',
        label: 'Nome',
        title: 'Como posso te chamar?',
        cta: 'Continuar',
        fields: [newField('name')],
      }
    case 'phone':
      return {
        id,
        type: 'fields',
        label: 'WhatsApp',
        title: 'Qual é o seu WhatsApp?',
        cta: 'Continuar',
        fields: [newField('phone')],
      }
    case 'email':
      return {
        id,
        type: 'fields',
        label: 'E-mail',
        title: 'Qual é o seu e-mail?',
        cta: 'Continuar',
        fields: [newField('email')],
      }
    default:
      return {
        id,
        type: 'fields',
        label: 'Nova pergunta',
        title: 'Qual é a sua pergunta?',
        cta: 'Continuar',
        fields: [{ ...newField(kind), label: 'Sua resposta' }],
      }
  }
}

/** What a screen is, in the builder's words. */
export function stepKindLabel(step: QuizStep): string {
  if (step.type === 'choice') return step.multiple ? 'Múltipla escolha' : 'Escolha única'
  if (step.type === 'message') return 'Mensagem'
  if (step.fields.length === 1) {
    const kind = step.fields[0].kind
    if (kind === 'text') return 'Texto curto'
    if (kind === 'longtext') return 'Texto longo'
    return FIELD_LABEL[kind]
  }
  return 'Campos'
}

/** Insert a new screen after `afterId` (or at the end). */
export function addStep(
  def: QuizDefinition,
  kind: StepKind,
  afterId?: string,
): { def: QuizDefinition; id: string } {
  const step = newStep(kind)
  const at = afterId ? def.steps.findIndex((s) => s.id === afterId) : -1
  const steps = [...def.steps]
  steps.splice(at === -1 ? steps.length : at + 1, 0, step)
  return { def: { ...def, steps }, id: step.id }
}

export function updateStep(
  def: QuizDefinition,
  id: string,
  change: (step: QuizStep) => QuizStep,
): QuizDefinition {
  return { ...def, steps: def.steps.map((s) => (s.id === id ? change(s) : s)) }
}

/** Remove a screen, and with it whatever read its answer. */
export function removeStep(def: QuizDefinition, id: string): QuizDefinition {
  return sanitizeDefinition({ ...def, steps: def.steps.filter((s) => s.id !== id) })
}

/**
 * Move a screen. A condition that would now read a question asked
 * later is dropped: a screen cannot depend on what comes after it.
 */
export function moveStep(def: QuizDefinition, from: number, to: number): QuizDefinition {
  if (from === to || from < 0 || to < 0 || from >= def.steps.length || to >= def.steps.length) {
    return def
  }
  const steps = [...def.steps]
  const [moved] = steps.splice(from, 1)
  steps.splice(to, 0, moved)
  return sanitizeDefinition({ ...def, steps })
}

/** A copy of a screen right after it. Its fields get ids of their own. */
export function duplicateStep(
  def: QuizDefinition,
  id: string,
): { def: QuizDefinition; id: string } | null {
  const at = def.steps.findIndex((s) => s.id === id)
  if (at === -1) return null
  const source = def.steps[at]
  const copy: QuizStep =
    source.type === 'fields'
      ? { ...source, id: newId('s'), fields: source.fields.map((f) => ({ ...f, id: newId('f') })) }
      : source.type === 'choice'
        ? { ...source, id: newId('s'), options: source.options.map((o) => ({ ...o })) }
        : { ...source, id: newId('s') }
  copy.label = `${source.label} (cópia)`.slice(0, 80)
  const steps = [...def.steps]
  steps.splice(at + 1, 0, copy)
  return { def: { ...def, steps }, id: copy.id }
}

/** Remove an option, and the conditions that named it. */
export function removeOption(def: QuizDefinition, stepId: string, optionId: string): QuizDefinition {
  return sanitizeDefinition(
    updateStep(def, stepId, (step) =>
      step.type === 'choice'
        ? { ...step, options: step.options.filter((o) => o.id !== optionId) }
        : step,
    ),
  )
}

/** The choice questions asked before a screen: what its condition may read. */
export function choicesBefore(def: QuizDefinition, stepId: string): ChoiceStep[] {
  const at = def.steps.findIndex((s) => s.id === stepId)
  return def.steps.slice(0, at === -1 ? 0 : at).filter((s): s is ChoiceStep => s.type === 'choice')
}

/** Every choice question: what a rule or a result block may read. */
export function allChoices(def: QuizDefinition): ChoiceStep[] {
  return def.steps.filter((s): s is ChoiceStep => s.type === 'choice')
}

// ------------------------------------------------------------
// Results
// ------------------------------------------------------------

export const ROUTE_LABEL = { A: 'Qualificado', B: 'Morno', C: 'Desqualificado' } as const

export function addResult(def: QuizDefinition): { def: QuizDefinition; id: string } {
  const result: QuizResult = { ...blankResult(), name: `Resultado ${def.results.length + 1}` }
  return { def: { ...def, results: [...def.results, result] }, id: result.id }
}

export function updateResult(
  def: QuizDefinition,
  id: string,
  change: (result: QuizResult) => QuizResult,
): QuizDefinition {
  return { ...def, results: def.results.map((r) => (r.id === id ? change(r) : r)) }
}

/**
 * Remove a result. The rules that led to it go with it, and if it was
 * the default, the last remaining result takes that place. A quiz
 * always keeps one result.
 */
export function removeResult(def: QuizDefinition, id: string): QuizDefinition {
  if (def.results.length <= 1) return def
  return sanitizeDefinition({ ...def, results: def.results.filter((r) => r.id !== id) })
}

export function duplicateResult(
  def: QuizDefinition,
  id: string,
): { def: QuizDefinition; id: string } | null {
  const at = def.results.findIndex((r) => r.id === id)
  if (at === -1) return null
  const source = def.results[at]
  const copy: QuizResult = {
    ...source,
    id: newId('r'),
    name: `${source.name} (cópia)`.slice(0, 80),
    blocks: source.blocks.map((b) => ({ ...b, id: newId('b') })),
  }
  const results = [...def.results]
  results.splice(at + 1, 0, copy)
  return { def: { ...def, results }, id: copy.id }
}

export const BLOCK_KINDS = [
  { type: 'text', label: 'Texto' },
  { type: 'bullets', label: 'Lista' },
  { type: 'highlight', label: 'Destaque' },
  { type: 'button', label: 'Botão' },
] as const

export function newBlock(type: ResultBlock['type']): ResultBlock {
  const id = newId('b')
  switch (type) {
    case 'bullets':
      return { id, type, items: ['Primeiro item', 'Segundo item'] }
    case 'highlight':
      return { id, type, icon: 'bulb', text: 'Um aviso que merece destaque.' }
    case 'button':
      return { id, type, label: 'Quero saber mais', kind: 'link', url: '' }
    default:
      return { id, type: 'text', text: 'Escreva aqui. Use **negrito** para destacar.' }
  }
}

/** Swap two neighbours of a list; out-of-range moves change nothing. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

// ------------------------------------------------------------
// Rules
// ------------------------------------------------------------

export function addRule(def: QuizDefinition): QuizDefinition {
  const target = def.results.find((r) => r.id !== def.defaultResultId) ?? def.results[0]
  return {
    ...def,
    rules: [...def.rules, { id: newId('g'), resultId: target.id, match: 'any', conditions: [] }],
  }
}

export function addTagRule(def: QuizDefinition): QuizDefinition {
  return {
    ...def,
    tagRules: [...def.tagRules, { id: newId('t'), tag: '', match: 'all', conditions: [] }],
  }
}

// ============================================================
// Playing a quiz: which screens show, which result a visit ends in,
// which tags it earns.
//
// Pure functions, run on both sides. The browser uses them to show the
// next screen and the result at once; the server runs them again on the
// answers it stored before writing the route and the tags to the CRM,
// so a result cannot be forged from the browser.
// ============================================================

import {
  INTRO_STEP,
  RESULT_STEP,
  type FieldKind,
  type QuizAnswer,
  type QuizAnswers,
  type QuizCondition,
  type QuizDefinition,
  type QuizField,
  type QuizResult,
  type QuizRoute,
  type QuizStep,
} from './types'

function chosen(answer: QuizAnswer | undefined): string[] {
  if (answer === undefined) return []
  return Array.isArray(answer) ? answer : [answer]
}

/** An unanswered question "is not" anything. */
export function conditionHolds(c: QuizCondition, answers: QuizAnswers): boolean {
  const hit = chosen(answers[c.stepId]).some((id) => c.optionIds.includes(id))
  return c.op === 'is' ? hit : !hit
}

/** A group with no condition never matches: an empty rule decides nothing. */
export function groupMatches(
  conditions: QuizCondition[],
  match: 'all' | 'any',
  answers: QuizAnswers,
): boolean {
  if (conditions.length === 0) return false
  return match === 'all'
    ? conditions.every((c) => conditionHolds(c, answers))
    : conditions.some((c) => conditionHolds(c, answers))
}

function shows(showIf: QuizCondition[] | undefined, answers: QuizAnswers): boolean {
  return !showIf || showIf.length === 0 || showIf.every((c) => conditionHolds(c, answers))
}

/** The ids a step stores its answers under: itself, or each of its fields. */
function answerKeys(step: QuizStep): string[] {
  if (step.type === 'choice') return [step.id]
  if (step.type === 'fields') return step.fields.map((f) => f.id)
  return []
}

/**
 * The steps this visitor sees, in order, and the answers that still
 * count. A step hidden by a condition takes its answer with it: someone
 * who answered "gerente", then went back and chose "dono", no longer
 * has an answer to the question only managers see.
 */
export function walk(
  def: QuizDefinition,
  answers: QuizAnswers,
): { steps: QuizStep[]; answers: QuizAnswers } {
  const kept: QuizAnswers = {}
  const steps: QuizStep[] = []
  for (const step of def.steps) {
    if (!shows(step.showIf, kept)) continue
    steps.push(step)
    for (const key of answerKeys(step)) {
      if (answers[key] !== undefined) kept[key] = answers[key]
    }
  }
  return { steps, answers: kept }
}

export function visibleSteps(def: QuizDefinition, answers: QuizAnswers): QuizStep[] {
  return walk(def, answers).steps
}

/** Every screen the report counts, in order. */
export function funnelScreens(def: QuizDefinition): string[] {
  return [
    ...(def.intro.enabled ? [INTRO_STEP] : []),
    ...def.steps.map((s) => s.id),
    RESULT_STEP,
  ]
}

export function findStep(def: QuizDefinition, id: string): QuizStep | undefined {
  return def.steps.find((s) => s.id === id)
}

/** The words of a choice answer ("De R$ 30 mil a R$ 50 mil"). */
export function answerLabel(step: QuizStep | undefined, answer: QuizAnswer | undefined): string {
  if (!step || step.type !== 'choice') return typeof answer === 'string' ? answer : ''
  return chosen(answer)
    .map((id) => step.options.find((o) => o.id === id)?.label ?? '')
    .filter(Boolean)
    .join(', ')
}

// ------------------------------------------------------------
// Contact
// ------------------------------------------------------------

export const CONTACT_KINDS = ['name', 'phone', 'email', 'company', 'city', 'instagram'] as const
export type ContactKind = (typeof CONTACT_KINDS)[number]
export type QuizContact = Partial<Record<ContactKind, string>>

function isContactKind(kind: FieldKind): kind is ContactKind {
  return (CONTACT_KINDS as readonly string[]).includes(kind)
}

/** The contact a visit left, from the first field of each kind it saw. */
export function contactFrom(def: QuizDefinition, answers: QuizAnswers): QuizContact {
  const seen = walk(def, answers)
  const contact: QuizContact = {}
  for (const step of seen.steps) {
    if (step.type !== 'fields') continue
    for (const field of step.fields) {
      const value = seen.answers[field.id]
      if (!isContactKind(field.kind) || contact[field.kind]) continue
      if (typeof value === 'string' && value.trim()) contact[field.kind] = value.trim()
    }
  }
  return contact
}

/** True once the visit has what the CRM needs to create a contact. */
export function hasContactKey(contact: QuizContact): boolean {
  return Boolean(contact.phone || contact.email)
}

// ------------------------------------------------------------
// Result
// ------------------------------------------------------------

export interface QuizOutcome {
  result: QuizResult
  route: QuizRoute
  /** The quiz's tags, the result's and the ones earned by the answers. */
  tags: string[]
  /** Why this result: the answers that matched the rule. */
  reasons: string[]
}

function uniq(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))]
}

export function evaluate(def: QuizDefinition, rawAnswers: QuizAnswers): QuizOutcome | null {
  const { answers } = walk(def, rawAnswers)
  const byId = new Map(def.results.map((r) => [r.id, r]))
  const rule = def.rules.find(
    (r) => byId.has(r.resultId) && groupMatches(r.conditions, r.match, answers),
  )
  const result = (rule ? byId.get(rule.resultId) : byId.get(def.defaultResultId)) ?? def.results[0]
  if (!result) return null

  const earned = def.tagRules
    .filter((t) => !t.resultIds?.length || t.resultIds.includes(result.id))
    .filter((t) => groupMatches(t.conditions, t.match, answers))
    .map((t) => t.tag)

  const reasons = rule
    ? rule.conditions
        .filter((c) => conditionHolds(c, answers))
        .map((c) => {
          const step = findStep(def, c.stepId)
          const said = answerLabel(step, answers[c.stepId])
          return step ? `${step.label}: ${said || 'sem resposta'}` : ''
        })
        .filter(Boolean)
    : []

  return {
    result,
    route: result.route,
    tags: uniq([...def.settings.tags, ...result.tags, ...earned]),
    reasons,
  }
}

/** The blocks of a result screen this visitor sees. */
export function visibleBlocks(result: QuizResult, def: QuizDefinition, rawAnswers: QuizAnswers) {
  const { answers } = walk(def, rawAnswers)
  return result.blocks.filter((b) => shows(b.showIf, answers))
}

// ------------------------------------------------------------
// Text
// ------------------------------------------------------------

/** "+5511912345678" → "(11) 91234-5678". Anything else comes back as typed. */
export function formatPhone(value: string): string {
  const d = value.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return value
}

export type QuizVars = Record<'nome' | 'empresa' | 'whatsapp' | 'email' | 'cidade', string>

export function varsFrom(contact: QuizContact): QuizVars {
  return {
    nome: (contact.name ?? '').trim().split(/\s+/)[0] ?? '',
    empresa: contact.company ?? '',
    whatsapp: contact.phone ? formatPhone(contact.phone) : '',
    email: contact.email ?? '',
    cidade: contact.city ?? '',
  }
}

/**
 * Fill `{nome}`, `{empresa}`… in a text. A variable with no value takes
 * the comma next to it along, so "Prazer, {nome}. O que…" reads
 * "Prazer. O que…" for someone who never gave a name.
 */
export function interpolate(text: string, vars: Partial<QuizVars>): string {
  let out = text
  let dropped = false
  for (const key of ['nome', 'empresa', 'whatsapp', 'email', 'cidade'] as const) {
    const value = (vars[key] ?? '').trim()
    const token = `{${key}}`
    if (!out.includes(token)) continue
    if (value) {
      out = out.split(token).join(value)
      continue
    }
    if (key === 'empresa') {
      out = out.split(token).join('sua empresa')
      continue
    }
    dropped = true
    out = out.split(`, ${token}`).join('').split(`${token}, `).join('').split(token).join('')
  }
  if (!dropped) return out
  // Only a text that lost a variable is tidied; the rest is the author's.
  out = out.replace(/ {2,}/g, ' ').replace(/ ([.,!?])/g, '$1').trim()
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : out
}

// ------------------------------------------------------------
// Fields
// ------------------------------------------------------------

const MAX_LENGTH: Record<FieldKind, number> = {
  name: 80,
  phone: 20,
  email: 160,
  company: 120,
  city: 120,
  instagram: 60,
  text: 200,
  longtext: 2000,
  number: 20,
}

/** Tidy what was typed into a field into what is stored. */
export function normalizeFieldValue(field: Pick<QuizField, 'kind'>, raw: string): string {
  const value = raw.trim().slice(0, MAX_LENGTH[field.kind])
  if (!value) return ''
  switch (field.kind) {
    case 'phone': {
      const digits = value.replace(/\D/g, '')
      if (!digits) return ''
      if (value.startsWith('+')) return `+${digits}`
      // A Brazilian number typed without the country code.
      return digits.length <= 11 ? `+55${digits}` : `+${digits}`
    }
    case 'instagram': {
      const handle = value
        .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
        .replace(/[/?].*$/, '')
        .replace(/^@+/, '')
        .trim()
      return handle ? `@${handle}` : ''
    }
    case 'email':
      return value.toLowerCase()
    case 'number':
      return value.replace(',', '.')
    case 'longtext':
      return value
    default:
      return value.replace(/\s+/g, ' ')
  }
}

/** What is wrong with a field's value, in words — or null. */
export function fieldError(field: QuizField, value: string): string | null {
  const v = value.trim()
  if (!v) return field.required ? requiredMessage(field.kind) : null
  switch (field.kind) {
    case 'name':
    case 'company':
      return v.length < 2 ? requiredMessage(field.kind) : null
    case 'phone': {
      const digits = v.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
      return digits.length < 10 ? 'Informe o WhatsApp com DDD.' : null
    }
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? null : 'Informe um e-mail válido.'
    case 'city':
      return v.length < 3 ? requiredMessage(field.kind) : null
    case 'number':
      return /^-?\d+([.,]\d+)?$/.test(v) ? null : 'Informe um número.'
    default:
      return null
  }
}

function requiredMessage(kind: FieldKind): string {
  switch (kind) {
    case 'name':
      return 'Informe o seu nome.'
    case 'phone':
      return 'Informe o WhatsApp com DDD.'
    case 'email':
      return 'Informe o seu e-mail.'
    case 'company':
      return 'Informe o nome da empresa.'
    case 'city':
      return 'Informe a cidade e o estado.'
    case 'instagram':
      return 'Informe o @ do Instagram.'
    case 'number':
      return 'Informe um número.'
    default:
      return 'Preencha este campo.'
  }
}

// ------------------------------------------------------------
// What goes to the CRM as questions and answers
// ------------------------------------------------------------

export interface QuizAnswerLine {
  /** The step or field id. */
  key: string
  question: string
  answer: string
}

/** Every answered question that is not a contact detail, in order. */
export function answerLines(def: QuizDefinition, rawAnswers: QuizAnswers): QuizAnswerLine[] {
  const seen = walk(def, rawAnswers)
  const lines: QuizAnswerLine[] = []
  for (const step of seen.steps) {
    if (step.type === 'choice') {
      const said = answerLabel(step, seen.answers[step.id])
      if (said) lines.push({ key: step.id, question: step.label, answer: said })
    } else if (step.type === 'fields') {
      for (const field of step.fields) {
        const value = seen.answers[field.id]
        if (isContactKind(field.kind) || typeof value !== 'string' || !value.trim()) continue
        lines.push({ key: field.id, question: field.label, answer: value.trim() })
      }
    }
  }
  return lines
}

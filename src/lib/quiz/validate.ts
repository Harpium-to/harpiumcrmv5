// ============================================================
// Reading a quiz definition that came from outside this code: the
// builder's save, an agency model, a row written by an older version.
//
//   sanitizeDefinition  always answers with a well-formed definition.
//                       Anything it does not understand is dropped,
//                       every text is cut to a limit, and a reference
//                       to a step or option that is not there is
//                       removed — so the player and the server never
//                       meet a half-broken quiz.
//   checkDefinition     what still stops a quiz from being published
//                       (errors) and what the author should know
//                       (warnings), in words.
//
// A draft may be saved in any state; only Publicar asks for no errors.
// ============================================================

import {
  FIELD_KINDS,
  INTRO_STEP,
  QUIZ_VERSION,
  RESULT_ICONS,
  RESULT_STEP,
  type ChoiceStep,
  type FieldKind,
  type QuizCondition,
  type QuizDefinition,
  type QuizField,
  type QuizOption,
  type QuizResult,
  type QuizRule,
  type QuizStep,
  type QuizTagRule,
  type ResultBlock,
  type ResultIcon,
} from './types'

export const LIMITS = {
  steps: 60,
  options: 20,
  fields: 12,
  results: 20,
  rules: 40,
  tagRules: 40,
  conditions: 12,
  blocks: 20,
  bullets: 12,
  tags: 20,
} as const

const ID = /^[a-zA-Z0-9_-]{1,40}$/
const HEX = /^#[0-9a-fA-F]{6}$/
export const DEFAULT_ACCENT = '#22ced2'

type Dict = Record<string, unknown>

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function optional(v: unknown, max: number): string | undefined {
  return text(v, max) || undefined
}

function list(v: unknown, max: number): unknown[] {
  return Array.isArray(v) ? v.slice(0, max) : []
}

/** A short random id for something the builder creates. */
export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  return `${prefix}_${rand}`
}

/** Keep a usable id, or make one; never repeat one already taken. */
function claimId(v: unknown, prefix: string, taken: Set<string>): string {
  let id = typeof v === 'string' && ID.test(v) && v !== INTRO_STEP && v !== RESULT_STEP ? v : ''
  while (!id || taken.has(id)) id = newId(prefix)
  taken.add(id)
  return id
}

/** Lowercase, no accents, hyphens: how the CRM writes tags. */
export function cleanTag(v: unknown): string {
  return text(v, 60)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function tags(v: unknown): string[] {
  return [...new Set(list(v, LIMITS.tags).map(cleanTag).filter(Boolean))]
}

/** Only an http(s) address, a WhatsApp number or an in-page anchor. */
export function cleanUrl(v: unknown): string {
  const url = text(v, 500)
  if (!url) return ''
  if (/^https?:\/\//i.test(url) || url.startsWith('#')) return url
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(url)) return `https://${url}`
  return ''
}

function httpsImage(v: unknown): string | undefined {
  const url = text(v, 500)
  return /^https:\/\//i.test(url) ? url : undefined
}

// ------------------------------------------------------------
// Steps
// ------------------------------------------------------------

function sanitizeOptions(v: unknown): QuizOption[] {
  const taken = new Set<string>()
  const out: QuizOption[] = []
  for (const item of list(v, LIMITS.options)) {
    if (!isDict(item)) continue
    const label = text(item.label, 160)
    if (!label) continue
    out.push({ id: claimId(item.id, 'o', taken), label })
  }
  return out
}

function sanitizeFields(v: unknown, taken: Set<string>): QuizField[] {
  const out: QuizField[] = []
  for (const item of list(v, LIMITS.fields)) {
    if (!isDict(item)) continue
    const kind = (FIELD_KINDS as readonly string[]).includes(String(item.kind))
      ? (item.kind as FieldKind)
      : 'text'
    out.push({
      id: claimId(item.id, 'f', taken),
      kind,
      label: text(item.label, 120) || FIELD_LABEL[kind],
      placeholder: optional(item.placeholder, 120),
      required: item.required !== false,
    })
  }
  return out
}

export const FIELD_LABEL: Record<FieldKind, string> = {
  name: 'Nome',
  phone: 'WhatsApp',
  email: 'E-mail',
  company: 'Nome da empresa',
  city: 'Cidade / UF',
  instagram: '@ do Instagram',
  text: 'Resposta',
  longtext: 'Resposta',
  number: 'Número',
}

function sanitizeSteps(v: unknown): QuizStep[] {
  const taken = new Set<string>()
  const out: QuizStep[] = []
  for (const item of list(v, LIMITS.steps)) {
    if (!isDict(item)) continue
    const title = text(item.title, 300)
    const base = {
      id: claimId(item.id, 's', taken),
      label: text(item.label, 80) || title.slice(0, 80) || 'Pergunta',
    }
    if (item.type === 'choice') {
      out.push({
        ...base,
        type: 'choice',
        title,
        context: optional(item.context, 400),
        note: optional(item.note, 300),
        multiple: item.multiple === true ? true : undefined,
        options: sanitizeOptions(item.options),
        showIf: item.showIf as QuizCondition[] | undefined,
      })
    } else if (item.type === 'fields') {
      out.push({
        ...base,
        type: 'fields',
        title,
        note: optional(item.note, 300),
        cta: text(item.cta, 60) || 'Continuar',
        fields: sanitizeFields(item.fields, taken),
        showIf: item.showIf as QuizCondition[] | undefined,
      })
    } else if (item.type === 'message') {
      out.push({
        ...base,
        type: 'message',
        title,
        text: optional(item.text, 1200),
        cta: text(item.cta, 60) || 'Continuar',
        showIf: item.showIf as QuizCondition[] | undefined,
      })
    }
  }
  return out
}

// ------------------------------------------------------------
// Conditions — checked against the steps that exist
// ------------------------------------------------------------

type ChoiceIndex = Map<string, { step: ChoiceStep; position: number }>

function indexChoices(steps: QuizStep[]): ChoiceIndex {
  const index: ChoiceIndex = new Map()
  steps.forEach((step, position) => {
    if (step.type === 'choice') index.set(step.id, { step, position })
  })
  return index
}

/**
 * Keep the conditions that point at a real choice step and real
 * options. `before` restricts them to steps earlier than that
 * position: a screen cannot depend on a question asked after it.
 */
function sanitizeConditions(v: unknown, choices: ChoiceIndex, before?: number): QuizCondition[] {
  const out: QuizCondition[] = []
  for (const item of list(v, LIMITS.conditions)) {
    if (!isDict(item) || typeof item.stepId !== 'string') continue
    const target = choices.get(item.stepId)
    if (!target) continue
    if (before !== undefined && target.position >= before) continue
    const valid = new Set(target.step.options.map((o) => o.id))
    const optionIds = [
      ...new Set(list(item.optionIds, LIMITS.options).filter((id): id is string => typeof id === 'string' && valid.has(id))),
    ]
    if (optionIds.length === 0) continue
    out.push({ stepId: item.stepId, op: item.op === 'is_not' ? 'is_not' : 'is', optionIds })
  }
  return out
}

function showIf(v: unknown, choices: ChoiceIndex, before?: number): QuizCondition[] | undefined {
  const conditions = sanitizeConditions(v, choices, before)
  return conditions.length ? conditions : undefined
}

// ------------------------------------------------------------
// Results
// ------------------------------------------------------------

function icon(v: unknown): ResultIcon {
  return (RESULT_ICONS as readonly string[]).includes(String(v)) ? (v as ResultIcon) : 'check'
}

function sanitizeBlocks(v: unknown, choices: ChoiceIndex): ResultBlock[] {
  const taken = new Set<string>()
  const out: ResultBlock[] = []
  for (const item of list(v, LIMITS.blocks)) {
    if (!isDict(item)) continue
    const base = { id: claimId(item.id, 'b', taken), showIf: showIf(item.showIf, choices) }
    if (item.type === 'text') {
      const value = text(item.text, 1500)
      if (value) out.push({ ...base, type: 'text', text: value })
    } else if (item.type === 'bullets') {
      const items = list(item.items, LIMITS.bullets).map((i) => text(i, 300)).filter(Boolean)
      if (items.length) out.push({ ...base, type: 'bullets', items })
    } else if (item.type === 'highlight') {
      const value = text(item.text, 800)
      if (value) out.push({ ...base, type: 'highlight', icon: icon(item.icon), text: value })
    } else if (item.type === 'button') {
      const label = text(item.label, 80)
      const kind = item.kind === 'whatsapp' ? 'whatsapp' : 'link'
      const url =
        kind === 'whatsapp' ? text(item.url, 20).replace(/\D/g, '') : cleanUrl(item.url)
      if (label) out.push({ ...base, type: 'button', label, kind, url })
    }
  }
  return out
}

function sanitizeResults(v: unknown, choices: ChoiceIndex): QuizResult[] {
  const taken = new Set<string>()
  const out: QuizResult[] = []
  for (const item of list(v, LIMITS.results)) {
    if (!isDict(item)) continue
    const pixel = isDict(item.pixel) ? item.pixel : {}
    const kind = pixel.kind === 'standard' || pixel.kind === 'custom' ? pixel.kind : 'none'
    const pixelName = text(pixel.name, 40).replace(/[^A-Za-z0-9_]/g, '')
    out.push({
      id: claimId(item.id, 'r', taken),
      name: text(item.name, 80) || 'Resultado',
      route: item.route === 'A' || item.route === 'C' ? item.route : 'B',
      tags: tags(item.tags),
      pixel: kind !== 'none' && pixelName ? { kind, name: pixelName } : { kind: 'none', name: '' },
      icon: icon(item.icon),
      title: text(item.title, 300),
      blocks: sanitizeBlocks(item.blocks, choices),
    })
  }
  return out
}

function sanitizeRules(v: unknown, choices: ChoiceIndex, resultIds: Set<string>): QuizRule[] {
  const taken = new Set<string>()
  const out: QuizRule[] = []
  for (const item of list(v, LIMITS.rules)) {
    if (!isDict(item) || typeof item.resultId !== 'string' || !resultIds.has(item.resultId)) continue
    out.push({
      id: claimId(item.id, 'g', taken),
      resultId: item.resultId,
      match: item.match === 'all' ? 'all' : 'any',
      conditions: sanitizeConditions(item.conditions, choices),
    })
  }
  return out
}

function sanitizeTagRules(v: unknown, choices: ChoiceIndex, resultIds: Set<string>): QuizTagRule[] {
  const taken = new Set<string>()
  const out: QuizTagRule[] = []
  for (const item of list(v, LIMITS.tagRules)) {
    if (!isDict(item)) continue
    const tag = cleanTag(item.tag)
    if (!tag) continue
    const only = list(item.resultIds, LIMITS.results).filter(
      (id): id is string => typeof id === 'string' && resultIds.has(id),
    )
    out.push({
      id: claimId(item.id, 't', taken),
      tag,
      match: item.match === 'any' ? 'any' : 'all',
      conditions: sanitizeConditions(item.conditions, choices),
      resultIds: only.length ? only : undefined,
    })
  }
  return out
}

// ------------------------------------------------------------
// The whole definition
// ------------------------------------------------------------

export function sanitizeDefinition(value: unknown): QuizDefinition {
  const v = isDict(value) ? value : {}
  const intro = isDict(v.intro) ? v.intro : {}
  const appearance = isDict(v.appearance) ? v.appearance : {}
  const settings = isDict(v.settings) ? v.settings : {}

  const steps = sanitizeSteps(v.steps)
  const choices = indexChoices(steps)
  // A step may only depend on the questions before it.
  steps.forEach((step, position) => {
    step.showIf = showIf(step.showIf, choices, position)
  })

  let results = sanitizeResults(v.results, choices)
  if (results.length === 0) results = [blankResult()]
  const resultIds = new Set(results.map((r) => r.id))
  const defaultResultId =
    typeof v.defaultResultId === 'string' && resultIds.has(v.defaultResultId)
      ? v.defaultResultId
      : results[results.length - 1].id

  const pixelId = text(settings.pixelId, 30).replace(/\D/g, '')

  return {
    version: QUIZ_VERSION,
    intro: {
      enabled: intro.enabled !== false,
      tag: optional(intro.tag, 80),
      headline: text(intro.headline, 200),
      sub: optional(intro.sub, 400),
      cta: text(intro.cta, 60) || 'Começar',
      bullets: list(intro.bullets, 6)
        .filter(isDict)
        .map((b) => ({ strong: text(b.strong, 160), text: text(b.text, 200) }))
        .filter((b) => b.strong || b.text),
    },
    steps,
    results,
    rules: sanitizeRules(v.rules, choices, resultIds),
    defaultResultId,
    tagRules: sanitizeTagRules(v.tagRules, choices, resultIds),
    appearance: {
      brandName: optional(appearance.brandName, 60),
      logoUrl: httpsImage(appearance.logoUrl),
      accent: HEX.test(String(appearance.accent)) ? String(appearance.accent).toLowerCase() : DEFAULT_ACCENT,
    },
    settings: {
      tags: tags(settings.tags),
      pixelId: pixelId || undefined,
      submittingText: optional(settings.submittingText, 80),
      privacyNote: optional(settings.privacyNote, 200),
      consentText: optional(settings.consentText, 300),
      privacyUrl: cleanUrl(settings.privacyUrl) || undefined,
      partialLead: settings.partialLead === true ? true : undefined,
    },
  }
}

export function blankResult(): QuizResult {
  return {
    id: newId('r'),
    name: 'Obrigado',
    route: 'B',
    tags: [],
    pixel: { kind: 'standard', name: 'Lead' },
    icon: 'check',
    title: 'Recebemos suas respostas, {nome}.',
    blocks: [
      { id: newId('b'), type: 'text', text: 'Nossa equipe vai falar com você em breve.' },
    ],
  }
}

// ------------------------------------------------------------
// Ready to publish?
// ------------------------------------------------------------

export interface DefinitionCheck {
  errors: string[]
  warnings: string[]
}

export function checkDefinition(def: QuizDefinition): DefinitionCheck {
  const errors: string[] = []
  const warnings: string[] = []

  if (def.intro.enabled && !def.intro.headline) {
    errors.push('A tela de entrada está sem título.')
  }
  if (def.steps.length === 0) errors.push('Adicione pelo menos uma pergunta.')

  let hasContact = false
  def.steps.forEach((step, i) => {
    const where = `Pergunta ${i + 1}`
    if (!step.title) errors.push(`${where} está sem título.`)
    if (step.type === 'choice' && step.options.length < 2) {
      errors.push(`${where} ("${step.label}") precisa de pelo menos duas opções.`)
    }
    if (step.type === 'fields') {
      if (step.fields.length === 0) errors.push(`${where} ("${step.label}") está sem campos.`)
      if (step.fields.some((f) => f.kind === 'phone' || f.kind === 'email')) hasContact = true
    }
  })
  if (!hasContact) {
    errors.push(
      'Inclua um campo de WhatsApp ou de e-mail. Sem um dos dois o CRM não consegue criar o contato.',
    )
  }

  for (const result of def.results) {
    if (!result.title) errors.push(`O resultado "${result.name}" está sem título.`)
    for (const block of result.blocks) {
      if (block.type === 'button' && !block.url) {
        warnings.push(`O botão "${block.label}" do resultado "${result.name}" está sem link.`)
      }
    }
  }
  const used = new Set([def.defaultResultId, ...def.rules.map((r) => r.resultId)])
  for (const result of def.results) {
    if (!used.has(result.id)) {
      warnings.push(`Nenhuma regra leva ao resultado "${result.name}".`)
    }
  }
  def.rules.forEach((rule, i) => {
    if (rule.conditions.length === 0) warnings.push(`A regra ${i + 1} não tem condição e nunca vale.`)
  })
  if (!def.settings.pixelId && def.results.some((r) => r.pixel.kind !== 'none')) {
    warnings.push('Sem o ID do Pixel, nenhum evento é enviado para a Meta.')
  }

  return { errors, warnings }
}

// ============================================================
// Pieces every built-in quiz model repeats: the conditions, the name
// screen, the contact screen, the Pixel events and the WhatsApp
// button.
//
// The models are written as plain objects and go through
// sanitizeDefinition (templates.ts), so a slip here becomes a dropped
// field, never a quiz the player cannot run. The tests in
// models.test.ts check that each one comes out intact.
// ============================================================

import type { FieldKind, QuizCondition, QuizOption } from '../types'

export const is = (stepId: string, ...optionIds: string[]): QuizCondition => ({
  stepId,
  op: 'is',
  optionIds,
})

export const isNot = (stepId: string, ...optionIds: string[]): QuizCondition => ({
  stepId,
  op: 'is_not',
  optionIds,
})

export const options = (pairs: [string, string][]): QuizOption[] =>
  pairs.map(([id, label]) => ({ id, label }))

/** The first screen of most models: the first name, for {nome}. */
export function nameStep(title = 'Antes de começar: como posso te chamar?') {
  return {
    id: 'nome',
    type: 'fields',
    label: 'Nome',
    title,
    cta: 'Continuar',
    fields: [
      {
        id: 'primeiro_nome',
        kind: 'name',
        label: 'Primeiro nome',
        placeholder: 'Seu primeiro nome',
        required: true,
      },
    ],
  }
}

interface ContactField {
  id: string
  kind: FieldKind
  label: string
  placeholder?: string
  required: boolean
}

export const WHATSAPP: ContactField = {
  id: 'whatsapp',
  kind: 'phone',
  label: 'WhatsApp',
  placeholder: '(11) 91234-5678',
  required: true,
}

export const EMAIL_OPTIONAL: ContactField = {
  id: 'email',
  kind: 'email',
  label: 'E-mail',
  placeholder: 'voce@email.com',
  required: false,
}

export const CITY: ContactField = {
  id: 'cidade',
  kind: 'city',
  label: 'Cidade / UF',
  placeholder: 'Ex.: Palmas / TO',
  required: true,
}

export const COMPANY: ContactField = {
  id: 'empresa',
  kind: 'company',
  label: 'Nome da empresa',
  placeholder: 'Ex.: Silva & Filhos',
  required: true,
}

/** The last screen: where the person leaves a way to be reached. */
export function contactStep(title: string, cta: string, fields: ContactField[] = [WHATSAPP]) {
  return { id: 'contato', type: 'fields', label: 'Contato', title, cta, fields }
}

/** Meta's standard event: the one a campaign optimises for. Only qualified leads. */
export const PIXEL_LEAD = { kind: 'standard', name: 'Lead' }
/** Custom events, for remarketing and exclusion audiences. */
export const PIXEL_WARM = { kind: 'custom', name: 'QuizMorno' }
export const PIXEL_COLD = { kind: 'custom', name: 'QuizFrio' }
export const PIXEL_NONE = { kind: 'none', name: '' }

/** A WhatsApp button with no number yet: the builder reminds the client to fill it. */
export function whatsappButton(id: string, label = 'Falar agora no WhatsApp') {
  return { id, type: 'button', label, kind: 'whatsapp', url: '' }
}

/** One tag per answer: `tagPerOption('area', 'area', [['trabalhista', 'trabalhista'], …])`. */
export function tagPerOption(stepId: string, prefix: string, pairs: [string, string][]) {
  return pairs.map(([optionId, tag]) => ({
    id: `tag_${stepId}_${optionId}`.slice(0, 40),
    tag: `${prefix}:${tag}`,
    match: 'all',
    conditions: [is(stepId, optionId)],
  }))
}

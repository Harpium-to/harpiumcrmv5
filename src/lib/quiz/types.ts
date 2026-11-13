// ============================================================
// The shape of a quiz (migration 072, quizzes.draft / .published).
//
// A quiz is data, not code: the screens, the "show only if" conditions,
// the result screens and the rule that leads to each one all live in
// this definition. The builder edits it, the public page plays it and
// the server re-reads it to decide the result of a visit.
//
// Pure types — safe to import from client and server.
// ============================================================

export const QUIZ_VERSION = 1

/** "The answer to <stepId> is / is not one of <optionIds>". */
export interface QuizCondition {
  stepId: string
  op: 'is' | 'is_not'
  optionIds: string[]
}

export interface QuizOption {
  id: string
  label: string
}

interface StepBase {
  id: string
  /** Short name for the CRM, the report and the CSV ("Faturamento mensal"). */
  label: string
  /** Shown only when every condition holds. */
  showIf?: QuizCondition[]
}

/** One question, one tap (or several, with `multiple`). */
export interface ChoiceStep extends StepBase {
  type: 'choice'
  title: string
  context?: string
  note?: string
  multiple?: boolean
  options: QuizOption[]
}

export const FIELD_KINDS = [
  'name',
  'phone',
  'email',
  'company',
  'city',
  'instagram',
  'text',
  'longtext',
  'number',
] as const
export type FieldKind = (typeof FIELD_KINDS)[number]

export interface QuizField {
  id: string
  kind: FieldKind
  label: string
  placeholder?: string
  required: boolean
}

/** A screen of typed fields: a name, a contact block, an open question. */
export interface FieldsStep extends StepBase {
  type: 'fields'
  title: string
  note?: string
  /** Button text. */
  cta: string
  fields: QuizField[]
}

/** A screen that only says something. */
export interface MessageStep extends StepBase {
  type: 'message'
  title: string
  text?: string
  cta: string
}

export type QuizStep = ChoiceStep | FieldsStep | MessageStep

export const RESULT_ICONS = ['check', 'bulb', 'gift', 'message'] as const
export type ResultIcon = (typeof RESULT_ICONS)[number]

interface BlockBase {
  id: string
  showIf?: QuizCondition[]
}

/** The pieces of a result screen, top to bottom. `**x**` is bold. */
export type ResultBlock =
  | (BlockBase & { type: 'text'; text: string })
  | (BlockBase & { type: 'bullets'; items: string[] })
  | (BlockBase & { type: 'highlight'; icon: ResultIcon; text: string })
  | (BlockBase & { type: 'button'; label: string; kind: 'link' | 'whatsapp'; url: string })

export type QuizRoute = 'A' | 'B' | 'C'

export interface QuizResult {
  id: string
  /** Internal name ("Qualificado"). */
  name: string
  /** A qualified, B warm, C not a fit — the route the CRM already knows. */
  route: QuizRoute
  tags: string[]
  /** Meta Pixel event fired when this result shows. */
  pixel: { kind: 'standard' | 'custom' | 'none'; name: string }
  icon: ResultIcon
  title: string
  blocks: ResultBlock[]
}

/** Read top to bottom; the first rule that matches decides the result. */
export interface QuizRule {
  id: string
  resultId: string
  match: 'all' | 'any'
  conditions: QuizCondition[]
}

/** An extra tag for the CRM when the conditions hold. */
export interface QuizTagRule {
  id: string
  tag: string
  match: 'all' | 'any'
  conditions: QuizCondition[]
  /** Only when the visit ended in one of these results. */
  resultIds?: string[]
}

export interface QuizIntro {
  enabled: boolean
  tag?: string
  headline: string
  sub?: string
  cta: string
  bullets: { strong: string; text: string }[]
}

export interface QuizAppearance {
  /** Shown in the header when there is no logo. */
  brandName?: string
  logoUrl?: string
  /** Hex, e.g. #22ced2. */
  accent: string
}

export interface QuizSettings {
  /** Applied to every lead of this quiz. */
  tags: string[]
  pixelId?: string
  /** Shown while the result is being prepared. */
  submittingText?: string
  /** Small print under the last form ("Seus dados ficam só com…"). */
  privacyNote?: string
  /** Consent line above the last button; with a link when `privacyUrl` is set. */
  consentText?: string
  privacyUrl?: string
  /** Send a lead for who left a contact and stopped (after 30 minutes). */
  partialLead?: boolean
}

export interface QuizDefinition {
  version: typeof QUIZ_VERSION
  intro: QuizIntro
  steps: QuizStep[]
  results: QuizResult[]
  rules: QuizRule[]
  /** The result of a visit no rule matched. */
  defaultResultId: string
  tagRules: QuizTagRule[]
  appearance: QuizAppearance
  settings: QuizSettings
}

/** A choice answer is an option id (or several); a field answer is text. */
export type QuizAnswer = string | string[]
export type QuizAnswers = Record<string, QuizAnswer>

export type QuizStatus = 'draft' | 'published' | 'paused'

/** Screen ids the report counts besides the steps themselves. */
export const INTRO_STEP = 'intro'
export const RESULT_STEP = 'result'

import type { AutomationTriggerType } from '@/types'
import { validateInteractivePayload } from '@/lib/whatsapp/interactive'

// ------------------------------------------------------------
// Pre-flight config validation for automations about to be activated.
//
// Activating a broken automation (e.g. an add_tag step with tag_id="")
// used to succeed silently — every trigger then produced a failed log
// row with a cryptic "Adicionar etiqueta precisa do contato e da etiqueta" message, and
// users often didn't notice until reviewing logs. This module lets
// the API refuse activation with a useful 400 response instead.
//
// The rules here mirror the runtime checks in engine.ts's runStep;
// they're the same invariants, enforced one step earlier so failures
// surface at save time.
// ------------------------------------------------------------

export interface ValidationIssue {
  /** Dot-path for the UI to highlight; stable enough to build a table. */
  path: string
  message: string
}

interface StepLike {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: StepLike[]; no?: StepLike[] }
}

export function validateStepsForActivation(
  steps: StepLike[],
  triggerType?: AutomationTriggerType | string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!Array.isArray(steps) || steps.length === 0) {
    issues.push({
      path: 'steps',
      message: 'uma automação ativa precisa de pelo menos um passo',
    })
    return issues
  }
  walk(steps, '', issues)
  if (triggerType === 'manual') issues.push(...validateSequenceSteps(steps))
  return issues
}

// ------------------------------------------------------------
// Sequences: automations with the `manual` trigger, started one at a
// time on one contact — from the Chrome extension, beside the chat
// (Fase 4B, step 5, of docs/plano-extensao-chrome.md).
//
// A sequence is a straight line of messages, waits and actions: no
// conditions. And it never sends two messages back to back: between
// any two, a wait of at least SEQUENCE_MIN_GAP_MINUTES. Automatic
// sending in quick succession is what gets a QR-code number banned.
// ------------------------------------------------------------

export const SEQUENCE_MIN_GAP_MINUTES = 1

/** The steps that send something to the customer. */
export const SEND_STEP_TYPES = ['send_message', 'send_buttons', 'send_list', 'send_template']

/** A wait step's length in minutes; 0 when it isn't a valid wait. */
export function waitMinutes(config: unknown): number {
  const c = (config ?? {}) as { amount?: unknown; unit?: unknown }
  const amount = typeof c.amount === 'number' && Number.isFinite(c.amount) ? c.amount : 0
  if (amount <= 0) return 0
  const unit = c.unit === 'days' ? 1440 : c.unit === 'hours' ? 60 : c.unit === 'minutes' ? 1 : 0
  return amount * unit
}

export function validateSequenceSteps(steps: StepLike[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  let sentBefore = false
  let gap = 0
  steps.forEach((step, i) => {
    const path = `steps[${i}]`
    if (step.step_type === 'condition') {
      issues.push({
        path,
        message: 'uma sequência não tem condições: só mensagens, esperas e ações',
      })
    } else if (step.step_type === 'wait') {
      gap += waitMinutes(step.step_config)
    } else if (SEND_STEP_TYPES.includes(step.step_type)) {
      if (sentBefore && gap < SEQUENCE_MIN_GAP_MINUTES) {
        issues.push({
          path,
          message: `entre duas mensagens de uma sequência, espere pelo menos ${SEQUENCE_MIN_GAP_MINUTES} minuto`,
        })
      }
      sentBefore = true
      gap = 0
    }
  })
  if (!sentBefore) {
    issues.push({ path: 'steps', message: 'uma sequência precisa de pelo menos uma mensagem' })
  }
  return issues
}

function walk(steps: StepLike[], prefix: string, issues: ValidationIssue[]): void {
  steps.forEach((s, i) => {
    const path = `${prefix}steps[${i}]`
    validateOne(s, path, issues)
    if (s.step_type === 'condition' && s.branches) {
      if (s.branches.yes) walk(s.branches.yes, `${path}.yes.`, issues)
      if (s.branches.no) walk(s.branches.no, `${path}.no.`, issues)
    }
  })
}

function validateOne(step: StepLike, path: string, issues: ValidationIssue[]): void {
  const c = step.step_config ?? {}
  switch (step.step_type) {
    case 'send_message':
      if (!nonEmpty(c.text)) {
        issues.push({ path: `${path}.text`, message: 'informe o texto da mensagem' })
      }
      break
    case 'send_buttons':
    case 'send_list': {
      // The whole step_config IS the interactive payload; validate it
      // against Meta's limits (same check the engine runs before send).
      const result = validateInteractivePayload(c)
      if (!result.ok) {
        issues.push({ path: `${path}.interactive`, message: result.error })
      }
      break
    }
    case 'send_template':
      if (!nonEmpty(c.template_name)) {
        issues.push({ path: `${path}.template_name`, message: 'informe o nome do modelo' })
      }
      break
    case 'add_tag':
    case 'remove_tag':
      if (!nonEmpty(c.tag_id)) {
        issues.push({ path: `${path}.tag_id`, message: 'informe a etiqueta' })
      }
      break
    case 'assign_conversation':
      if (c.mode === 'specific' && !nonEmpty(c.agent_id)) {
        issues.push({
          path: `${path}.agent_id`,
          message: 'informe o atendente quando o modo for "específico"',
        })
      }
      break
    case 'update_contact_field':
      if (!nonEmpty(c.field)) {
        issues.push({ path: `${path}.field`, message: 'informe o nome do campo' })
      }
      if (c.value === undefined || c.value === null || c.value === '') {
        issues.push({ path: `${path}.value`, message: 'informe o valor do campo' })
      }
      break
    case 'create_deal':
      if (!nonEmpty(c.pipeline_id)) {
        issues.push({ path: `${path}.pipeline_id`, message: 'informe o funil' })
      }
      if (!nonEmpty(c.stage_id)) {
        issues.push({ path: `${path}.stage_id`, message: 'informe a etapa' })
      }
      if (!nonEmpty(c.title)) {
        issues.push({ path: `${path}.title`, message: 'informe o título' })
      }
      break
    case 'wait':
      if (typeof c.amount !== 'number' || !Number.isFinite(c.amount) || c.amount <= 0) {
        issues.push({ path: `${path}.amount`, message: 'o tempo de espera precisa ser maior que 0' })
      }
      if (!['minutes', 'hours', 'days'].includes(String(c.unit))) {
        issues.push({
          path: `${path}.unit`,
          message: 'a unidade de espera precisa ser minutos, horas ou dias',
        })
      }
      break
    case 'condition':
      if (!nonEmpty(c.subject)) {
        issues.push({ path: `${path}.subject`, message: 'informe o assunto da condição' })
      }
      if (!nonEmpty(c.operand)) {
        issues.push({ path: `${path}.operand`, message: 'informe o valor da condição' })
      }
      break
    case 'send_webhook':
      if (!nonEmpty(c.url)) {
        issues.push({ path: `${path}.url`, message: 'informe a URL do webhook' })
        break
      }
      try {
        const u = new URL(String(c.url))
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          issues.push({
            path: `${path}.url`,
            message: 'a URL do webhook precisa usar http ou https',
          })
        }
      } catch {
        issues.push({ path: `${path}.url`, message: 'a URL do webhook não é válida' })
      }
      break
    case 'close_conversation':
      // No config required.
      break
    default:
      issues.push({ path, message: `tipo de passo desconhecido: ${step.step_type}` })
  }
}

export function validateTriggerForActivation(
  triggerType: AutomationTriggerType | string,
  triggerConfig: unknown,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const cfg = (triggerConfig ?? {}) as Record<string, unknown>

  if (triggerType === 'keyword_match') {
    const k = cfg.keywords
    if (!Array.isArray(k) || k.length === 0) {
      issues.push({ path: 'trigger.keywords', message: 'informe pelo menos uma palavra-chave' })
    } else if (k.some((v) => typeof v !== 'string' || v.trim() === '')) {
      issues.push({ path: 'trigger.keywords', message: 'as palavras-chave não podem ficar vazias' })
    }
    // A missing match_type defaults to "contains" at runtime (see
    // automations/engine.ts and flows/engine.ts, which both read
    // `match_type ?? "contains"`), so only an explicit, unrecognised
    // value is invalid here. This keeps activation validation in step
    // with the engine and with the builder's "Contains" default — an
    // automation that shows the default in the UI must not be rejected.
    if (cfg.match_type != null && cfg.match_type !== 'exact' && cfg.match_type !== 'contains') {
      issues.push({
        path: 'trigger.match_type',
        message: 'o tipo de correspondência precisa ser "exata" ou "contém"',
      })
    }
  } else if (triggerType === 'time_based') {
    if (!nonEmpty(cfg.schedule)) {
      issues.push({ path: 'trigger.schedule', message: 'informe o horário' })
    }
  } else if (triggerType === 'tag_added') {
    if (!nonEmpty(cfg.tag_id)) {
      issues.push({ path: 'trigger.tag_id', message: 'informe a etiqueta' })
    }
  } else if (triggerType === 'interactive_reply') {
    const ids = cfg.reply_ids
    if (!Array.isArray(ids) || ids.length === 0) {
      issues.push({
        path: 'trigger.reply_ids',
        message: 'informe pelo menos um ID de resposta',
      })
    } else if (ids.some((v) => typeof v !== 'string' || v.trim() === '')) {
      issues.push({
        path: 'trigger.reply_ids',
        message: 'os IDs de resposta não podem ficar vazios',
      })
    }
  }

  return issues
}

function nonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

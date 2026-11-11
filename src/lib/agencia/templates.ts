// ============================================================
// Niche templates (migration 053) — pure, unit-testable, no I/O.
//
// The content a template carries and the rules it must follow to apply
// cleanly to any CRM. The SQL side (apply_crm_template_content) trusts
// this shape; the editor in /agencia/modelos runs every save through
// parseTemplateContent first.
//
// Steps refer to tags and funnels BY NAME; ids are resolved when the
// template is applied. Only steps and triggers that can travel between
// CRMs are allowed — nothing that points at a person, a Meta template,
// a webhook or a custom field by id.
// ============================================================

export interface TemplateStage {
  name: string
  color?: string
}
export interface TemplatePipeline {
  name: string
  stages: TemplateStage[]
}
export interface TemplateTag {
  name: string
  color?: string
}
export interface TemplateField {
  name: string
  type?: string
  options?: string[]
}
export interface TemplateQuickReply {
  title: string
  text: string
}
export interface TemplateStep {
  type: TemplateStepType
  config: Record<string, unknown>
}
export interface TemplateAutomation {
  name: string
  description?: string
  trigger: TemplateTrigger
  trigger_config?: Record<string, unknown>
  steps: TemplateStep[]
}
/** One stretch of an agenda's opening hours (migration 067). */
export interface TemplateCalendarHours {
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  weekday: number
  /** "HH:MM" */
  starts: string
  ends: string
}
/**
 * An agenda the template creates. Only what travels between CRMs: no
 * messages, public link or feed — those stay off until the client's
 * own admin turns them on.
 */
export interface TemplateCalendar {
  name: string
  color?: string
  slot_minutes?: number
  hours: TemplateCalendarHours[]
}
export interface TemplateContent {
  pipelines: TemplatePipeline[]
  tags: TemplateTag[]
  custom_fields: TemplateField[]
  quick_replies: TemplateQuickReply[]
  automations: TemplateAutomation[]
  /** Present only when the template has agendas. */
  calendars?: TemplateCalendar[]
}

export const TEMPLATE_TRIGGERS = [
  'first_inbound_message',
  'new_contact_created',
  'keyword_match',
  'new_message_received',
] as const
export type TemplateTrigger = (typeof TEMPLATE_TRIGGERS)[number]

export const TEMPLATE_STEPS = [
  'send_message',
  'wait',
  'add_tag',
  'remove_tag',
  'create_deal',
  'close_conversation',
] as const
export type TemplateStepType = (typeof TEMPLATE_STEPS)[number]

export const TRIGGER_LABEL: Record<TemplateTrigger, string> = {
  first_inbound_message: 'Primeira mensagem do contato',
  new_contact_created: 'Contato novo criado',
  keyword_match: 'Mensagem com palavra-chave',
  new_message_received: 'Qualquer mensagem recebida',
}

const HEX = /^#[0-9a-fA-F]{6}$/

type Result = { ok: true; content: TemplateContent } | { ok: false; errors: string[] }

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** Validate and normalise template content. Collects every problem. */
export function parseTemplateContent(value: unknown): Result {
  const errors: string[] = []
  if (!isObj(value)) return { ok: false, errors: ['O conteúdo precisa ser um objeto JSON.'] }

  const list = (key: string): unknown[] => {
    const v = value[key]
    if (v === undefined) return []
    if (!Array.isArray(v)) {
      errors.push(`"${key}" precisa ser uma lista.`)
      return []
    }
    return v
  }
  const color = (v: unknown, where: string) => {
    if (v === undefined) return undefined
    if (typeof v !== 'string' || !HEX.test(v)) {
      errors.push(`${where}: cor precisa ser #RRGGBB.`)
      return undefined
    }
    return v
  }
  const dupes = (names: string[], what: string) => {
    const seen = new Set<string>()
    for (const n of names) {
      const k = n.toLowerCase()
      if (seen.has(k)) errors.push(`${what} repetido: "${n}".`)
      seen.add(k)
    }
  }

  const pipelines: TemplatePipeline[] = list('pipelines').map((p, i) => {
    const where = `Funil ${i + 1}`
    if (!isObj(p) || !str(p.name)) {
      errors.push(`${where}: precisa de nome.`)
      return { name: '', stages: [] }
    }
    const stagesRaw = Array.isArray(p.stages) ? p.stages : []
    if (stagesRaw.length === 0) errors.push(`Funil "${str(p.name)}": precisa de pelo menos uma etapa.`)
    const stages = stagesRaw.map((s, j) => {
      if (!isObj(s) || !str(s.name)) {
        errors.push(`Funil "${str(p.name)}", etapa ${j + 1}: precisa de nome.`)
        return { name: '' }
      }
      return { name: str(s.name), color: color(s.color, `Etapa "${str(s.name)}"`) }
    })
    dupes(stages.map((s) => s.name).filter(Boolean), `Etapa no funil "${str(p.name)}"`)
    return { name: str(p.name), stages }
  })
  dupes(pipelines.map((p) => p.name).filter(Boolean), 'Funil')

  const tags: TemplateTag[] = list('tags').map((t, i) => {
    if (!isObj(t) || !str(t.name)) {
      errors.push(`Etiqueta ${i + 1}: precisa de nome.`)
      return { name: '' }
    }
    return { name: str(t.name), color: color(t.color, `Etiqueta "${str(t.name)}"`) }
  })
  dupes(tags.map((t) => t.name).filter(Boolean), 'Etiqueta')

  const custom_fields: TemplateField[] = list('custom_fields').map((f, i) => {
    if (!isObj(f) || !str(f.name)) {
      errors.push(`Campo ${i + 1}: precisa de nome.`)
      return { name: '' }
    }
    const options = Array.isArray(f.options)
      ? f.options.filter((o): o is string => typeof o === 'string' && o.trim() !== '')
      : undefined
    // The app only edits text fields today; anything else would be a
    // field nobody can fill in.
    if (f.type !== undefined && f.type !== 'text') {
      errors.push(`Campo "${str(f.name)}": só o tipo "text" é suportado.`)
    }
    return { name: str(f.name), type: 'text', ...(options?.length ? { options } : {}) }
  })
  dupes(custom_fields.map((f) => f.name).filter(Boolean), 'Campo')

  const quick_replies: TemplateQuickReply[] = list('quick_replies').map((q, i) => {
    if (!isObj(q) || !str(q.title) || !str(q.text)) {
      errors.push(`Resposta rápida ${i + 1}: precisa de título e texto.`)
      return { title: '', text: '' }
    }
    return { title: str(q.title), text: str(q.text) }
  })
  dupes(quick_replies.map((q) => q.title).filter(Boolean), 'Resposta rápida')

  const automations: TemplateAutomation[] = list('automations').map((a, i) => {
    if (!isObj(a) || !str(a.name)) {
      errors.push(`Automação ${i + 1}: precisa de nome.`)
      return { name: '', trigger: 'first_inbound_message', steps: [] }
    }
    const name = str(a.name)
    const trigger = a.trigger as TemplateTrigger
    if (!(TEMPLATE_TRIGGERS as readonly string[]).includes(String(a.trigger))) {
      errors.push(`Automação "${name}": gatilho "${String(a.trigger)}" não pode ir num modelo.`)
    }
    const triggerConfig = isObj(a.trigger_config) ? a.trigger_config : undefined
    if (trigger === 'keyword_match') {
      const kws = triggerConfig?.keywords
      if (!Array.isArray(kws) || kws.length === 0) {
        errors.push(`Automação "${name}": palavra-chave precisa de "keywords".`)
      }
    }
    const stepsRaw = Array.isArray(a.steps) ? a.steps : []
    if (stepsRaw.length === 0) errors.push(`Automação "${name}": precisa de pelo menos um passo.`)
    const steps: TemplateStep[] = stepsRaw.map((s, j) => {
      const where = `Automação "${name}", passo ${j + 1}`
      if (!isObj(s) || !(TEMPLATE_STEPS as readonly string[]).includes(String(s.type))) {
        errors.push(`${where}: tipo "${isObj(s) ? String(s.type) : '?'}" não pode ir num modelo.`)
        return { type: 'send_message', config: {} }
      }
      const config = isObj(s.config) ? s.config : {}
      const type = s.type as TemplateStepType
      if (type === 'send_message' && !str(config.text)) errors.push(`${where}: mensagem vazia.`)
      if ((type === 'add_tag' || type === 'remove_tag') && !str(config.tag)) {
        errors.push(`${where}: diga o nome da etiqueta em "tag".`)
      }
      if (type === 'wait') {
        const unit = config.unit
        if (typeof config.amount !== 'number' || config.amount <= 0 || !['minutes', 'hours', 'days'].includes(String(unit))) {
          errors.push(`${where}: espera precisa de "amount" > 0 e "unit" (minutes, hours, days).`)
        }
      }
      if (type === 'create_deal') {
        const pipe = pipelines.find((p) => p.name.toLowerCase() === str(config.pipeline).toLowerCase())
        if (!str(config.pipeline) || !str(config.stage) || !str(config.title)) {
          errors.push(`${where}: negócio precisa de "pipeline", "stage" e "title".`)
        } else if (pipe && !pipe.stages.some((st) => st.name.toLowerCase() === str(config.stage).toLowerCase())) {
          errors.push(`${where}: o funil "${pipe.name}" não tem a etapa "${str(config.stage)}".`)
        }
      }
      return { type, config }
    })
    return {
      name,
      ...(str(a.description) ? { description: str(a.description) } : {}),
      trigger,
      ...(triggerConfig ? { trigger_config: triggerConfig } : {}),
      steps,
    }
  })
  dupes(automations.map((a) => a.name).filter(Boolean), 'Automação')

  const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/
  const calendars: TemplateCalendar[] = list('calendars').map((c, i) => {
    if (!isObj(c) || !str(c.name)) {
      errors.push(`Agenda ${i + 1}: precisa de nome.`)
      return { name: '', hours: [] }
    }
    const name = str(c.name)
    const where = `Agenda "${name}"`
    let slot: number | undefined
    if (c.slot_minutes !== undefined) {
      if (!Number.isInteger(c.slot_minutes) || (c.slot_minutes as number) < 5 || (c.slot_minutes as number) > 480) {
        errors.push(`${where}: "slot_minutes" precisa ser um inteiro entre 5 e 480.`)
      } else {
        slot = c.slot_minutes as number
      }
    }
    const hoursRaw = c.hours === undefined ? [] : c.hours
    if (!Array.isArray(hoursRaw)) errors.push(`${where}: "hours" precisa ser uma lista.`)
    const hours = (Array.isArray(hoursRaw) ? hoursRaw : []).flatMap((h, j): TemplateCalendarHours[] => {
      const at = `${where}, horário ${j + 1}`
      if (!isObj(h)) {
        errors.push(`${at}: precisa de "weekday", "starts" e "ends".`)
        return []
      }
      const weekday = h.weekday
      if (!Number.isInteger(weekday) || (weekday as number) < 1 || (weekday as number) > 7) {
        errors.push(`${at}: "weekday" vai de 1 (segunda) a 7 (domingo).`)
        return []
      }
      const starts = str(h.starts)
      const ends = str(h.ends)
      if (!CLOCK.test(starts) || !CLOCK.test(ends)) {
        errors.push(`${at}: "starts" e "ends" no formato HH:MM.`)
        return []
      }
      if (ends <= starts) {
        errors.push(`${at}: o fim precisa ser depois do início.`)
        return []
      }
      return [{ weekday: weekday as number, starts, ends }]
    })
    const tint = color(c.color, where)
    return {
      name,
      ...(tint ? { color: tint } : {}),
      ...(slot !== undefined ? { slot_minutes: slot } : {}),
      hours,
    }
  })
  dupes(calendars.map((c) => c.name).filter(Boolean), 'Agenda')

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    content: {
      pipelines,
      tags,
      custom_fields,
      quick_replies,
      automations,
      // Left out when empty, so a template with no agenda stores
      // exactly what it did before agendas existed.
      ...(calendars.length > 0 ? { calendars } : {}),
    },
  }
}

export interface TemplateCounts {
  pipelines: number
  stages: number
  tags: number
  customFields: number
  quickReplies: number
  automations: number
  /** Agendas (migration 067). Absent on counts taken before them. */
  calendars?: number
}

/** Counts for a stored template — tolerant of any JSON shape. */
export function templateCounts(content: unknown): TemplateCounts {
  const arr = (k: string): unknown[] =>
    isObj(content) && Array.isArray(content[k]) ? (content[k] as unknown[]) : []
  return {
    pipelines: arr('pipelines').length,
    stages: arr('pipelines').reduce<number>(
      (n, p) => n + (isObj(p) && Array.isArray(p.stages) ? p.stages.length : 0),
      0,
    ),
    tags: arr('tags').length,
    customFields: arr('custom_fields').length,
    quickReplies: arr('quick_replies').length,
    automations: arr('automations').length,
    calendars: arr('calendars').length,
  }
}

/** "1 funil (6 etapas), 5 etiquetas, 4 campos, 5 respostas, 2 automações" */
export function describeCounts(c: TemplateCounts): string {
  const p = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  return [
    `${p(c.pipelines, 'funil', 'funis')} (${p(c.stages, 'etapa', 'etapas')})`,
    p(c.tags, 'etiqueta', 'etiquetas'),
    p(c.customFields, 'campo', 'campos'),
    p(c.quickReplies, 'resposta rápida', 'respostas rápidas'),
    p(c.automations, 'automação', 'automações'),
    // Most templates have no agenda: say so only when there is one.
    ...(c.calendars ? [p(c.calendars, 'agenda', 'agendas')] : []),
  ].join(', ')
}

/** Summary returned by agencia_apply_template, in words. */
export function describeApplySummary(s: Record<string, unknown>): string {
  const n = (k: string) => Number(s[k] ?? 0)
  const created = describeCounts({
    pipelines: n('pipelines'),
    stages: n('stages'),
    tags: n('tags'),
    customFields: n('custom_fields'),
    quickReplies: n('quick_replies'),
    automations: n('automations'),
    calendars: n('calendars'),
  })
  const skipped = n('skipped')
  return skipped > 0
    ? `Criado: ${created}. ${skipped} ${skipped === 1 ? 'item já existia e ficou' : 'itens já existiam e ficaram'} como estava${skipped === 1 ? '' : 'm'}.`
    : `Criado: ${created}.`
}

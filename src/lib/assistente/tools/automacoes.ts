import { insertSteps, loadStepsTree, replaceSteps, type BuilderStepInput } from '@/lib/automations/steps-tree'
import {
  SEND_STEP_TYPES,
  validateStepsForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate'
import { resolveImportTagIds } from '@/lib/contacts/resolve-import-tags'
import { startSequence } from '@/lib/api/v1/sequences'
import { createScheduledMessage, cancelScheduledMessage, parseScheduleInput } from '@/lib/scheduled/messages'
import { createBulkSend, parseBulkInput } from '@/lib/bulk/sends'
import { parseAgentPayload } from '@/lib/agents/payload'
import { AGENT_ROLES } from '@/lib/agents/roles'

import { LINKS, clip, dateTime } from '../format'
import { parseLocalDateTime } from '../time'
import { nameMaps } from './leitura'
import { describeSteps, describeTrigger, stepsSendToCustomer, type NameMaps, type StepLike } from './descrever'
import { ToolError, type Prepared, type ToolContext, type ToolDef } from '../types'

// ============================================================
// Phase 3 — automations, sequences, scheduled messages, bulk sends
// and agents.
//
// Same rule as the screens, plus one: whatever the bot creates that
// runs by itself is born OFF (automations, agents). Switching it on
// is a separate card that says what will happen. Everything a
// customer would see is risk 'cliente' and always asks.
// ============================================================

type Row = Record<string, unknown>

const UUID = { type: 'string', format: 'uuid' } as const

export const TRIGGER_TYPES = [
  'lead_received',
  'new_message_received',
  'first_inbound_message',
  'keyword_match',
  'new_contact_created',
  'conversation_assigned',
  'tag_added',
  'interactive_reply',
  'manual',
] as const

export const STEP_TYPES = [
  'send_message',
  'send_buttons',
  'send_list',
  'send_template',
  'add_tag',
  'remove_tag',
  'assign_conversation',
  'update_contact_field',
  'create_deal',
  'wait',
  'condition',
  'send_webhook',
  'close_conversation',
  'agent_handoff',
] as const

const STEP_SCHEMA = {
  type: 'object',
  properties: {
    tipo: { type: 'string', enum: STEP_TYPES as unknown as string[] },
    config: { type: 'object', additionalProperties: true },
    sim: { type: 'array', items: { type: 'object', additionalProperties: true }, maxItems: 15 },
    nao: { type: 'array', items: { type: 'object', additionalProperties: true }, maxItems: 15 },
  },
  required: ['tipo'],
}

const TRIGGER_SCHEMA = {
  type: 'object',
  properties: {
    tipo: { type: 'string', enum: TRIGGER_TYPES as unknown as string[] },
    config: { type: 'object', additionalProperties: true },
  },
  required: ['tipo'],
}

const MAX_STEPS = 30

interface Draft {
  triggerType: string
  triggerConfig: Row
  steps: BuilderStepInput[]
  /** Tag names that do not exist yet and will be created on execute. */
  newTags: string[]
}

/** Model format ({tipo, config, sim, nao}) → the builder's tree. */
export function normalizeSteps(raw: unknown, depth = 0): BuilderStepInput[] {
  if (!Array.isArray(raw)) throw new ToolError('passos precisa ser uma lista')
  if (depth > 3) throw new ToolError('condições aninhadas demais (máximo 3 níveis)')
  return raw.map((item, i) => {
    const s = (item ?? {}) as Row
    const type = String(s.tipo ?? s.step_type ?? '')
    if (!(STEP_TYPES as readonly string[]).includes(type)) {
      throw new ToolError(`passo ${i + 1}: tipo "${type}" não existe`)
    }
    const config = (s.config ?? s.step_config ?? {}) as Row
    const step: BuilderStepInput = { step_type: type, step_config: { ...config } }
    if (type === 'condition') {
      step.branches = {
        yes: normalizeSteps(s.sim ?? [], depth + 1),
        no: normalizeSteps(s.nao ?? [], depth + 1),
      }
    }
    return step
  })
}

function countSteps(steps: BuilderStepInput[]): number {
  return steps.reduce(
    (n, s) => n + 1 + countSteps(s.branches?.yes ?? []) + countSteps(s.branches?.no ?? []),
    0,
  )
}

function walkSteps(steps: BuilderStepInput[], fn: (s: BuilderStepInput) => void): void {
  for (const s of steps) {
    fn(s)
    walkSteps(s.branches?.yes ?? [], fn)
    walkSteps(s.branches?.no ?? [], fn)
  }
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

/**
 * Resolve names the model may use instead of ids (tags by name), check
 * every id against this CRM, and return the draft plus a list of tags
 * to create. Never writes.
 */
async function buildDraft(
  ctx: ToolContext,
  names: NameMaps,
  trigger: { tipo: string; config?: Row },
  rawSteps: unknown,
): Promise<Draft | { error: string }> {
  if (trigger.tipo === 'time_based') {
    return { error: 'gatilho por horário não roda neste CRM; para algo num horário, use criar_rotina' }
  }
  let steps: BuilderStepInput[]
  try {
    steps = normalizeSteps(rawSteps ?? [])
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'passos inválidos' }
  }
  if (countSteps(steps) > MAX_STEPS) return { error: `no máximo ${MAX_STEPS} passos` }

  const tagByName = new Map([...names.tags].map(([id, name]) => [fold(name), id]))
  const newTags = new Set<string>()
  const problems: string[] = []

  const triggerConfig: Row = { ...(trigger.config ?? {}) }
  if (trigger.tipo === 'tag_added' && !triggerConfig.tag_id && triggerConfig.etiqueta) {
    const id = tagByName.get(fold(String(triggerConfig.etiqueta)))
    if (!id) problems.push(`a etiqueta "${triggerConfig.etiqueta}" não existe`)
    else triggerConfig.tag_id = id
    delete triggerConfig.etiqueta
  }
  if (trigger.tipo === 'tag_added' && triggerConfig.tag_id && !names.tags.has(String(triggerConfig.tag_id))) {
    problems.push('a etiqueta do gatilho não é deste CRM')
  }
  if (trigger.tipo === 'keyword_match') {
    triggerConfig.match_type = triggerConfig.match_type === 'exact' ? 'exact' : 'contains'
  }

  const members = new Set<string>()
  const { data: team } = await ctx.db.from('account_members').select('user_id').eq('account_id', ctx.accountId)
  for (const m of (team ?? []) as Row[]) members.add(String(m.user_id))

  walkSteps(steps, (s) => {
    const c = s.step_config
    if (s.step_type === 'add_tag' || s.step_type === 'remove_tag') {
      if (!c.tag_id && c.etiqueta) {
        const name = String(c.etiqueta).trim()
        const id = tagByName.get(fold(name))
        if (id) c.tag_id = id
        else if (s.step_type === 'add_tag') {
          newTags.add(name)
          c.__etiqueta_nova = name
        } else problems.push(`a etiqueta "${name}" não existe`)
        delete c.etiqueta
      } else if (c.tag_id && !names.tags.has(String(c.tag_id))) {
        problems.push('uma etiqueta usada nos passos não é deste CRM')
      }
    }
    if (s.step_type === 'condition' && c.subject === 'tag_presence') {
      if (!c.operand && c.etiqueta) {
        const id = tagByName.get(fold(String(c.etiqueta)))
        if (!id) problems.push(`a etiqueta "${c.etiqueta}" da condição não existe`)
        else c.operand = id
        delete c.etiqueta
      }
    }
    if (s.step_type === 'create_deal') {
      const stage = names.stages.get(String(c.stage_id))
      if (!stage) problems.push('a etapa do passo "criar negócio" não é deste CRM')
      if (c.pipeline_id && !names.pipelines.has(String(c.pipeline_id))) {
        problems.push('o funil do passo "criar negócio" não é deste CRM')
      }
    }
    if (s.step_type === 'assign_conversation') {
      c.mode = c.mode === 'specific' ? 'specific' : 'round_robin'
      if (c.mode === 'specific' && !members.has(String(c.agent_id))) {
        problems.push('a pessoa do passo "atribuir conversa" não é da equipe')
      }
    }
    if (s.step_type === 'agent_handoff' && !c.role) c.role = 'sdr'
  })
  if (problems.length) return { error: problems.join('; ') }

  // The same checks as switching it on, with not-yet-created tags
  // standing in, so a draft that could never be switched on fails now.
  const forValidation = JSON.parse(JSON.stringify(steps)) as BuilderStepInput[]
  walkSteps(forValidation, (s) => {
    if (s.step_config.__etiqueta_nova) s.step_config.tag_id = 'nova'
  })
  const issues = [
    ...validateTriggerForActivation(trigger.tipo, triggerConfig),
    ...validateStepsForActivation(
      forValidation as unknown as { step_type: string; step_config: Record<string, unknown> }[],
      trigger.tipo,
    ),
  ]
  if (issues.length) return { error: issues.map((i) => `${i.path}: ${i.message}`).join('; ') }

  return { triggerType: trigger.tipo, triggerConfig, steps, newTags: [...newTags] }
}

/** Create the tags the draft needs and put their ids into the steps. */
async function materializeTags(ctx: ToolContext, steps: BuilderStepInput[]): Promise<void> {
  const wanted = new Set<string>()
  walkSteps(steps, (s) => {
    if (s.step_config.__etiqueta_nova) wanted.add(String(s.step_config.__etiqueta_nova))
  })
  if (wanted.size === 0) return
  const { tagIdByKey } = await resolveImportTagIds(ctx.db, {
    accountId: ctx.accountId,
    userId: ctx.userId,
    tagNames: [...wanted],
    canCreateTags: true,
  })
  const byFold = new Map([...tagIdByKey].map(([k, id]) => [fold(k), id]))
  walkSteps(steps, (s) => {
    const name = s.step_config.__etiqueta_nova
    if (!name) return
    const id = byFold.get(fold(String(name)))
    if (!id) throw new ToolError(`não consegui criar a etiqueta "${name}"`)
    s.step_config.tag_id = id
    delete s.step_config.__etiqueta_nova
  })
}

/** Names for the card, including the tags still to be created. */
function namesWithNew(names: NameMaps, steps: BuilderStepInput[]): NameMaps {
  const tags = new Map(names.tags)
  walkSteps(steps, (s) => {
    const n = s.step_config.__etiqueta_nova
    if (n) {
      s.step_config.tag_id = s.step_config.tag_id ?? `nova:${n}`
      tags.set(String(s.step_config.tag_id), `${n} (nova)`)
    }
  })
  return { ...names, tags }
}

function stripPreviewIds(steps: BuilderStepInput[]): void {
  walkSteps(steps, (s) => {
    if (typeof s.step_config.tag_id === 'string' && s.step_config.tag_id.startsWith('nova:')) {
      delete s.step_config.tag_id
    }
  })
}

async function loadAutomation(ctx: ToolContext, id: string): Promise<Row> {
  const { data, error } = await ctx.db
    .from('automations')
    .select('*')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (error) throw new ToolError(`Não consegui abrir a automação: ${error.message}`)
  if (!data) throw new ToolError('Automação não encontrada neste CRM.')
  return data as Row
}

const criarAutomacao: ToolDef = {
  name: 'criar_automacao',
  label: 'Montou uma automação',
  risk: 'maior',
  minRole: 'agent',
  description:
    'Cria uma automação (nasce DESLIGADA; para ligar use ligar_desligar_automacao depois). Gatilho manual = sequência. Siga o guia de automações das instruções para o formato do gatilho e de cada passo.',
  parameters: {
    type: 'object',
    properties: {
      nome: { type: 'string', minLength: 1, maxLength: 120 },
      descricao: { type: 'string', maxLength: 500 },
      gatilho: TRIGGER_SCHEMA,
      passos: { type: 'array', items: STEP_SCHEMA, minItems: 1, maxItems: MAX_STEPS },
    },
    required: ['nome', 'gatilho', 'passos'],
  },
  async prepare(ctx, input) {
    const names = await nameMaps(ctx)
    const trigger = input.gatilho as { tipo: string; config?: Row }
    const draft = await buildDraft(ctx, names, trigger, input.passos)
    if ('error' in draft) return draft
    const shown = namesWithNew(names, draft.steps)
    const sends = stepsSendToCustomer(draft.steps as StepLike[])
    const lines = [
      describeTrigger(draft.triggerType, draft.triggerConfig, shown),
      ...describeSteps(draft.steps as StepLike[], shown),
    ]
    stripPreviewIds(draft.steps)
    const badges = ['Nasce desligada']
    if (sends) badges.unshift('Fala com clientes')
    if (draft.newTags.length) badges.push(`Cria etiqueta: ${draft.newTags.join(', ')}`)
    return {
      preview: {
        title: `${draft.triggerType === 'manual' ? 'Criar sequência' : 'Criar automação'}: ${clip(String(input.nome), 70)}`,
        lines,
        badges,
        openAfter: { label: 'Criar e abrir no editor' },
      },
      input: {
        nome: input.nome,
        descricao: input.descricao ?? null,
        trigger_type: draft.triggerType,
        trigger_config: draft.triggerConfig,
        steps: draft.steps,
      },
      risk: 'maior',
    }
  },
  async execute(ctx, input) {
    const steps = JSON.parse(JSON.stringify(input.steps ?? [])) as BuilderStepInput[]
    await materializeTags(ctx, steps)
    const { data, error } = await ctx.admin
      .from('automations')
      .insert({
        user_id: ctx.userId,
        account_id: ctx.accountId,
        name: input.nome,
        description: input.descricao ?? null,
        trigger_type: input.trigger_type,
        trigger_config: input.trigger_config ?? {},
        is_active: false,
      })
      .select('id')
      .single()
    if (error || !data) throw new ToolError(`Não consegui criar: ${error?.message ?? ''}`)
    const id = String((data as Row).id)
    const err = await insertSteps(id, steps)
    if (err) {
      await ctx.admin.from('automations').delete().eq('id', id)
      throw new ToolError(`Não consegui salvar os passos: ${err}`)
    }
    return {
      summary: `Automação "${input.nome}" criada, desligada.`,
      link: { href: LINKS.automation(id), label: 'Abrir no editor' },
      result: { automacao_id: id, ligada: false },
      undo: { automation_id: id },
    }
  },
  async undo(ctx, data) {
    const { data: row } = await ctx.admin
      .from('automations')
      .select('is_active')
      .eq('id', String(data.automation_id))
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if ((row as Row | null)?.is_active) throw new ToolError('Ela já foi ligada; desligue antes de desfazer.')
    await ctx.admin.from('automations').delete().eq('id', String(data.automation_id)).eq('account_id', ctx.accountId)
  },
}

const editarAutomacao: ToolDef = {
  name: 'editar_automacao',
  label: 'Preparou uma alteração de automação',
  risk: 'maior',
  minRole: 'agent',
  description:
    'Altera uma automação: nome, descrição, gatilho e/ou TODOS os passos (mande a lista completa nova; ela substitui a antiga). Leia antes com ver_automacao.',
  parameters: {
    type: 'object',
    properties: {
      automacao_id: UUID,
      nome: { type: 'string', minLength: 1, maxLength: 120 },
      descricao: { type: 'string', maxLength: 500 },
      gatilho: TRIGGER_SCHEMA,
      passos: { type: 'array', items: STEP_SCHEMA, minItems: 1, maxItems: MAX_STEPS },
    },
    required: ['automacao_id'],
  },
  async prepare(ctx, input) {
    const current = await loadAutomation(ctx, String(input.automacao_id))
    const currentSteps = await loadStepsTree(String(current.id))
    const names = await nameMaps(ctx)
    const trigger = (input.gatilho as { tipo: string; config?: Row } | undefined) ?? {
      tipo: String(current.trigger_type),
      config: (current.trigger_config ?? {}) as Row,
    }
    const rawSteps =
      input.passos ??
      (currentSteps as unknown as BuilderStepInput[]).map(function back(s): Row {
        return {
          tipo: s.step_type,
          config: s.step_config,
          sim: (s.branches?.yes ?? []).map(back),
          nao: (s.branches?.no ?? []).map(back),
        }
      })
    const draft = await buildDraft(ctx, names, trigger, rawSteps)
    if ('error' in draft) return draft
    const shown = namesWithNew(names, draft.steps)
    const lines: string[] = []
    if (input.nome && input.nome !== current.name) lines.push(`Nome: "${current.name}" → "${input.nome}"`)
    if (input.gatilho) {
      lines.push(`Gatilho antes: ${describeTrigger(String(current.trigger_type), (current.trigger_config ?? {}) as Row, names)}`)
      lines.push(`Gatilho depois: ${describeTrigger(draft.triggerType, draft.triggerConfig, shown)}`)
    }
    if (input.passos) {
      lines.push('Passos depois:')
      lines.push(...describeSteps(draft.steps as StepLike[], shown))
    }
    if (lines.length === 0) return { error: 'nada a mudar' }
    stripPreviewIds(draft.steps)
    const sends = stepsSendToCustomer(draft.steps as StepLike[])
    const active = current.is_active === true
    return {
      preview: {
        title: `Alterar automação: ${clip(String(current.name), 70)}`,
        lines,
        badges: [active ? 'Está ligada: vale na hora' : 'Está desligada', ...(sends ? ['Fala com clientes'] : [])],
      },
      input: {
        automacao_id: current.id,
        nome: input.nome ?? undefined,
        descricao: input.descricao ?? undefined,
        trigger_type: input.gatilho ? draft.triggerType : undefined,
        trigger_config: input.gatilho ? draft.triggerConfig : undefined,
        steps: input.passos ? draft.steps : undefined,
      },
      risk: active && sends ? 'cliente' : 'maior',
    }
  },
  async execute(ctx, input) {
    const id = String(input.automacao_id)
    const before = await loadAutomation(ctx, id)
    const beforeSteps = await loadStepsTree(id)
    const update: Row = {}
    if (input.nome) update.name = input.nome
    if (input.descricao !== undefined) update.description = input.descricao
    if (input.trigger_type) {
      update.trigger_type = input.trigger_type
      update.trigger_config = input.trigger_config ?? {}
    }
    if (Object.keys(update).length) {
      const { error } = await ctx.admin.from('automations').update(update).eq('id', id).eq('account_id', ctx.accountId)
      if (error) throw new ToolError(`Não consegui salvar: ${error.message}`)
    }
    if (Array.isArray(input.steps)) {
      const steps = JSON.parse(JSON.stringify(input.steps)) as BuilderStepInput[]
      await materializeTags(ctx, steps)
      const err = await replaceSteps(id, steps)
      if (err) throw new ToolError(`Não consegui salvar os passos: ${err}`)
    }
    return {
      summary: `Automação "${input.nome ?? before.name}" alterada.`,
      link: { href: LINKS.automation(id), label: 'Abrir no editor' },
      undo: {
        automation_id: id,
        previous: {
          name: before.name,
          description: before.description ?? null,
          trigger_type: before.trigger_type,
          trigger_config: before.trigger_config ?? {},
        },
        steps: Array.isArray(input.steps) ? beforeSteps : null,
      },
    }
  },
  async undo(ctx, data) {
    const id = String(data.automation_id)
    await ctx.admin.from('automations').update(data.previous as Row).eq('id', id).eq('account_id', ctx.accountId)
    if (Array.isArray(data.steps)) {
      const err = await replaceSteps(id, data.steps as BuilderStepInput[])
      if (err) throw new ToolError(`Não consegui voltar os passos: ${err}`)
    }
  },
}

const ligarDesligarAutomacao: ToolDef = {
  name: 'ligar_desligar_automacao',
  label: 'Preparou ligar/desligar uma automação',
  risk: 'maior',
  minRole: 'agent',
  description: 'Liga ou desliga uma automação. Ligar só passa se a configuração estiver completa.',
  parameters: {
    type: 'object',
    properties: { automacao_id: UUID, ligar: { type: 'boolean' } },
    required: ['automacao_id', 'ligar'],
  },
  async prepare(ctx, input) {
    const a = await loadAutomation(ctx, String(input.automacao_id))
    const on = input.ligar === true
    if ((a.is_active === true) === on) return { error: `ela já está ${on ? 'ligada' : 'desligada'}` }
    const steps = await loadStepsTree(String(a.id))
    if (on) {
      const issues = [
        ...validateTriggerForActivation(String(a.trigger_type), a.trigger_config ?? {}),
        ...validateStepsForActivation(steps, String(a.trigger_type)),
      ]
      if (issues.length) return { error: `não dá para ligar: ${issues.map((i) => i.message).join('; ')}` }
    }
    const names = await nameMaps(ctx)
    const sends = stepsSendToCustomer(steps as StepLike[])
    const lines = [
      describeTrigger(String(a.trigger_type), (a.trigger_config ?? {}) as Row, names),
      ...describeSteps(steps as StepLike[], names),
    ]
    const warnings: string[] = []
    if (on && sends) warnings.push('A partir de agora ela manda mensagens aos clientes sozinha, cada vez que o gatilho acontecer.')
    return {
      preview: {
        title: `${on ? 'Ligar' : 'Desligar'} automação: ${clip(String(a.name), 70)}`,
        lines,
        badges: on && sends ? ['Fala com clientes'] : undefined,
        warnings,
      },
      input,
      risk: on && sends ? 'cliente' : 'maior',
    }
  },
  async execute(ctx, input) {
    const id = String(input.automacao_id)
    const on = input.ligar === true
    if (on) {
      const a = await loadAutomation(ctx, id)
      const steps = await loadStepsTree(id)
      const issues = [
        ...validateTriggerForActivation(String(a.trigger_type), a.trigger_config ?? {}),
        ...validateStepsForActivation(steps, String(a.trigger_type)),
      ]
      if (issues.length) throw new ToolError(`Não dá para ligar: ${issues.map((i) => i.message).join('; ')}`)
    }
    const { error } = await ctx.admin.from('automations').update({ is_active: on }).eq('id', id).eq('account_id', ctx.accountId)
    if (error) throw new ToolError(`Não consegui ${on ? 'ligar' : 'desligar'}: ${error.message}`)
    return {
      summary: `Automação ${on ? 'ligada' : 'desligada'}.`,
      link: { href: LINKS.automation(id), label: 'Abrir' },
      undo: { automation_id: id, active: !on },
    }
  },
  async undo(ctx, data) {
    await ctx.admin
      .from('automations')
      .update({ is_active: data.active === true })
      .eq('id', String(data.automation_id))
      .eq('account_id', ctx.accountId)
  },
}

const iniciarSequencia: ToolDef = {
  name: 'iniciar_sequencia',
  label: 'Preparou o início de uma sequência',
  risk: 'cliente',
  minRole: 'agent',
  description: 'Começa uma sequência (automação com gatilho manual) num contato. As mensagens dela vão para o cliente.',
  parameters: {
    type: 'object',
    properties: { sequencia_id: UUID, contato_id: UUID },
    required: ['sequencia_id', 'contato_id'],
  },
  async prepare(ctx, input) {
    const a = await loadAutomation(ctx, String(input.sequencia_id))
    if (a.trigger_type !== 'manual') return { error: 'isso não é uma sequência (o gatilho não é manual)' }
    if (!a.is_active) return { error: 'a sequência está desligada; ligue antes' }
    const { data: c } = await ctx.db
      .from('contacts')
      .select('id, name, phone, opted_out_at')
      .eq('id', String(input.contato_id))
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!c) return { error: 'contato não encontrado neste CRM' }
    if ((c as Row).opted_out_at) return { error: 'esse contato pediu para não receber mensagens automáticas' }
    const steps = await loadStepsTree(String(a.id))
    const names = await nameMaps(ctx)
    return {
      preview: {
        title: `Iniciar "${clip(String(a.name), 60)}" em ${(c as Row).name ?? (c as Row).phone}`,
        lines: describeSteps(steps as StepLike[], names),
        badges: ['Fala com clientes'],
      },
      input,
    }
  },
  async execute(ctx, input) {
    try {
      await startSequence(ctx.admin, ctx.accountId, String(input.sequencia_id), String(input.contato_id))
    } catch (err) {
      throw new ToolError(err instanceof Error ? err.message : 'não consegui iniciar a sequência')
    }
    return {
      summary: 'Sequência iniciada.',
      link: { href: LINKS.contact(String(input.contato_id)), label: 'Abrir contato' },
    }
  },
}

const agendarMensagem: ToolDef = {
  name: 'agendar_mensagem',
  label: 'Preparou uma mensagem agendada',
  risk: 'cliente',
  minRole: 'agent',
  description:
    'Agenda uma mensagem de WhatsApp para um contato (quando = AAAA-MM-DDTHH:MM no fuso da pessoa; de 1 minuto a 90 dias). so_se_nao_responder=true cancela sozinha se o cliente responder antes.',
  parameters: {
    type: 'object',
    properties: {
      contato_id: UUID,
      texto: { type: 'string', minLength: 1, maxLength: 4096 },
      quando: { type: 'string' },
      so_se_nao_responder: { type: 'boolean' },
    },
    required: ['contato_id', 'texto', 'quando'],
  },
  async prepare(ctx, input) {
    const at = parseLocalDateTime(String(input.quando), ctx.timezone)
    if (!at) return { error: 'quando precisa ser AAAA-MM-DDTHH:MM' }
    try {
      parseScheduleInput(
        { text: input.texto, send_at: at.toISOString(), only_if_no_reply: input.so_se_nao_responder === true },
        ctx.now.getTime(),
      )
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'horário inválido' }
    }
    const { data: c } = await ctx.db
      .from('contacts')
      .select('name, phone')
      .eq('id', String(input.contato_id))
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!c) return { error: 'contato não encontrado neste CRM' }
    return {
      preview: {
        title: `Agendar mensagem para ${(c as Row).name ?? (c as Row).phone}`,
        lines: [
          `Quando: ${dateTime(at.toISOString(), ctx.timezone)}`,
          `Texto: "${clip(String(input.texto), 300)}"`,
          ...(input.so_se_nao_responder ? ['Só vai se o cliente não responder antes'] : []),
        ],
        badges: ['Fala com clientes'],
      },
      input: { ...input, send_at: at.toISOString() },
    }
  },
  async execute(ctx, input) {
    const parsed = parseScheduleInput(
      { text: input.texto, send_at: input.send_at, only_if_no_reply: input.so_se_nao_responder === true },
      Date.now(),
    )
    const created = await createScheduledMessage(ctx.db, ctx.accountId, String(input.contato_id), ctx.userId, parsed)
    return {
      summary: `Mensagem agendada para ${dateTime(created.send_at, ctx.timezone)}.`,
      link: { href: LINKS.contact(String(input.contato_id)), label: 'Abrir contato' },
      undo: { scheduled_id: created.id },
    }
  },
  async undo(ctx, data) {
    await cancelScheduledMessage(ctx.db, ctx.accountId, String(data.scheduled_id))
  },
}

const criarDisparo: ToolDef = {
  name: 'criar_disparo',
  label: 'Preparou um disparo',
  risk: 'cliente',
  minRole: 'admin',
  description:
    'Disparo em massa pelo WhatsApp do QR code (uazapi/Evolution) para quem tem uma etiqueta, com intervalos de 30 a 90 s e até 200 por dia. Na API oficial não existe: lá se usa campanha com modelo aprovado, na tela Disparos.',
  parameters: {
    type: 'object',
    properties: {
      nome: { type: 'string', minLength: 1, maxLength: 120 },
      texto: { type: 'string', minLength: 1, maxLength: 4096 },
      etiqueta: { type: 'string', minLength: 1, maxLength: 60, description: 'Nome da etiqueta do público.' },
    },
    required: ['nome', 'texto', 'etiqueta'],
  },
  async prepare(ctx, input) {
    const { data: tag } = await ctx.db
      .from('tags')
      .select('id, name')
      .eq('account_id', ctx.accountId)
      .ilike('name', String(input.etiqueta))
      .limit(1)
      .maybeSingle()
    if (!tag) return { error: `não existe a etiqueta "${input.etiqueta}"` }
    let plan
    try {
      const parsed = parseBulkInput({
        name: input.nome,
        text: input.texto,
        tag_id: (tag as Row).id,
        risk_accepted: true,
      })
      plan = await createBulkSend(ctx.db, ctx.admin, ctx.accountId, ctx.userId, parsed, { dryRun: true })
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'não consegui planejar o disparo' }
    }
    if (plan.total === 0) return { error: 'ninguém para receber: a etiqueta está vazia ou todos pediram para sair' }
    const lines = [
      `Para: quem tem a etiqueta "${(tag as Row).name}" (${plan.total} pessoa(s))`,
      `Texto: "${clip(String(input.texto), 300)}"`,
      `Começa: ${dateTime(plan.first_at, ctx.timezone) ?? 'em 1 minuto'}; termina perto de ${dateTime(plan.last_at, ctx.timezone) ?? '?'}`,
    ]
    if (plan.opted_out) lines.push(`${plan.opted_out} ficam de fora (pediram para não receber).`)
    return {
      preview: {
        title: `Disparo: ${clip(String(input.nome), 60)}`,
        lines,
        count: plan.total,
        badges: ['Fala com clientes', `${plan.total} pessoas`],
        warnings: [
          'Envio em massa pelo QR code pode levar ao bloqueio do número pelo WhatsApp. Ao confirmar, você aceita esse risco.',
        ],
      },
      input: { ...input, tag_id: (tag as Row).id },
    }
  },
  async execute(ctx, input) {
    const parsed = parseBulkInput({ name: input.nome, text: input.texto, tag_id: input.tag_id, risk_accepted: true })
    const plan = await createBulkSend(ctx.db, ctx.admin, ctx.accountId, ctx.userId, parsed, { dryRun: false })
    return {
      summary: `Disparo criado para ${plan.total} pessoa(s).`,
      link: { href: '/broadcasts', label: 'Acompanhar' },
      result: { disparo_id: plan.id },
    }
  },
}

const criarAgente: ToolDef = {
  name: 'criar_agente',
  label: 'Montou um agente de IA',
  risk: 'maior',
  minRole: 'admin',
  description: `Cria um agente de IA que fala com clientes. Nasce DESLIGADO e na autonomia 1 (pede aprovação para tudo). funcao: ${AGENT_ROLES.map((r) => r.id).join(', ')} ou custom.`,
  parameters: {
    type: 'object',
    properties: {
      nome: { type: 'string', minLength: 1, maxLength: 80 },
      funcao: { type: 'string', maxLength: 40 },
      objetivo: { type: 'string', maxLength: 300 },
      instrucoes: { type: 'string', minLength: 20, maxLength: 8000, description: 'Como o agente deve falar e agir.' },
      palavras_chave: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 20 },
      canais: { type: 'array', items: { type: 'string', enum: ['whatsapp', 'instagram', 'email'] }, maxItems: 3 },
    },
    required: ['nome', 'instrucoes'],
  },
  async prepare(_ctx, input) {
    const parsed = parseAgentPayload(
      {
        name: input.nome,
        role: input.funcao ?? 'custom',
        objective: input.objetivo ?? null,
        system_prompt: input.instrucoes,
        keywords: input.palavras_chave ?? [],
        channels: input.canais ?? ['whatsapp'],
        autonomy: 1,
        is_active: false,
      },
      { partial: false },
    )
    if ('error' in parsed) return { error: parsed.error }
    return {
      preview: {
        title: `Criar agente: ${input.nome}`,
        lines: [
          `Função: ${parsed.values.role ?? 'custom'}`,
          ...(input.objetivo ? [`Objetivo: ${clip(String(input.objetivo), 200)}`] : []),
          `Instruções: ${clip(String(input.instrucoes), 300)}`,
          ...(parsed.values.keywords?.length ? [`Palavras-chave: ${parsed.values.keywords.join(', ')}`] : []),
        ],
        badges: ['Nasce desligado', 'Pede aprovação para tudo'],
        openAfter: { label: 'Criar e abrir agentes' },
      },
      input: { values: { ...parsed.values, autonomy: 1, is_active: false } },
    }
  },
  async execute(ctx, input) {
    const { data, error } = await ctx.db
      .from('agents')
      .insert({ ...(input.values as Row), account_id: ctx.accountId, created_by: ctx.userId })
      .select('id')
      .single()
    if (error || !data) throw new ToolError(`Não consegui criar o agente: ${error?.message ?? ''}`)
    return {
      summary: `Agente "${(input.values as Row).name}" criado, desligado.`,
      link: { href: LINKS.agents(), label: 'Abrir agentes' },
      undo: { agent_id: (data as Row).id },
    }
  },
  async undo(ctx, data) {
    await ctx.db.from('agents').delete().eq('id', String(data.agent_id)).eq('account_id', ctx.accountId).eq('is_active', false)
  },
}

const ligarDesligarAgente: ToolDef = {
  name: 'ligar_desligar_agente',
  label: 'Preparou ligar/desligar um agente',
  risk: 'cliente',
  minRole: 'admin',
  description: 'Liga ou desliga um agente de IA. Ligado, ele responde clientes sozinho dentro da autonomia configurada.',
  parameters: {
    type: 'object',
    properties: { agente_id: UUID, ligar: { type: 'boolean' } },
    required: ['agente_id', 'ligar'],
  },
  async prepare(ctx, input) {
    const { data } = await ctx.db
      .from('agents')
      .select('id, name, role, is_active, autonomy, channels')
      .eq('id', String(input.agente_id))
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!data) return { error: 'agente não encontrado neste CRM' }
    const a = data as Row
    const on = input.ligar === true
    if ((a.is_active === true) === on) return { error: `ele já está ${on ? 'ligado' : 'desligado'}` }
    return {
      preview: {
        title: `${on ? 'Ligar' : 'Desligar'} agente: ${a.name}`,
        lines: [`Função: ${a.role}`, `Autonomia: ${a.autonomy}`, `Canais: ${((a.channels ?? []) as string[]).join(', ') || '—'}`],
        badges: on ? ['Fala com clientes'] : undefined,
      },
      input,
      risk: on ? 'cliente' : 'maior',
    }
  },
  async execute(ctx, input) {
    const on = input.ligar === true
    const { error } = await ctx.db
      .from('agents')
      .update({ is_active: on })
      .eq('id', String(input.agente_id))
      .eq('account_id', ctx.accountId)
    if (error) throw new ToolError(`Não consegui: ${error.message}`)
    return {
      summary: `Agente ${on ? 'ligado' : 'desligado'}.`,
      link: { href: LINKS.agents(), label: 'Abrir agentes' },
      undo: { agent_id: input.agente_id, active: !on },
    }
  },
  async undo(ctx, data) {
    await ctx.db
      .from('agents')
      .update({ is_active: data.active === true })
      .eq('id', String(data.agent_id))
      .eq('account_id', ctx.accountId)
  },
}

export const AUTOMATION_TOOLS: ToolDef[] = [
  criarAutomacao,
  editarAutomacao,
  ligarDesligarAutomacao,
  iniciarSequencia,
  agendarMensagem,
  criarDisparo,
  criarAgente,
  ligarDesligarAgente,
]

export { SEND_STEP_TYPES }
export type { Prepared }

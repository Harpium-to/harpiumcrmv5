import { triggerMeta } from '@/lib/automations/trigger-meta'

// ============================================================
// An automation in words — for the confirmation card and for the
// model reading an existing one. Pure: ids are turned into names
// through the maps the caller passes, and anything unknown is shown
// as is rather than guessed.
// ============================================================

export interface NameMaps {
  tags: Map<string, string>
  stages: Map<string, string>
  pipelines: Map<string, string>
  members?: Map<string, string>
}

type Row = Record<string, unknown>

export interface StepLike {
  step_type: string
  step_config?: Row
  branches?: { yes?: StepLike[]; no?: StepLike[] }
}

const UNIT: Record<string, [string, string]> = {
  minutes: ['minuto', 'minutos'],
  hours: ['hora', 'horas'],
  days: ['dia', 'dias'],
}

function quote(text: unknown, max = 90): string {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  return `"${s.length > max ? `${s.slice(0, max - 1)}…` : s}"`
}

export function describeTrigger(type: string, config: Row, names: NameMaps): string {
  switch (type) {
    case 'new_message_received':
      return 'Quando chegar qualquer mensagem de um cliente'
    case 'first_inbound_message':
      return 'Quando um contato mandar a primeira mensagem'
    case 'keyword_match': {
      const words = Array.isArray(config.keywords) ? (config.keywords as string[]) : []
      const mode = config.match_type === 'exact' ? 'for exatamente' : 'contiver'
      return `Quando a mensagem ${mode}: ${words.map((w) => quote(w, 30)).join(', ') || '(sem palavras)'}`
    }
    case 'new_contact_created':
      return 'Quando um contato novo for criado'
    case 'conversation_assigned':
      return 'Quando uma conversa for atribuída a alguém'
    case 'tag_added':
      return `Quando a etiqueta ${quote(names.tags.get(String(config.tag_id)) ?? config.tag_id)} for adicionada`
    case 'interactive_reply': {
      const ids = Array.isArray(config.reply_ids) ? (config.reply_ids as string[]) : []
      return `Quando o cliente tocar no botão/lista: ${ids.join(', ')}`
    }
    case 'manual':
      return 'Sequência: começa quando alguém inicia num contato (pela extensão ou pelo Harpi)'
    case 'lead_received': {
      const parts: string[] = []
      const origins = Array.isArray(config.origens) ? (config.origens as string[]) : []
      const tags = Array.isArray(config.etiquetas) ? (config.etiquetas as string[]) : []
      if (origins.length) parts.push(`com origem ${origins.map((o) => quote(o, 40)).join(' ou ')}`)
      if (tags.length) parts.push(`com a etiqueta ${tags.map((t) => quote(t, 30)).join(' ou ')}`)
      if (config.rota) parts.push(`pela rota ${quote(config.rota, 40)}`)
      return `Quando chegar um lead${parts.length ? ` ${parts.join(', ')}` : ' (de qualquer origem)'}`
    }
    case 'time_based':
      return `Por horário (${String(config.schedule ?? '?')})`
    default:
      return triggerMeta(type).label
  }
}

export function describeStep(step: StepLike, names: NameMaps): string {
  const c = (step.step_config ?? {}) as Row
  switch (step.step_type) {
    case 'send_message':
      return `Enviar mensagem: ${quote(c.text)}`
    case 'send_buttons':
      return `Enviar mensagem com botões: ${quote(c.body ?? c.text)}`
    case 'send_list':
      return `Enviar mensagem com lista: ${quote(c.body ?? c.text)}`
    case 'send_template':
      return `Enviar o modelo aprovado ${quote(c.template_name, 60)}`
    case 'add_tag':
      return `Adicionar a etiqueta ${quote(names.tags.get(String(c.tag_id)) ?? c.tag_id, 40)}`
    case 'remove_tag':
      return `Tirar a etiqueta ${quote(names.tags.get(String(c.tag_id)) ?? c.tag_id, 40)}`
    case 'assign_conversation':
      return c.mode === 'specific'
        ? `Atribuir a conversa a ${names.members?.get(String(c.agent_id)) ?? 'uma pessoa específica'}`
        : 'Atribuir a conversa em rodízio entre a equipe'
    case 'update_contact_field':
      return `Mudar o campo ${quote(c.field, 40)} para ${quote(c.value, 40)}`
    case 'create_deal': {
      const stage = names.stages.get(String(c.stage_id)) ?? 'etapa ?'
      const value = typeof c.value === 'number' && c.value > 0 ? `, valor ${c.value}` : ''
      return `Criar negócio ${quote(c.title, 50)} em ${stage}${value}`
    }
    case 'wait': {
      const amount = Number(c.amount) || 0
      const [one, many] = UNIT[String(c.unit)] ?? ['?', '?']
      return `Esperar ${amount} ${amount === 1 ? one : many}`
    }
    case 'condition': {
      const subject = String(c.subject)
      if (subject === 'tag_presence') {
        return `Se o contato tem a etiqueta ${quote(names.tags.get(String(c.operand)) ?? c.operand, 40)}`
      }
      if (subject === 'contact_field') return `Se o campo ${quote(c.operand, 30)} for ${quote(c.value, 30)}`
      if (subject === 'message_content') return `Se a mensagem contém ${quote(c.value, 40)}`
      if (subject === 'time_of_day') return `Se for entre ${String(c.operand ?? '?')}`
      return `Se ${subject}`
    }
    case 'send_webhook':
      return `Avisar um sistema externo (webhook): ${String(c.url ?? '?')}`
    case 'close_conversation':
      return 'Fechar a conversa'
    case 'agent_handoff':
      return `Passar o contato ao agente de IA (${String(c.role ?? 'sdr')})`
    default:
      return step.step_type
  }
}

/** Numbered lines, with the yes/no branches of a condition indented. */
export function describeSteps(steps: StepLike[], names: NameMaps, prefix = ''): string[] {
  const out: string[] = []
  steps.forEach((step, i) => {
    const label = `${prefix}${i + 1}`
    out.push(`${label}. ${describeStep(step, names)}`)
    if (step.step_type === 'condition') {
      const yes = step.branches?.yes ?? []
      const no = step.branches?.no ?? []
      if (yes.length) {
        out.push(`${label}.sim →`)
        out.push(...describeSteps(yes, names, `${label}.s`).map((l) => `   ${l}`))
      }
      if (no.length) {
        out.push(`${label}.não →`)
        out.push(...describeSteps(no, names, `${label}.n`).map((l) => `   ${l}`))
      }
    }
  })
  return out
}

/** Does any step (in any branch) talk to the customer? */
export function stepsSendToCustomer(steps: StepLike[]): boolean {
  return steps.some(
    (s) =>
      ['send_message', 'send_buttons', 'send_list', 'send_template', 'agent_handoff'].includes(s.step_type) ||
      stepsSendToCustomer(s.branches?.yes ?? []) ||
      stepsSendToCustomer(s.branches?.no ?? []),
  )
}

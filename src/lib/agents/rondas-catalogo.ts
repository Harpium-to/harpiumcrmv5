// ============================================================
// The rounds an agent can do — docs/plano-agentes-ativos.md, Fase 2.
//
// Each kind is a cheap database query (rondas-checks.ts) that finds the
// cases, plus a starting instruction and schedule for the agent. Pure
// data: the screen offers these, the API validates against them.
// ============================================================

export type RondaKind =
  | 'conversas_sem_resposta'
  | 'lead_sem_contato'
  | 'orcamento_parado'
  | 'cliente_sumido'
  | 'reuniao_sem_confirmacao'
  | 'falta_na_agenda'
  | 'pos_venda'

export interface RondaParam {
  key: string
  label: string
  min: number
  max: number
  default: number
}

export interface RondaPreset {
  kind: RondaKind
  name: string
  /** One sentence: what it looks for. */
  description: string
  /** The functions it suits, for the suggestion on the screen. */
  roles: string[]
  param: RondaParam | null
  instruction: string
  /** Default schedule: every N minutes on shift, or daily at HH:MM. */
  everyMinutes: number | null
  runAt: string | null
  /** Ask a person before re-contacting the same case this often (days). */
  coolDownDays: number
}

export const RONDA_PRESETS: RondaPreset[] = [
  {
    kind: 'conversas_sem_resposta',
    name: 'Conversas sem resposta',
    description: 'Conversas em que o cliente escreveu por último, sem ninguém responsável e sem resposta há algumas horas.',
    roles: ['frontdesk', 'techsupport', 'billing', 'scheduler', 'sdr'],
    param: { key: 'horas', label: 'Sem resposta há (horas)', min: 1, max: 72, default: 2 },
    instruction:
      'Leia a conversa e responda o que ficou sem resposta. Se for algo que você não sabe ou que pede uma pessoa, chame uma pessoa com o motivo.',
    everyMinutes: 30,
    runAt: null,
    coolDownDays: 1,
  },
  {
    kind: 'lead_sem_contato',
    name: 'Lead novo sem primeiro contato',
    description: 'Leads que chegaram nos últimos 3 dias e ainda não receberam nenhuma mensagem da empresa.',
    roles: ['sdr', 'frontdesk'],
    param: { key: 'minutos', label: 'Sem contato há (minutos)', min: 5, max: 1440, default: 15 },
    instruction:
      'Faça o primeiro contato: diga quem você é, mencione o que o lead pediu (formulário, quiz ou anúncio) e termine com uma pergunta simples.',
    everyMinutes: 15,
    runAt: null,
    coolDownDays: 3,
  },
  {
    kind: 'orcamento_parado',
    name: 'Orçamento parado',
    description: 'Negócios abertos sem nenhuma mudança há alguns dias.',
    roles: ['followup', 'executive', 'closer', 'sdr'],
    param: { key: 'dias', label: 'Parado há (dias)', min: 1, max: 60, default: 3 },
    instruction:
      'Veja em que pé o negócio parou e retome com algo novo e útil (não "passando para saber se viu"). Se o cliente já disse não, anote o motivo e não escreva.',
    everyMinutes: null,
    runAt: '10:00',
    coolDownDays: 3,
  },
  {
    kind: 'cliente_sumido',
    name: 'Cliente que sumiu',
    description: 'Conversas em que a empresa falou por último e o cliente não respondeu há alguns dias.',
    roles: ['followup', 'sdr'],
    param: { key: 'dias', label: 'Sem resposta do cliente há (dias)', min: 1, max: 30, default: 5 },
    instruction:
      'Entenda por que a conversa parou e retome com uma mensagem curta e diferente da anterior. Depois de três tentativas sem resposta, encerre e anote.',
    everyMinutes: null,
    runAt: '14:00',
    coolDownDays: 4,
  },
  {
    kind: 'reuniao_sem_confirmacao',
    name: 'Compromisso de amanhã sem confirmação',
    description: 'Compromissos da agenda nas próximas 12 a 36 horas que o cliente ainda não confirmou.',
    roles: ['scheduler', 'frontdesk', 'sdr'],
    param: null,
    instruction:
      'Confirme o compromisso com o cliente (dia, hora e local). Se ele quiser remarcar, chame uma pessoa ou anote o pedido.',
    everyMinutes: null,
    runAt: '17:00',
    coolDownDays: 1,
  },
  {
    kind: 'falta_na_agenda',
    name: 'Falta na agenda',
    description: 'Clientes marcados como falta nos últimos 3 dias.',
    roles: ['scheduler', 'frontdesk', 'followup'],
    param: null,
    instruction: 'Escreva com gentileza, sem cobrar, e ofereça remarcar. Se o cliente aceitar, chame uma pessoa para marcar.',
    everyMinutes: null,
    runAt: '11:00',
    coolDownDays: 3,
  },
  {
    kind: 'pos_venda',
    name: 'Pós-venda',
    description: 'Clientes que fecharam negócio há alguns dias.',
    roles: ['success', 'followup'],
    param: { key: 'dias', label: 'Fechou há (dias)', min: 1, max: 365, default: 30 },
    instruction:
      'Pergunte como está a experiência com o que comprou e se precisa de algo. Se houver reclamação, chame uma pessoa.',
    everyMinutes: null,
    runAt: '10:30',
    coolDownDays: 30,
  },
]

const BY_KIND = new Map(RONDA_PRESETS.map((p) => [p.kind, p]))

export function rondaPreset(kind: string): RondaPreset | undefined {
  return BY_KIND.get(kind as RondaKind)
}

export function isRondaKind(kind: unknown): kind is RondaKind {
  return typeof kind === 'string' && BY_KIND.has(kind as RondaKind)
}

/** The round's knob, clamped to its range, or its default. */
export function rondaParam(kind: string, params: Record<string, unknown> | null | undefined): number | null {
  const preset = rondaPreset(kind)
  if (!preset?.param) return null
  const raw = Number(params?.[preset.param.key])
  if (!Number.isFinite(raw)) return preset.param.default
  return Math.min(preset.param.max, Math.max(preset.param.min, Math.round(raw)))
}

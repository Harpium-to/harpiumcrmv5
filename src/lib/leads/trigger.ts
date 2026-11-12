// ============================================================
// The "lead recebido" event — pure, unit-tested, no I/O.
//
// After a lead is written, the CRM fires one event with what flows
// filter on: origin, route and tags. Automations with the
// `lead_received` trigger pick the leads they want (e.g. origin
// "quiz-planejados" + tag "rota-a"), and the "pass to AI agent" step
// hands the contact to the Agent SDR with the quiz answers as its
// briefing, so the first message opens with context.
// ============================================================

import type { LeadReceivedTriggerConfig } from '@/types'
import { leadTags, slugify, type LeadAnswer, type LeadRoute, type NormalizedLead } from './parse'

/** What a lead_received automation run knows about the lead. */
export interface LeadEventContext {
  lead_id: string
  /** `leads.source`: the origin slug, or meta / google / other. */
  source: string
  origem: string | null
  rota: LeadRoute | null
  /** Every tag the lead put on the contact, route tag included. */
  etiquetas: string[]
  nome: string | null
  empresa: string | null
  campanha: string | null
  respostas: LeadAnswer[]
  nota: string | null
  /** False only when the lead explicitly refused contact. */
  consentimento: boolean | null
}

const MAX_CONTEXT_ANSWERS = 30

export function buildLeadEventContext(lead: NormalizedLead, leadId: string): LeadEventContext {
  return {
    lead_id: leadId,
    source: lead.source,
    origem: lead.origin,
    rota: lead.route,
    etiquetas: leadTags(lead),
    nome: lead.fullName,
    empresa: lead.company,
    campanha: lead.campaign,
    respostas: lead.answers.slice(0, MAX_CONTEXT_ANSWERS),
    nota: lead.note,
    consentimento: lead.consent?.accepted ?? null,
  }
}

function cleanList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
}

/** Does this lead pass the automation's filters? */
export function leadMatchesTrigger(
  config: unknown,
  lead: LeadEventContext | undefined,
): boolean {
  if (!lead) return false
  const cfg = (config ?? {}) as LeadReceivedTriggerConfig

  const origins = cleanList(cfg.origens).map(slugify).filter(Boolean)
  if (origins.length > 0) {
    const mine = new Set([slugify(lead.source), lead.origem ? slugify(lead.origem) : ''])
    if (!origins.some((o) => mine.has(o))) return false
  }

  const route = typeof cfg.rota === 'string' ? cfg.rota.trim().toUpperCase() : ''
  if (route && lead.rota !== route) return false

  const required = cleanList(cfg.etiquetas).map((t) => t.toLowerCase())
  if (required.length > 0) {
    const have = new Set(lead.etiquetas.map((t) => t.toLowerCase()))
    if (!required.every((t) => have.has(t))) return false
  }
  return true
}

/**
 * `{{ vars.* }}` values a lead_received message can use:
 * {{ vars.nome }}, {{ vars.primeiro_nome }}, {{ vars.empresa }},
 * {{ vars.origem }}, {{ vars.rota }}, {{ vars.campanha }}.
 */
export function leadVars(lead: LeadEventContext): Record<string, string> {
  const nome = lead.nome ?? ''
  return {
    nome,
    primeiro_nome: nome.split(/\s+/)[0] ?? '',
    empresa: lead.empresa ?? '',
    origem: lead.origem ?? lead.source,
    rota: lead.rota ?? '',
    campanha: lead.campanha ?? '',
  }
}

/**
 * The briefing an AI agent receives with the contact: where the lead
 * came from and everything it answered. Each key is one line of the
 * agent's prompt (see briefFromTask in agents/runner.ts).
 */
export function handoffInput(
  lead: LeadEventContext | undefined,
  instruction: string | null | undefined,
): Record<string, string> {
  const input: Record<string, string> = {}
  if (lead) {
    input.motivo = `Lead recebido pela URL de leads (origem: ${lead.origem ?? lead.source})`
    if (lead.rota) input.rota = lead.rota
    if (lead.etiquetas.length) input.etiquetas = lead.etiquetas.join(', ')
    if (lead.campanha) input.campanha = lead.campanha
    if (lead.respostas.length) {
      input.respostas_do_lead = lead.respostas
        .map((a) => `${a.pergunta}: ${a.resposta}`)
        .join(' | ')
    }
    if (lead.nota) input.observacao_do_lead = lead.nota
    input.como_abrir =
      'Abra a conversa citando algo concreto que o lead respondeu, para mostrar que você leu. Uma pergunta só.'
  }
  const extra = (instruction ?? '').trim()
  if (extra) input.instrucao = extra
  return input
}

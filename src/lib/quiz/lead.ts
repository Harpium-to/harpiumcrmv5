// ============================================================
// A finished visit as a lead, in the Harpium Lead v1 format the CRM's
// own receiver reads (docs/recebimento-universal-de-leads.md).
//
// The quiz hands this to the same code a webhook delivery goes through
// (src/lib/leads): the contact is created or updated, the tags and the
// route are applied, the answers fill custom fields, the card lands in
// the funnel and "lead recebido" fires for automations and the Agent
// SDR. Nothing about a quiz lead is special once it is in.
//
// Pure — no I/O.
// ============================================================

import { answerLines, contactFrom, type QuizOutcome } from './engine'
import type { QuizAnswers, QuizDefinition } from './types'

export interface LeadSource {
  quizName: string
  sid: string
  answers: QuizAnswers
  utms: Record<string, string>
  /** When the consent line was accepted (ISO), if the quiz shows one. */
  consentAt?: string | null
}

/** "Palmas / TO", "Palmas-TO", "Palmas, TO" → city + state. */
export function splitCity(text = ''): { city: string; uf: string } {
  const m = text.trim().match(/^(.*?)\s*[/,-]\s*([A-Za-z]{2})$/)
  return m ? { city: m[1].trim(), uf: m[2].toUpperCase() } : { city: text.trim(), uf: '' }
}

export const PARTIAL_TAG = 'quiz-incompleto'

/**
 * `outcome` null = a partial lead: someone who left a contact and
 * stopped. It carries the answers given so far, the tag
 * "quiz-incompleto" and no route.
 */
export function buildLeadPayload(
  def: QuizDefinition,
  source: LeadSource,
  outcome: QuizOutcome | null,
  stoppedAt?: string | null,
): Record<string, unknown> {
  const contact = contactFrom(def, source.answers)
  const { city, uf } = splitCity(contact.city)
  const u = source.utms

  const payload: Record<string, unknown> = {
    versao: '1',
    origem: source.quizName,
    formulario: source.quizName,
    // A partial lead and the finished one are two deliveries.
    id_externo: outcome ? source.sid : `${source.sid}:parcial`,
    contato: {
      nome: contact.name ?? '',
      telefone: contact.phone ?? '',
      email: contact.email ?? '',
      empresa: contact.company ?? '',
      cidade: city,
      uf,
      instagram: contact.instagram ?? '',
    },
    campanha: {
      nome: u.utm_campaign ?? '',
      anuncio: u.utm_content ?? '',
      utm_source: u.utm_source ?? '',
      utm_medium: u.utm_medium ?? '',
      utm_campaign: u.utm_campaign ?? '',
      utm_content: u.utm_content ?? '',
      utm_term: u.utm_term ?? '',
      fbclid: u.fbclid ?? '',
      gclid: u.gclid ?? '',
    },
    etiquetas: outcome ? outcome.tags : [...def.settings.tags, PARTIAL_TAG],
    respostas: answerLines(def, source.answers).map((line) => ({
      pergunta: line.question,
      resposta: line.answer,
    })),
    nota: outcome
      ? `${source.quizName} · Resultado: ${outcome.result.name}`
      : `${source.quizName} · Não concluiu${stoppedAt ? ` (parou em "${stoppedAt}")` : ''}`,
  }

  if (outcome) {
    payload.qualificacao = {
      rota: outcome.route,
      qualificado: outcome.route === 'A',
      motivos: outcome.reasons,
    }
  }
  if (def.settings.consentText && source.consentAt) {
    payload.consentimento = {
      aceito: true,
      texto: def.settings.consentText,
      em: source.consentAt,
    }
  }
  return payload
}

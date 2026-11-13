// ============================================================
// The quiz models that ship with the CRM, in the order "Novo quiz"
// shows them:
//
//   1. by niche — one per kind of business the agency serves;
//   2. general — a contact form, a satisfaction survey, a blank quiz;
//   3. Harpium's own — the furniture-store qualification quiz, last on
//      purpose: it is the agency's demand, not a model for its clients.
//
// The models themselves live in ./models. Every one goes through
// sanitizeDefinition here, so a typo cannot produce a quiz the player
// cannot run, and models.test.ts checks each one end to end.
// ============================================================

import type { CrmNiche } from '@/lib/agencia/crm'

import { ACADEMIA, ADVOCACIA, EDUCACAO, IMOBILIARIA } from './models/servicos-locais'
import { CLINICA_MEDICA, ESTETICA, ODONTOLOGIA } from './models/saude'
import { ENERGIA_SOLAR, SERVICOS_B2B, VAREJO } from './models/comercio'
import { EM_BRANCO, FORMULARIO_CONTATO, PESQUISA_NPS } from './models/gerais'
import { MOVEIS_PLANEJADOS } from './models/planejados'
import type { QuizModelGroup, QuizModelIcon, QuizModelSummary } from './model-meta'
import { sanitizeDefinition } from './validate'
import type { QuizDefinition } from './types'

export { MODEL_GROUP_LABEL } from './model-meta'
export type { QuizModelGroup, QuizModelIcon, QuizModelSummary } from './model-meta'

export interface QuizModel {
  key: string
  /** The quiz's name when one is created from it. */
  name: string
  /** The business it is written for ("Clínica médica"); null for a general model. */
  segment: string | null
  description: string
  group: QuizModelGroup
  /** The CRM niche it fits, to suggest it first in a CRM of that niche. */
  niche?: CrmNiche
  icon: QuizModelIcon
  definition: QuizDefinition
}

interface ModelSource extends Omit<QuizModel, 'definition'> {
  definition: unknown
}

const SOURCES: ModelSource[] = [
  // ---- By niche ----
  {
    key: 'clinica-medica',
    name: 'Agendamento de consulta',
    segment: 'Clínica médica',
    description:
      'Motivo da consulta, urgência, particular ou convênio e o melhor período. Quem está com dor chega marcado como urgente e vê o aviso do pronto-socorro.',
    group: 'nicho',
    niche: 'medical_clinic',
    icon: 'stethoscope',
    definition: CLINICA_MEDICA,
  },
  {
    key: 'odontologia',
    name: 'Avaliação odontológica',
    segment: 'Odontologia',
    description:
      'Tratamento de interesse, prazo e forma de pagamento. Implante, estética e aparelho com prazo curto chegam como qualificados.',
    group: 'nicho',
    niche: 'dental_aesthetic',
    icon: 'smile',
    definition: ODONTOLOGIA,
  },
  {
    key: 'estetica',
    name: 'Avaliação estética',
    segment: 'Clínica de estética',
    description:
      'Área de interesse, experiência, prazo e investimento. Separa quem quer começar já de quem ainda está pesquisando.',
    group: 'nicho',
    niche: 'dental_aesthetic',
    icon: 'sparkles',
    definition: ESTETICA,
  },
  {
    key: 'academia',
    name: 'Aula experimental',
    segment: 'Academia e studio',
    description:
      'Objetivo, experiência, frequência, horário e quando quer começar. Cada objetivo vira uma etiqueta para a abordagem do time.',
    group: 'nicho',
    niche: 'gym',
    icon: 'dumbbell',
    definition: ACADEMIA,
  },
  {
    key: 'imobiliaria',
    name: 'Encontre seu imóvel',
    segment: 'Imobiliária',
    description:
      'Comprar, alugar, investir ou vender: cada caminho faz as próprias perguntas. Quem quer vender cai num resultado de captação.',
    group: 'nicho',
    niche: 'real_estate',
    icon: 'house',
    definition: IMOBILIARIA,
  },
  {
    key: 'advocacia',
    name: 'Triagem do caso',
    segment: 'Advocacia',
    description:
      'Área do direito, situação e urgência. Linguagem informativa, sem promessa de resultado, como pede a OAB (Provimento 205/2021).',
    group: 'nicho',
    niche: 'law',
    icon: 'scale',
    definition: ADVOCACIA,
  },
  {
    key: 'educacao',
    name: 'Descubra o curso ideal',
    segment: 'Escola e cursos',
    description:
      'Objetivo, área, formato, turno e orçamento. Quem quer a próxima turma e não precisa de bolsa chega como qualificado.',
    group: 'nicho',
    niche: 'education',
    icon: 'graduation',
    definition: EDUCACAO,
  },
  {
    key: 'varejo',
    name: 'Presente ideal + cupom',
    segment: 'Loja e e-commerce',
    description:
      'Recomendação de presente com cupom no final. Troque o cupom PRESENTE10 pelo da sua loja antes de publicar.',
    group: 'nicho',
    niche: 'retail',
    icon: 'shopping',
    definition: VAREJO,
  },
  {
    key: 'servicos-b2b',
    name: 'Diagnóstico para empresas',
    segment: 'Serviços para empresas',
    description:
      'Cargo, porte, faturamento, desafio, prazo e investimento. Qualificação A, B e C para qualquer serviço vendido a empresas.',
    group: 'nicho',
    niche: 'services',
    icon: 'briefcase',
    definition: SERVICOS_B2B,
  },
  {
    key: 'energia-solar',
    name: 'Simulação de economia',
    segment: 'Energia solar',
    description:
      'Onde instalar, valor da conta de luz, imóvel próprio e forma de pagamento. Conta alta e prazo curto chegam como qualificados.',
    group: 'nicho',
    icon: 'sun',
    definition: ENERGIA_SOLAR,
  },
  // ---- General ----
  {
    key: 'formulario-contato',
    name: 'Formulário de contato',
    segment: null,
    description: 'Uma tela só: nome, WhatsApp, e-mail e uma mensagem. Para o site e o link da bio.',
    group: 'geral',
    icon: 'mail',
    definition: FORMULARIO_CONTATO,
  },
  {
    key: 'pesquisa-satisfacao',
    name: 'Pesquisa de satisfação',
    segment: null,
    description:
      'NPS de 0 a 10, o motivo da nota e um contato opcional. Separa promotores, neutros e detratores, e convida os promotores a avaliar no Google.',
    group: 'geral',
    icon: 'star',
    definition: PESQUISA_NPS,
  },
  {
    key: 'em-branco',
    name: 'Em branco',
    segment: null,
    description: 'Entrada, nome, uma pergunta de exemplo e o contato. O resto é com você.',
    group: 'geral',
    icon: 'blank',
    definition: EM_BRANCO,
  },
  // ---- Harpium's own, always last ----
  {
    key: 'moveis-planejados',
    // The leads arrive with this name as their origin. "Quiz planejados"
    // slugifies to quiz-planejados, the origin the old site sent and the
    // agency's SDR automation filters by.
    name: 'Quiz planejados',
    segment: 'Móveis planejados',
    description:
      'O quiz que a Harpium usa para qualificar lojas de móveis planejados para a assessoria. Uso interno: não é um modelo para os clientes.',
    group: 'interno',
    icon: 'sofa',
    definition: MOVEIS_PLANEJADOS,
  },
]

export const QUIZ_MODELS: QuizModel[] = SOURCES.map((source) => ({
  ...source,
  definition: sanitizeDefinition(source.definition),
}))

export function findQuizModel(key: string): QuizModel | undefined {
  return QUIZ_MODELS.find((m) => m.key === key)
}

export function summarizeModel(model: QuizModel): QuizModelSummary {
  return {
    key: model.key,
    name: model.name,
    segment: model.segment,
    description: model.description,
    group: model.group,
    niche: model.niche ?? null,
    icon: model.icon,
    questions: model.definition.steps.length,
    results: model.definition.results.map((r) => ({ name: r.name, route: r.route })),
  }
}

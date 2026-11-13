// ============================================================
// General models, for any business: a contact form, a satisfaction
// survey (NPS) and a blank quiz to start from.
// ============================================================

import { options, PIXEL_NONE } from './shared'

export const FORMULARIO_CONTATO = {
  version: 1,
  intro: { enabled: false, headline: '', cta: 'Começar', bullets: [] },
  steps: [
    {
      id: 'contato',
      type: 'fields',
      label: 'Contato',
      title: 'Fale com a gente',
      note: 'Preencha os dados e a nossa equipe chama você no WhatsApp.',
      cta: 'Enviar',
      fields: [
        { id: 'nome', kind: 'name', label: 'Nome', placeholder: 'Seu nome', required: true },
        { id: 'whatsapp', kind: 'phone', label: 'WhatsApp', placeholder: '(11) 91234-5678', required: true },
        { id: 'email', kind: 'email', label: 'E-mail', placeholder: 'voce@email.com', required: false },
        { id: 'mensagem', kind: 'longtext', label: 'Como podemos ajudar?', required: false },
      ],
    },
  ],
  results: [
    {
      id: 'obrigado',
      name: 'Obrigado',
      route: 'B',
      tags: [],
      pixel: { kind: 'standard', name: 'Lead' },
      icon: 'check',
      title: 'Recebemos, {nome}.',
      blocks: [
        { id: 'o1', type: 'text', text: 'Nossa equipe vai chamar você no WhatsApp **{whatsapp}** em breve.' },
      ],
    },
  ],
  rules: [],
  defaultResultId: 'obrigado',
  tagRules: [],
  appearance: { accent: '#22ced2' },
  settings: { tags: ['formulario'], submittingText: 'Enviando…' },
}

export const EM_BRANCO = {
  version: 1,
  intro: {
    enabled: true,
    headline: 'Escreva aqui a pergunta que faz a pessoa querer começar',
    sub: 'Uma linha dizendo o que ela ganha ao responder.',
    cta: 'Começar',
    bullets: [],
  },
  steps: [
    {
      id: 'nome',
      type: 'fields',
      label: 'Nome',
      title: 'Como posso te chamar?',
      cta: 'Continuar',
      fields: [{ id: 'primeiro_nome', kind: 'name', label: 'Nome', placeholder: 'Seu primeiro nome', required: true }],
    },
    {
      id: 'pergunta1',
      type: 'choice',
      label: 'Primeira pergunta',
      title: 'Prazer, {nome}. Qual é a sua primeira pergunta?',
      options: options([
        ['a', 'Primeira opção'],
        ['b', 'Segunda opção'],
      ]),
    },
    {
      id: 'contato',
      type: 'fields',
      label: 'Contato',
      title: 'Pronto, {nome}. Para onde enviamos o resultado?',
      cta: 'Ver meu resultado',
      fields: [{ id: 'whatsapp', kind: 'phone', label: 'WhatsApp', placeholder: '(11) 91234-5678', required: true }],
    },
  ],
  results: [
    {
      id: 'obrigado',
      name: 'Obrigado',
      route: 'B',
      tags: [],
      pixel: { kind: 'standard', name: 'Lead' },
      icon: 'check',
      title: 'Recebemos suas respostas, {nome}.',
      blocks: [{ id: 'o1', type: 'text', text: 'Nossa equipe vai falar com você em breve.' }],
    },
  ],
  rules: [],
  defaultResultId: 'obrigado',
  tagRules: [],
  appearance: { accent: '#22ced2' },
  settings: { tags: [], submittingText: 'Montando seu resultado…' },
}

// ------------------------------------------------------------
// Pesquisa de satisfação (NPS)
// ------------------------------------------------------------

/** "De 0 a 10": the scale the Net Promoter Score uses. */
const NOTAS: [string, string][] = Array.from({ length: 11 }, (_, i) => {
  const label = i === 0 ? '0 · Nada provável' : i === 10 ? '10 · Muito provável' : String(i)
  return [`n${i}`, label]
})

export const PESQUISA_NPS = {
  version: 1,
  intro: {
    enabled: true,
    tag: 'Leva 30 segundos',
    headline: 'Como foi a sua experiência com a gente?',
    sub: 'São 3 perguntas rápidas. A sua resposta ajuda a melhorar o nosso atendimento.',
    cta: 'Responder',
    bullets: [],
  },
  steps: [
    {
      id: 'nota',
      type: 'choice',
      label: 'Nota (NPS)',
      title: 'De 0 a 10, quanto você recomendaria a nossa empresa para um amigo?',
      options: options(NOTAS),
    },
    {
      id: 'motivo',
      type: 'fields',
      label: 'Motivo da nota',
      title: 'O que mais pesou na sua nota?',
      note: 'Opcional, mas ajuda muito.',
      cta: 'Continuar',
      fields: [
        {
          id: 'comentario',
          kind: 'longtext',
          label: 'Comentário',
          placeholder: 'Conte em poucas palavras',
          required: false,
        },
      ],
    },
    {
      id: 'contato',
      type: 'fields',
      label: 'Contato',
      title: 'Quer que a gente fale com você sobre isso?',
      note: 'Opcional. Deixe o seu WhatsApp se quiser um retorno.',
      cta: 'Enviar',
      fields: [
        { id: 'nome', kind: 'name', label: 'Nome', placeholder: 'Seu nome', required: false },
        { id: 'whatsapp', kind: 'phone', label: 'WhatsApp', placeholder: '(11) 91234-5678', required: false },
      ],
    },
  ],
  results: [
    {
      id: 'promotor',
      name: 'Promotor (9 e 10)',
      route: 'A',
      tags: ['nps:promotor'],
      pixel: PIXEL_NONE,
      icon: 'gift',
      title: 'Muito obrigado, {nome}!',
      blocks: [
        {
          id: 'p1',
          type: 'text',
          text: 'Ficamos muito felizes com a sua nota. Se puder, conte a sua experiência no Google: isso ajuda outras pessoas a encontrarem a gente.',
        },
        { id: 'p2', type: 'button', label: 'Avaliar no Google', kind: 'link', url: '' },
      ],
    },
    {
      id: 'neutro',
      name: 'Neutro (7 e 8)',
      route: 'B',
      tags: ['nps:neutro'],
      pixel: PIXEL_NONE,
      icon: 'bulb',
      title: 'Obrigado pela sua resposta, {nome}!',
      blocks: [
        {
          id: 'n1',
          type: 'text',
          text: 'Vamos usar o seu comentário para melhorar. Se quiser contar mais, é só chamar a gente no WhatsApp.',
        },
      ],
    },
    {
      id: 'detrator',
      name: 'Detrator (0 a 6)',
      route: 'C',
      tags: ['nps:detrator'],
      pixel: PIXEL_NONE,
      icon: 'message',
      title: 'Obrigado pela sinceridade, {nome}.',
      blocks: [
        {
          id: 'd1',
          type: 'text',
          text: 'Sentimos muito que a sua experiência não tenha sido boa. Se você deixou o seu WhatsApp, alguém da nossa equipe vai entrar em contato para entender o que aconteceu.',
        },
      ],
    },
  ],
  rules: [
    {
      id: 'regra_promotor',
      resultId: 'promotor',
      match: 'any',
      conditions: [{ stepId: 'nota', op: 'is', optionIds: ['n9', 'n10'] }],
    },
    {
      id: 'regra_detrator',
      resultId: 'detrator',
      match: 'any',
      conditions: [{ stepId: 'nota', op: 'is', optionIds: ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6'] }],
    },
  ],
  defaultResultId: 'neutro',
  tagRules: [],
  appearance: { accent: '#22ced2' },
  settings: { tags: ['pesquisa-nps'], submittingText: 'Enviando…' },
}

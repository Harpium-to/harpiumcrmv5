// ============================================================
// Models for health and aesthetics: medical clinic, dentistry and
// aesthetic clinic.
//
// Written to stay within what the councils allow in advertising (CFM,
// CFO): no promise of result, no before-and-after, no price as bait.
// The texts inform and invite to an appointment.
// ============================================================

import {
  contactStep,
  EMAIL_OPTIONAL,
  is,
  isNot,
  nameStep,
  options,
  PIXEL_COLD,
  PIXEL_LEAD,
  PIXEL_WARM,
  tagPerOption,
  WHATSAPP,
  whatsappButton,
} from './shared'

/** Health data is sensitive under the LGPD: the consent line goes with the lead. */
const HEALTH_CONSENT =
  'Ao enviar, você autoriza o uso destas informações para organizar o seu atendimento e entrar em contato pelo WhatsApp.'

// ------------------------------------------------------------
// Clínica médica · agendamento de consulta
// ------------------------------------------------------------

export const CLINICA_MEDICA = {
  version: 1,
  intro: {
    enabled: true,
    tag: 'Agendamento online',
    headline: 'Agende a sua consulta em menos de 1 minuto',
    sub: 'Responda 5 perguntas rápidas e a nossa equipe confirma o melhor horário com você pelo WhatsApp.',
    cta: 'Quero agendar',
    bullets: [
      { strong: 'Leva menos de 1 minuto:', text: 'são só 5 perguntas' },
      { strong: 'Confirmação pelo WhatsApp,', text: 'sem esperar ao telefone' },
      { strong: 'Seus dados ficam protegidos:', text: 'usados só para o seu atendimento' },
    ],
  },
  steps: [
    nameStep(),
    {
      id: 'motivo',
      type: 'choice',
      label: 'Motivo da consulta',
      title: 'Prazer, {nome}. O que te traz até a gente?',
      options: options([
        ['primeira', 'Primeira consulta ou check-up'],
        ['retorno', 'Retorno ou acompanhamento de tratamento'],
        ['sintoma', 'Estou sentindo algo e quero investigar'],
        ['exames', 'Quero mostrar resultados de exames'],
        ['outro', 'Outro motivo'],
      ]),
    },
    {
      id: 'urgencia',
      type: 'choice',
      label: 'Urgência',
      title: 'Para quando você precisa da consulta?',
      options: options([
        ['hoje', 'O quanto antes: estou com dor ou desconforto'],
        ['semana', 'Nesta semana'],
        ['mes', 'Nas próximas semanas'],
        ['sem_pressa', 'Sem pressa, só quero me informar'],
      ]),
    },
    {
      id: 'pagamento',
      type: 'choice',
      label: 'Forma de atendimento',
      title: 'Você prefere atendimento particular ou pelo convênio?',
      options: options([
        ['particular', 'Particular'],
        ['convenio', 'Convênio'],
        ['nao_sei', 'Ainda não sei'],
      ]),
    },
    {
      id: 'convenio',
      type: 'fields',
      label: 'Convênio',
      title: 'Qual é o seu convênio?',
      note: 'Assim a equipe já confere a cobertura antes de falar com você.',
      cta: 'Continuar',
      fields: [
        {
          id: 'convenio_nome',
          kind: 'text',
          label: 'Convênio e plano',
          placeholder: 'Ex.: Unimed Nacional',
          required: true,
        },
      ],
      showIf: [is('pagamento', 'convenio')],
    },
    {
      id: 'periodo',
      type: 'choice',
      label: 'Melhor período',
      title: 'Qual período fica melhor para você?',
      options: options([
        ['manha', 'Manhã'],
        ['tarde', 'Tarde'],
        ['noite', 'Noite'],
        ['qualquer', 'Qualquer horário'],
      ]),
    },
    contactStep(
      'Pronto, {nome}. Para qual WhatsApp enviamos os horários disponíveis?',
      'Pedir meu horário',
      [WHATSAPP, EMAIL_OPTIONAL],
    ),
  ],
  results: [
    {
      id: 'prioridade',
      name: 'Qualificado · quer agendar',
      route: 'A',
      tags: [],
      pixel: PIXEL_LEAD,
      icon: 'message',
      title: '{nome}, recebemos o seu pedido de consulta.',
      blocks: [
        {
          id: 'p1',
          type: 'text',
          text: 'Nossa equipe vai te chamar no WhatsApp **{whatsapp}** para confirmar o dia e o horário.',
        },
        {
          id: 'p2',
          type: 'highlight',
          icon: 'bulb',
          text: '**Se a dor for forte ou piorar, não espere o nosso retorno:** procure um pronto-socorro ou ligue 192.',
          showIf: [is('urgencia', 'hoje')],
        },
        whatsappButton('p3'),
      ],
    },
    {
      id: 'orientar',
      name: 'Morno · precisa de orientação',
      route: 'B',
      tags: [],
      pixel: PIXEL_WARM,
      icon: 'bulb',
      title: '{nome}, vamos te ajudar a escolher o melhor caminho.',
      blocks: [
        {
          id: 'o1',
          type: 'text',
          text: 'Nossa equipe vai te chamar no WhatsApp para explicar os valores, as formas de pagamento e os horários disponíveis.',
        },
        {
          id: 'o3',
          type: 'highlight',
          icon: 'bulb',
          text: '**Se a dor for forte ou piorar, não espere o nosso retorno:** procure um pronto-socorro ou ligue 192.',
          showIf: [is('urgencia', 'hoje')],
        },
        whatsappButton('o2', 'Tirar uma dúvida agora'),
      ],
    },
    {
      id: 'informar',
      name: 'Frio · só se informando',
      route: 'C',
      tags: [],
      pixel: PIXEL_COLD,
      icon: 'check',
      title: 'Obrigado, {nome}.',
      blocks: [
        {
          id: 'i1',
          type: 'text',
          text: 'Quando quiser agendar, é só chamar a gente no WhatsApp. Guardamos as suas respostas para agilizar o atendimento.',
        },
        whatsappButton('i2', 'Chamar no WhatsApp'),
      ],
    },
  ],
  rules: [
    { id: 'regra_informar', resultId: 'informar', match: 'any', conditions: [is('urgencia', 'sem_pressa')] },
    {
      id: 'regra_prioridade',
      resultId: 'prioridade',
      match: 'all',
      conditions: [is('pagamento', 'particular', 'convenio')],
    },
  ],
  defaultResultId: 'orientar',
  tagRules: [
    { id: 'tag_urgente', tag: 'urgente', match: 'all', conditions: [is('urgencia', 'hoje')] },
    { id: 'tag_particular', tag: 'particular', match: 'all', conditions: [is('pagamento', 'particular')] },
    { id: 'tag_convenio', tag: 'convenio', match: 'all', conditions: [is('pagamento', 'convenio')] },
  ],
  appearance: { accent: '#0ea5e9' },
  settings: {
    tags: ['quiz-consulta'],
    submittingText: 'Enviando o seu pedido…',
    privacyNote: 'Seus dados são usados só para o seu atendimento.',
    consentText: HEALTH_CONSENT,
  },
}

// ------------------------------------------------------------
// Odontologia · avaliação
// ------------------------------------------------------------

export const ODONTOLOGIA = {
  version: 1,
  intro: {
    enabled: true,
    tag: 'Avaliação odontológica',
    headline: 'Descubra o tratamento certo para o seu sorriso',
    sub: 'Responda 5 perguntas e a nossa equipe te chama para agendar a sua avaliação.',
    cta: 'Começar',
    bullets: [
      { strong: 'Avaliação com dentista', text: 'antes de qualquer orçamento' },
      { strong: 'Retorno pelo WhatsApp,', text: 'sem ligação' },
    ],
  },
  steps: [
    nameStep(),
    {
      id: 'tratamento',
      type: 'choice',
      label: 'Tratamento de interesse',
      title: 'Prazer, {nome}. O que você gostaria de melhorar no seu sorriso?',
      options: options([
        ['implante', 'Repor dentes (implante ou prótese)'],
        ['estetica', 'Estética: lentes, facetas ou clareamento'],
        ['ortodontia', 'Alinhar os dentes (aparelho ou alinhadores)'],
        ['dor', 'Estou com dor ou um problema agora'],
        ['rotina', 'Limpeza e check-up'],
        ['outro', 'Outro'],
      ]),
    },
    {
      id: 'decisao',
      type: 'choice',
      label: 'O que pesa na decisão',
      title: 'O que mais pesa na sua escolha de um dentista?',
      options: options([
        ['confianca', 'Confiança no profissional'],
        ['resultado', 'O resultado estético'],
        ['preco', 'O preço e as condições de pagamento'],
        ['rapidez', 'A rapidez do tratamento'],
      ]),
    },
    {
      id: 'prazo',
      type: 'choice',
      label: 'Quando quer começar',
      title: 'Quando você gostaria de começar o tratamento?',
      options: options([
        ['ja', 'O quanto antes'],
        ['30dias', 'Nos próximos 30 dias'],
        ['meses', 'Daqui a alguns meses'],
        ['pesquisando', 'Só estou pesquisando'],
      ]),
    },
    {
      id: 'pagamento',
      type: 'choice',
      label: 'Forma de pagamento',
      title: 'Como você prefere pagar?',
      options: options([
        ['avista', 'À vista, com desconto'],
        ['cartao', 'Parcelado no cartão'],
        ['boleto', 'Parcelado no boleto ou carnê'],
        ['convenio', 'Pelo convênio odontológico'],
      ]),
    },
    contactStep(
      '{nome}, para qual WhatsApp enviamos os horários de avaliação?',
      'Quero minha avaliação',
    ),
  ],
  results: [
    {
      id: 'qualificado',
      name: 'Qualificado · tratamento e prazo',
      route: 'A',
      tags: [],
      pixel: PIXEL_LEAD,
      icon: 'check',
      title: '{nome}, a sua avaliação está quase marcada.',
      blocks: [
        {
          id: 'q1',
          type: 'text',
          text: 'Nossa equipe vai te chamar no WhatsApp **{whatsapp}** para combinar o melhor dia.',
        },
        {
          id: 'q2',
          type: 'text',
          text: 'Na avaliação, o dentista examina, tira as suas dúvidas e explica as opções de tratamento e de pagamento, antes de qualquer decisão.',
        },
        {
          id: 'q3',
          type: 'highlight',
          icon: 'message',
          text: '**Está com muita dor?** Chame a gente agora pelo WhatsApp para vermos o primeiro horário disponível.',
          showIf: [is('tratamento', 'dor')],
        },
        whatsappButton('q4', 'Agendar pelo WhatsApp'),
      ],
    },
    {
      id: 'morno',
      name: 'Morno · quer entender valores',
      route: 'B',
      tags: [],
      pixel: PIXEL_WARM,
      icon: 'bulb',
      title: '{nome}, vamos te ajudar a planejar o seu tratamento.',
      blocks: [
        {
          id: 'm1',
          type: 'text',
          text: 'Nossa equipe vai te chamar no WhatsApp para explicar como funciona a avaliação e as formas de pagamento.',
        },
        whatsappButton('m2', 'Tirar uma dúvida agora'),
      ],
    },
    {
      id: 'pesquisando',
      name: 'Frio · só pesquisando',
      route: 'C',
      tags: [],
      pixel: PIXEL_COLD,
      icon: 'gift',
      title: 'Obrigado, {nome}!',
      blocks: [
        {
          id: 'f1',
          type: 'text',
          text: 'Quando decidir começar, é só chamar a gente. Guardamos as suas respostas para agilizar o seu atendimento.',
        },
        whatsappButton('f2', 'Chamar no WhatsApp'),
      ],
    },
  ],
  rules: [
    { id: 'regra_frio', resultId: 'pesquisando', match: 'any', conditions: [is('prazo', 'pesquisando')] },
    {
      id: 'regra_qualificado',
      resultId: 'qualificado',
      match: 'all',
      conditions: [is('tratamento', 'implante', 'estetica', 'ortodontia', 'dor'), is('prazo', 'ja', '30dias')],
    },
  ],
  defaultResultId: 'morno',
  tagRules: [
    { id: 'tag_implante', tag: 'implante', match: 'all', conditions: [is('tratamento', 'implante')] },
    { id: 'tag_estetica', tag: 'estetica-dental', match: 'all', conditions: [is('tratamento', 'estetica')] },
    { id: 'tag_ortodontia', tag: 'ortodontia', match: 'all', conditions: [is('tratamento', 'ortodontia')] },
    { id: 'tag_urgente', tag: 'urgente', match: 'all', conditions: [is('tratamento', 'dor')] },
    { id: 'tag_convenio', tag: 'convenio', match: 'all', conditions: [is('pagamento', 'convenio')] },
  ],
  appearance: { accent: '#14b8a6' },
  settings: {
    tags: ['quiz-odonto'],
    submittingText: 'Enviando…',
    privacyNote: 'Seus dados são usados só para o seu atendimento.',
    consentText: HEALTH_CONSENT,
  },
}

// ------------------------------------------------------------
// Estética · avaliação personalizada
// ------------------------------------------------------------

const AREAS: [string, string][] = [
  ['rosto', 'rosto'],
  ['corpo', 'corpo'],
  ['laser', 'laser'],
  ['harmonizacao', 'harmonizacao'],
  ['cabelo', 'cabelo'],
]

export const ESTETICA = {
  version: 1,
  intro: {
    enabled: true,
    tag: 'Avaliação personalizada',
    headline: 'Descubra o tratamento ideal para o seu objetivo',
    sub: 'Responda algumas perguntas e receba uma indicação personalizada da nossa equipe.',
    cta: 'Fazer minha avaliação',
    bullets: [
      { strong: 'Indicação personalizada', text: 'para o que você quer tratar' },
      { strong: 'Leva menos de 1 minuto', text: '' },
    ],
  },
  steps: [
    nameStep(),
    {
      id: 'area',
      type: 'choice',
      label: 'Área de interesse',
      title: 'Prazer, {nome}. O que você gostaria de tratar?',
      options: options([
        ['rosto', 'Rosto: manchas, rugas ou flacidez'],
        ['corpo', 'Corpo: gordura localizada, celulite ou flacidez'],
        ['laser', 'Depilação a laser'],
        ['harmonizacao', 'Harmonização facial'],
        ['cabelo', 'Cabelo e couro cabeludo'],
        ['nao_sei', 'Ainda não sei, quero uma indicação'],
      ]),
    },
    {
      id: 'experiencia',
      type: 'choice',
      label: 'Experiência',
      title: 'Você já fez algum procedimento estético?',
      options: options([
        ['nunca', 'Nunca fiz'],
        ['gostei', 'Já fiz e gostei do resultado'],
        ['sem_resultado', 'Já fiz e não tive o resultado que esperava'],
      ]),
    },
    {
      id: 'prazo',
      type: 'choice',
      label: 'Quando quer começar',
      title: 'Quando você gostaria de começar?',
      options: options([
        ['semana', 'Ainda esta semana'],
        ['mes', 'Neste mês'],
        ['meses', 'Daqui a alguns meses'],
        ['pesquisando', 'Só estou pesquisando'],
      ]),
    },
    {
      id: 'investimento',
      type: 'choice',
      label: 'Investimento',
      title: 'Quanto você pretende investir no seu tratamento?',
      note: 'Serve só para indicarmos opções que caibam no seu planejamento.',
      options: options([
        ['ate300', 'Até R$ 300'],
        ['300a1000', 'De R$ 300 a R$ 1.000'],
        ['1000a3000', 'De R$ 1.000 a R$ 3.000'],
        ['3000mais', 'Acima de R$ 3.000'],
      ]),
    },
    contactStep('{nome}, para qual WhatsApp enviamos a sua indicação?', 'Ver minha indicação'),
  ],
  results: [
    {
      id: 'comecar',
      name: 'Qualificado · quer começar',
      route: 'A',
      tags: [],
      pixel: PIXEL_LEAD,
      icon: 'check',
      title: '{nome}, você já pode dar o primeiro passo.',
      blocks: [
        {
          id: 'c1',
          type: 'text',
          text: 'Nossa equipe vai te chamar no WhatsApp **{whatsapp}** para marcar a sua avaliação e montar o plano ideal para o seu objetivo.',
        },
        {
          id: 'c2',
          type: 'highlight',
          icon: 'bulb',
          text: '**Já fez e não teve resultado?** Conte na avaliação o que foi feito: isso ajuda a indicar um caminho diferente.',
          showIf: [is('experiencia', 'sem_resultado')],
        },
        whatsappButton('c3', 'Agendar minha avaliação'),
      ],
    },
    {
      id: 'planejando',
      name: 'Morno · ainda planejando',
      route: 'B',
      tags: [],
      pixel: PIXEL_WARM,
      icon: 'bulb',
      title: '{nome}, vamos montar um plano que caiba no seu momento.',
      blocks: [
        {
          id: 'p1',
          type: 'text',
          text: 'Nossa equipe vai te chamar no WhatsApp com as opções de tratamento e de pagamento para o seu objetivo.',
        },
        whatsappButton('p2', 'Tirar uma dúvida agora'),
      ],
    },
    {
      id: 'pesquisando',
      name: 'Frio · só pesquisando',
      route: 'C',
      tags: [],
      pixel: PIXEL_COLD,
      icon: 'gift',
      title: 'Obrigado, {nome}!',
      blocks: [
        {
          id: 'f1',
          type: 'text',
          text: 'Quando quiser começar, é só chamar a gente. Guardamos as suas respostas para agilizar o seu atendimento.',
        },
        whatsappButton('f2', 'Chamar no WhatsApp'),
      ],
    },
  ],
  rules: [
    { id: 'regra_frio', resultId: 'pesquisando', match: 'any', conditions: [is('prazo', 'pesquisando')] },
    {
      id: 'regra_comecar',
      resultId: 'comecar',
      match: 'all',
      conditions: [is('prazo', 'semana', 'mes'), isNot('investimento', 'ate300')],
    },
  ],
  defaultResultId: 'planejando',
  tagRules: [
    ...tagPerOption('area', 'interesse', AREAS),
    {
      id: 'tag_insatisfeito',
      tag: 'insatisfeito-anterior',
      match: 'all',
      conditions: [is('experiencia', 'sem_resultado')],
    },
  ],
  appearance: { accent: '#d946ef' },
  settings: {
    tags: ['quiz-estetica'],
    submittingText: 'Montando a sua indicação…',
    privacyNote: 'Seus dados são usados só para o seu atendimento.',
    consentText: HEALTH_CONSENT,
  },
}

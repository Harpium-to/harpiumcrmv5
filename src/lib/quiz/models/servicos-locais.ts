// ============================================================
// Models for local services: gym and studio, real estate, law firm
// and school or course.
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

// ------------------------------------------------------------
// Academia / Studio · aula experimental
// ------------------------------------------------------------

export const ACADEMIA = {
  version: 1,
  intro: {
    enabled: true,
    tag: 'Aula experimental',
    headline: 'Agende a sua aula experimental',
    sub: 'Conte o seu objetivo em 5 perguntas e a nossa equipe reserva o melhor horário para você.',
    cta: 'Quero minha aula',
    bullets: [
      { strong: 'Leva menos de 1 minuto:', text: 'são 5 perguntas' },
      { strong: 'Horário confirmado pelo WhatsApp', text: '' },
    ],
  },
  steps: [
    nameStep(),
    {
      id: 'objetivo',
      type: 'choice',
      label: 'Objetivo',
      title: 'Prazer, {nome}. Qual é o seu principal objetivo?',
      options: options([
        ['emagrecer', 'Emagrecer'],
        ['massa', 'Ganhar massa muscular'],
        ['condicionamento', 'Melhorar o condicionamento e a saúde'],
        ['dores', 'Diminuir dores e fortalecer o corpo'],
        ['bem_estar', 'Qualidade de vida e bem-estar'],
      ]),
    },
    {
      id: 'experiencia',
      type: 'choice',
      label: 'Experiência',
      title: 'Como está a sua rotina de treinos hoje?',
      options: options([
        ['nunca', 'Nunca treinei'],
        ['parei', 'Já treinei, mas parei'],
        ['outro_lugar', 'Treino em outro lugar hoje'],
      ]),
    },
    {
      id: 'frequencia',
      type: 'choice',
      label: 'Frequência',
      title: 'Quantas vezes por semana você quer treinar?',
      options: options([
        ['2x', '2 vezes'],
        ['3a4', '3 a 4 vezes'],
        ['5mais', '5 vezes ou mais'],
      ]),
    },
    {
      id: 'horario',
      type: 'choice',
      label: 'Horário preferido',
      title: 'Qual horário encaixa melhor na sua rotina?',
      options: options([
        ['cedo', 'Bem cedo (6h às 9h)'],
        ['almoco', 'Fim da manhã ou almoço'],
        ['tarde', 'À tarde'],
        ['noite', 'À noite (a partir das 18h)'],
      ]),
    },
    {
      id: 'prazo',
      type: 'choice',
      label: 'Quando quer começar',
      title: 'E quando você quer começar?',
      options: options([
        ['semana', 'Ainda esta semana'],
        ['mes', 'Ainda este mês'],
        ['pesquisando', 'Só estou pesquisando'],
      ]),
    },
    contactStep(
      '{nome}, para qual WhatsApp enviamos os horários da aula experimental?',
      'Reservar minha aula',
    ),
  ],
  results: [
    {
      id: 'reservar',
      name: 'Qualificado · começa esta semana',
      route: 'A',
      tags: [],
      pixel: PIXEL_LEAD,
      icon: 'check',
      title: '{nome}, a sua aula experimental está quase reservada!',
      blocks: [
        {
          id: 'r1',
          type: 'text',
          text: 'Nossa equipe vai te chamar no WhatsApp **{whatsapp}** para confirmar o dia e o horário.',
        },
        {
          id: 'r2',
          type: 'highlight',
          icon: 'bulb',
          text: '**Nunca treinou?** Sem problema: a aula experimental é adaptada ao seu ritmo.',
          showIf: [is('experiencia', 'nunca')],
        },
        whatsappButton('r3', 'Confirmar pelo WhatsApp'),
      ],
    },
    {
      id: 'este_mes',
      name: 'Morno · começa este mês',
      route: 'B',
      tags: [],
      pixel: PIXEL_WARM,
      icon: 'bulb',
      title: '{nome}, vamos deixar tudo pronto para você começar.',
      blocks: [
        {
          id: 'm1',
          type: 'text',
          text: 'Nossa equipe vai te chamar no WhatsApp com os planos e os horários disponíveis.',
        },
        whatsappButton('m2', 'Ver os planos no WhatsApp'),
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
          text: 'Quando quiser conhecer o espaço, é só chamar a gente no WhatsApp.',
        },
        whatsappButton('f2', 'Chamar no WhatsApp'),
      ],
    },
  ],
  rules: [
    { id: 'regra_frio', resultId: 'pesquisando', match: 'any', conditions: [is('prazo', 'pesquisando')] },
    { id: 'regra_reservar', resultId: 'reservar', match: 'any', conditions: [is('prazo', 'semana')] },
  ],
  defaultResultId: 'este_mes',
  tagRules: [
    ...tagPerOption('objetivo', 'objetivo', [
      ['emagrecer', 'emagrecer'],
      ['massa', 'massa'],
      ['condicionamento', 'condicionamento'],
      ['dores', 'dores'],
      ['bem_estar', 'bem-estar'],
    ]),
    { id: 'tag_iniciante', tag: 'iniciante', match: 'all', conditions: [is('experiencia', 'nunca')] },
    {
      id: 'tag_concorrente',
      tag: 'vem-de-outra-academia',
      match: 'all',
      conditions: [is('experiencia', 'outro_lugar')],
    },
  ],
  appearance: { accent: '#f97316' },
  settings: {
    tags: ['quiz-aula-experimental'],
    submittingText: 'Reservando…',
    privacyNote: 'Seus dados são usados só para o seu atendimento.',
  },
}

// ------------------------------------------------------------
// Imobiliária · encontre o seu imóvel
// ------------------------------------------------------------

const VALOR_IMOVEL: [string, string][] = [
  ['ate300', 'Até R$ 300 mil'],
  ['300a600', 'De R$ 300 mil a R$ 600 mil'],
  ['600a1m', 'De R$ 600 mil a R$ 1 milhão'],
  ['1mmais', 'Acima de R$ 1 milhão'],
]

export const IMOBILIARIA = {
  version: 1,
  intro: {
    enabled: true,
    tag: 'Busca personalizada',
    headline: 'Encontre o imóvel certo sem perder tempo',
    sub: 'Responda algumas perguntas e receba opções que combinam com o que você procura.',
    cta: 'Começar minha busca',
    bullets: [
      { strong: 'Opções selecionadas', text: 'para o seu perfil' },
      { strong: 'Atendimento pelo WhatsApp,', text: 'sem compromisso' },
    ],
  },
  steps: [
    nameStep(),
    {
      id: 'intencao',
      type: 'choice',
      label: 'Objetivo',
      title: 'Prazer, {nome}. O que você procura?',
      options: options([
        ['comprar', 'Comprar um imóvel'],
        ['alugar', 'Alugar um imóvel'],
        ['investir', 'Investir em imóveis'],
        ['vender', 'Vender ou alugar o meu imóvel'],
      ]),
    },
    {
      id: 'tipo',
      type: 'choice',
      label: 'Tipo de imóvel',
      title: 'Que tipo de imóvel?',
      options: options([
        ['apto', 'Apartamento'],
        ['casa', 'Casa'],
        ['condominio', 'Casa em condomínio'],
        ['terreno', 'Terreno ou lote'],
        ['comercial', 'Sala, loja ou galpão'],
      ]),
    },
    {
      id: 'quartos',
      type: 'choice',
      label: 'Quartos',
      title: 'Quantos quartos?',
      options: options([
        ['1', '1 quarto'],
        ['2', '2 quartos'],
        ['3', '3 quartos'],
        ['4mais', '4 ou mais'],
      ]),
      showIf: [is('tipo', 'apto', 'casa', 'condominio')],
    },
    {
      id: 'regiao',
      type: 'fields',
      label: 'Região',
      title: 'Em qual bairro ou região?',
      cta: 'Continuar',
      fields: [
        {
          id: 'bairro',
          kind: 'text',
          label: 'Bairro, região ou cidade',
          placeholder: 'Ex.: Centro',
          required: true,
        },
      ],
    },
    {
      id: 'valor_compra',
      type: 'choice',
      label: 'Faixa de valor',
      title: 'Até quanto você pretende investir?',
      options: options(VALOR_IMOVEL),
      showIf: [is('intencao', 'comprar', 'investir')],
    },
    {
      id: 'pagamento',
      type: 'choice',
      label: 'Forma de pagamento',
      title: 'Como pretende pagar?',
      options: options([
        ['avista', 'À vista'],
        ['entrada', 'Financiamento, já tenho a entrada'],
        ['fgts', 'Financiamento usando o FGTS'],
        ['nao_sei', 'Ainda não sei'],
      ]),
      showIf: [is('intencao', 'comprar', 'investir')],
    },
    {
      id: 'valor_aluguel',
      type: 'choice',
      label: 'Faixa de aluguel',
      title: 'Até quanto pode pagar de aluguel por mês?',
      options: options([
        ['ate1500', 'Até R$ 1.500'],
        ['1500a3000', 'De R$ 1.500 a R$ 3.000'],
        ['3000a6000', 'De R$ 3.000 a R$ 6.000'],
        ['6000mais', 'Acima de R$ 6.000'],
      ]),
      showIf: [is('intencao', 'alugar')],
    },
    {
      id: 'valor_venda',
      type: 'choice',
      label: 'Valor estimado',
      title: 'Quanto você estima que o seu imóvel vale?',
      options: options([...VALOR_IMOVEL, ['nao_sei', 'Não sei, quero uma avaliação']]),
      showIf: [is('intencao', 'vender')],
    },
    {
      id: 'prazo',
      type: 'choice',
      label: 'Prazo',
      title: 'Para quando você precisa?',
      options: options([
        ['30dias', 'Nos próximos 30 dias'],
        ['3meses', 'Em até 3 meses'],
        ['6meses', 'Em até 6 meses'],
        ['pesquisando', 'Só estou pesquisando'],
      ]),
    },
    contactStep('{nome}, para qual WhatsApp um corretor pode te chamar?', 'Enviar', [
      WHATSAPP,
      EMAIL_OPTIONAL,
    ]),
  ],
  results: [
    {
      id: 'captacao',
      name: 'Captação · quer vender ou alugar',
      route: 'A',
      tags: [],
      pixel: PIXEL_LEAD,
      icon: 'message',
      title: '{nome}, vamos cuidar do seu imóvel.',
      blocks: [
        {
          id: 'c1',
          type: 'text',
          text: 'Um corretor vai te chamar no WhatsApp **{whatsapp}** para entender o imóvel e combinar uma avaliação.',
        },
        whatsappButton('c2', 'Falar com um corretor'),
      ],
    },
    {
      id: 'visitar',
      name: 'Qualificado · pronto para visitar',
      route: 'A',
      tags: [],
      pixel: PIXEL_LEAD,
      icon: 'check',
      title: '{nome}, já estamos separando opções para você.',
      blocks: [
        {
          id: 'v1',
          type: 'text',
          text: 'Um corretor vai te chamar no WhatsApp **{whatsapp}** com imóveis que combinam com o que você procura e para agendar as visitas.',
        },
        {
          id: 'v2',
          type: 'highlight',
          icon: 'bulb',
          text: '**Vai usar o FGTS?** O corretor te explica o passo a passo e os documentos necessários.',
          showIf: [is('pagamento', 'fgts')],
        },
        whatsappButton('v3', 'Falar com um corretor'),
      ],
    },
    {
      id: 'planejando',
      name: 'Morno · ainda planejando',
      route: 'B',
      tags: [],
      pixel: PIXEL_WARM,
      icon: 'bulb',
      title: '{nome}, vamos te ajudar a planejar.',
      blocks: [
        {
          id: 'p1',
          type: 'text',
          text: 'Um corretor vai te chamar no WhatsApp para entender melhor o que você procura e tirar dúvidas sobre valores e financiamento.',
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
          text: 'Guardamos o seu perfil. Quando aparecer um imóvel com a sua cara, a gente te avisa pelo WhatsApp.',
        },
        whatsappButton('f2', 'Chamar no WhatsApp'),
      ],
    },
  ],
  rules: [
    { id: 'regra_captacao', resultId: 'captacao', match: 'any', conditions: [is('intencao', 'vender')] },
    { id: 'regra_frio', resultId: 'pesquisando', match: 'any', conditions: [is('prazo', 'pesquisando')] },
    {
      // Renting never sees the payment question, and an unanswered
      // question "is not" anything: a renter in a hurry is qualified.
      id: 'regra_visitar',
      resultId: 'visitar',
      match: 'all',
      conditions: [is('prazo', '30dias', '3meses'), isNot('pagamento', 'nao_sei')],
    },
  ],
  defaultResultId: 'planejando',
  tagRules: [
    { id: 'tag_compra', tag: 'interesse:compra', match: 'all', conditions: [is('intencao', 'comprar')] },
    { id: 'tag_aluguel', tag: 'interesse:aluguel', match: 'all', conditions: [is('intencao', 'alugar')] },
    {
      id: 'tag_investimento',
      tag: 'interesse:investimento',
      match: 'all',
      conditions: [is('intencao', 'investir')],
    },
    { id: 'tag_captacao', tag: 'captacao', match: 'all', conditions: [is('intencao', 'vender')] },
    { id: 'tag_fgts', tag: 'usa-fgts', match: 'all', conditions: [is('pagamento', 'fgts')] },
  ],
  appearance: { accent: '#2563eb' },
  settings: {
    tags: ['quiz-imoveis'],
    submittingText: 'Enviando…',
    privacyNote: 'Seus dados são usados só para o seu atendimento.',
  },
}

// ------------------------------------------------------------
// Advocacia · triagem do caso
// ------------------------------------------------------------

export const ADVOCACIA = {
  version: 1,
  intro: {
    enabled: true,
    tag: 'Atendimento jurídico',
    headline: 'Conte o seu caso e receba uma orientação inicial',
    sub: 'Leva 2 minutos. As informações são sigilosas e servem só para direcionar o seu atendimento.',
    cta: 'Começar',
    bullets: [
      { strong: 'Sigilo:', text: 'as informações ficam só com o escritório' },
      { strong: 'Retorno pelo WhatsApp', text: 'de um profissional da área' },
    ],
  },
  steps: [
    nameStep(),
    {
      id: 'area',
      type: 'choice',
      label: 'Área',
      title: 'Prazer, {nome}. Sobre qual assunto você precisa de ajuda?',
      options: options([
        ['trabalhista', 'Trabalho: demissão, verbas, horas extras'],
        ['familia', 'Família: divórcio, pensão, guarda'],
        ['previdenciario', 'INSS e aposentadoria'],
        ['consumidor', 'Direito do consumidor'],
        ['civel', 'Contratos, dívidas e indenizações'],
        ['criminal', 'Criminal'],
        ['empresarial', 'Empresas'],
        ['outro', 'Outro assunto'],
      ]),
    },
    {
      id: 'quem',
      type: 'choice',
      label: 'Para quem',
      title: 'O caso é seu ou de uma empresa?',
      options: options([
        ['pessoa', 'Meu, como pessoa física'],
        ['empresa', 'De uma empresa'],
      ]),
    },
    {
      id: 'situacao',
      type: 'choice',
      label: 'Situação',
      title: 'Em que pé está a situação?',
      options: options([
        ['orientacao', 'Ainda não aconteceu nada, quero orientação'],
        ['acao', 'Quero entrar com uma ação'],
        ['notificacao', 'Recebi uma notificação, citação ou intimação'],
        ['processo', 'Já existe um processo em andamento'],
      ]),
    },
    {
      id: 'advogado',
      type: 'choice',
      label: 'Advogado atual',
      title: 'Você já tem advogado neste processo?',
      options: options([
        ['nao', 'Não tenho'],
        ['trocar', 'Tenho, mas quero trocar'],
        ['opiniao', 'Tenho, quero uma segunda opinião'],
      ]),
      showIf: [is('situacao', 'processo')],
    },
    {
      id: 'urgencia',
      type: 'choice',
      label: 'Urgência',
      title: 'Existe algum prazo correndo?',
      options: options([
        ['prazo', 'Sim, tenho prazo ou audiência marcada'],
        ['semanas', 'Quero resolver nas próximas semanas'],
        ['sem_pressa', 'Não, só quero entender os meus direitos'],
      ]),
    },
    {
      id: 'relato',
      type: 'fields',
      label: 'Resumo do caso',
      title: 'Se quiser, resuma o que aconteceu',
      note: 'Opcional. Não envie documentos por aqui.',
      cta: 'Continuar',
      fields: [
        {
          id: 'resumo',
          kind: 'longtext',
          label: 'O que aconteceu',
          placeholder: 'Em poucas linhas…',
          required: false,
        },
      ],
    },
    contactStep('{nome}, para qual WhatsApp o escritório pode retornar?', 'Enviar', [
      WHATSAPP,
      EMAIL_OPTIONAL,
    ]),
  ],
  results: [
    {
      id: 'urgente',
      name: 'Qualificado · prazo correndo',
      route: 'A',
      tags: ['urgente'],
      pixel: PIXEL_LEAD,
      icon: 'message',
      title: '{nome}, recebemos o seu caso.',
      blocks: [
        {
          id: 'u1',
          type: 'text',
          text: 'Como há um prazo correndo, o escritório vai priorizar o seu retorno pelo WhatsApp **{whatsapp}**.',
        },
        {
          id: 'u2',
          type: 'highlight',
          icon: 'bulb',
          text: '**Separe o que recebeu:** a notificação, a intimação ou qualquer documento do caso. Isso agiliza a análise.',
        },
        whatsappButton('u3', 'Falar agora pelo WhatsApp'),
      ],
    },
    {
      id: 'analise',
      name: 'Qualificado · caso para análise',
      route: 'A',
      tags: [],
      pixel: PIXEL_LEAD,
      icon: 'check',
      title: '{nome}, recebemos o seu caso.',
      blocks: [
        {
          id: 'a1',
          type: 'text',
          text: 'Um profissional do escritório vai analisar as informações e te retornar pelo WhatsApp **{whatsapp}**.',
        },
        whatsappButton('a2', 'Falar pelo WhatsApp'),
      ],
    },
    {
      id: 'orientacao',
      name: 'Morno · quer entender os direitos',
      route: 'B',
      tags: [],
      pixel: PIXEL_WARM,
      icon: 'bulb',
      title: 'Obrigado, {nome}.',
      blocks: [
        {
          id: 'o1',
          type: 'text',
          text: 'Recebemos a sua mensagem. Se a situação mudar, ou se aparecer algum prazo, fale com a gente pelo WhatsApp.',
        },
        whatsappButton('o2', 'Falar pelo WhatsApp'),
      ],
    },
  ],
  rules: [
    {
      id: 'regra_urgente',
      resultId: 'urgente',
      match: 'any',
      conditions: [is('urgencia', 'prazo'), is('situacao', 'notificacao')],
    },
    { id: 'regra_orientacao', resultId: 'orientacao', match: 'any', conditions: [is('urgencia', 'sem_pressa')] },
  ],
  defaultResultId: 'analise',
  tagRules: [
    ...tagPerOption('area', 'area', [
      ['trabalhista', 'trabalhista'],
      ['familia', 'familia'],
      ['previdenciario', 'previdenciario'],
      ['consumidor', 'consumidor'],
      ['civel', 'civel'],
      ['criminal', 'criminal'],
      ['empresarial', 'empresarial'],
    ]),
    { id: 'tag_pj', tag: 'pessoa-juridica', match: 'all', conditions: [is('quem', 'empresa')] },
    { id: 'tag_troca', tag: 'troca-de-advogado', match: 'all', conditions: [is('advogado', 'trocar')] },
  ],
  appearance: { accent: '#b45309' },
  settings: {
    tags: ['quiz-triagem-juridica'],
    submittingText: 'Enviando…',
    privacyNote: 'As informações são sigilosas.',
    consentText:
      'Ao enviar, você autoriza o escritório a usar estas informações para analisar o seu caso e entrar em contato.',
  },
}

// ------------------------------------------------------------
// Educação / Cursos · curso ideal
// ------------------------------------------------------------

export const EDUCACAO = {
  version: 1,
  intro: {
    enabled: true,
    tag: 'Leva 1 minuto',
    headline: 'Descubra o curso ideal para o seu próximo passo',
    sub: 'Responda 6 perguntas rápidas e receba uma indicação de curso e de turma.',
    cta: 'Descobrir meu curso',
    bullets: [
      { strong: 'Indicação personalizada', text: 'para o seu objetivo' },
      { strong: 'Turmas e condições', text: 'enviadas pelo WhatsApp' },
    ],
  },
  steps: [
    nameStep(),
    {
      id: 'objetivo',
      type: 'choice',
      label: 'Objetivo',
      title: 'Prazer, {nome}. O que você quer alcançar com um curso?',
      options: options([
        ['emprego', 'Conseguir o primeiro emprego'],
        ['carreira', 'Crescer na carreira ou mudar de área'],
        ['negocio', 'Abrir ou melhorar o meu negócio'],
        ['certificado', 'Tirar um certificado ou diploma'],
        ['pessoal', 'Aprender por interesse pessoal'],
      ]),
    },
    {
      id: 'area',
      type: 'choice',
      label: 'Área de interesse',
      title: 'Qual área te interessa mais?',
      options: options([
        ['tecnologia', 'Tecnologia'],
        ['saude', 'Saúde'],
        ['gestao', 'Gestão e negócios'],
        ['idiomas', 'Idiomas'],
        ['beleza', 'Beleza e estética'],
        ['outra', 'Outra'],
      ]),
    },
    {
      id: 'formato',
      type: 'choice',
      label: 'Formato',
      title: 'Como você prefere estudar?',
      options: options([
        ['presencial', 'Presencial'],
        ['online', 'Online, no meu tempo'],
        ['aovivo', 'Online, com aulas ao vivo'],
        ['tanto_faz', 'Tanto faz'],
      ]),
    },
    {
      id: 'turno',
      type: 'choice',
      label: 'Disponibilidade',
      title: 'Qual turno você tem livre?',
      options: options([
        ['manha', 'Manhã'],
        ['tarde', 'Tarde'],
        ['noite', 'Noite'],
        ['fds', 'Fins de semana'],
      ]),
    },
    {
      id: 'investimento',
      type: 'choice',
      label: 'Investimento',
      title: 'Quanto cabe no seu orçamento por mês?',
      options: options([
        ['ate200', 'Até R$ 200'],
        ['200a500', 'De R$ 200 a R$ 500'],
        ['500mais', 'Acima de R$ 500'],
        ['bolsa', 'Preciso de bolsa ou desconto'],
      ]),
    },
    {
      id: 'inicio',
      type: 'choice',
      label: 'Quando quer começar',
      title: 'Quando você quer começar?',
      options: options([
        ['proxima', 'Na próxima turma'],
        ['3meses', 'Nos próximos 3 meses'],
        ['pesquisando', 'Só estou pesquisando'],
      ]),
    },
    contactStep('{nome}, para qual WhatsApp enviamos a sua indicação de curso?', 'Ver minha indicação', [
      WHATSAPP,
      EMAIL_OPTIONAL,
    ]),
  ],
  results: [
    {
      id: 'matricula',
      name: 'Qualificado · quer a próxima turma',
      route: 'A',
      tags: [],
      pixel: PIXEL_LEAD,
      icon: 'check',
      title: '{nome}, encontramos um bom caminho para você.',
      blocks: [
        {
          id: 'm1',
          type: 'text',
          text: 'Nossa equipe vai te chamar no WhatsApp **{whatsapp}** com o curso indicado, as datas da próxima turma e as condições de matrícula.',
        },
        whatsappButton('m2', 'Falar com a equipe'),
      ],
    },
    {
      id: 'condicao',
      name: 'Morno · precisa de condição',
      route: 'B',
      tags: [],
      pixel: PIXEL_WARM,
      icon: 'gift',
      title: '{nome}, vamos ver a melhor condição para você.',
      blocks: [
        {
          id: 'c1',
          type: 'text',
          text: 'Nossa equipe vai te chamar no WhatsApp para apresentar as opções de pagamento e as condições disponíveis.',
        },
        whatsappButton('c2', 'Ver as condições no WhatsApp'),
      ],
    },
    {
      id: 'pesquisando',
      name: 'Frio · só pesquisando',
      route: 'C',
      tags: [],
      pixel: PIXEL_COLD,
      icon: 'bulb',
      title: 'Obrigado, {nome}!',
      blocks: [
        {
          id: 'f1',
          type: 'text',
          text: 'Quando abrir uma turma que combine com você, a gente avisa pelo WhatsApp. Se quiser conversar antes, é só chamar.',
        },
        whatsappButton('f2', 'Chamar no WhatsApp'),
      ],
    },
  ],
  rules: [
    { id: 'regra_frio', resultId: 'pesquisando', match: 'any', conditions: [is('inicio', 'pesquisando')] },
    {
      id: 'regra_matricula',
      resultId: 'matricula',
      match: 'all',
      conditions: [is('inicio', 'proxima'), isNot('investimento', 'bolsa')],
    },
  ],
  defaultResultId: 'condicao',
  tagRules: [
    ...tagPerOption('objetivo', 'objetivo', [
      ['emprego', 'emprego'],
      ['carreira', 'carreira'],
      ['negocio', 'negocio'],
      ['certificado', 'certificado'],
    ]),
    { id: 'tag_online', tag: 'formato:online', match: 'all', conditions: [is('formato', 'online', 'aovivo')] },
    { id: 'tag_presencial', tag: 'formato:presencial', match: 'all', conditions: [is('formato', 'presencial')] },
    { id: 'tag_bolsa', tag: 'precisa-de-bolsa', match: 'all', conditions: [is('investimento', 'bolsa')] },
  ],
  appearance: { accent: '#7c3aed' },
  settings: {
    tags: ['quiz-cursos'],
    submittingText: 'Montando a sua indicação…',
    privacyNote: 'Seus dados são usados só para o seu atendimento.',
  },
}

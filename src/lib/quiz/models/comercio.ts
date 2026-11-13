// ============================================================
// Models for commerce and companies: retail and e-commerce, services
// for companies (B2B) and solar energy.
// ============================================================

import {
  CITY,
  COMPANY,
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
// Varejo / E-commerce · presente ideal + cupom
// ------------------------------------------------------------

/** The coupon shown on every result. The model's description asks to change it. */
const CUPOM = '**Cupom: PRESENTE10**\nUse na finalização da compra.'

export const VAREJO = {
  version: 1,
  intro: {
    enabled: true,
    tag: 'Ganhe um cupom',
    headline: 'Encontre o presente ideal e ganhe um cupom de desconto',
    sub: 'Responda 5 perguntas rápidas: indicamos as melhores opções e liberamos o seu cupom.',
    cta: 'Quero meu cupom',
    bullets: [
      { strong: 'Leva 30 segundos', text: '' },
      { strong: 'Cupom liberado no final,', text: 'é só usar na compra' },
    ],
  },
  steps: [
    nameStep('Como podemos te chamar?'),
    {
      id: 'para_quem',
      type: 'choice',
      label: 'Para quem',
      title: 'Prazer, {nome}. Para quem é o presente?',
      options: options([
        ['mim', 'Para mim'],
        ['mulher', 'Para uma mulher'],
        ['homem', 'Para um homem'],
        ['crianca', 'Para uma criança'],
        ['casal', 'Para um casal'],
      ]),
    },
    {
      id: 'ocasiao',
      type: 'choice',
      label: 'Ocasião',
      title: 'Qual é a ocasião?',
      options: options([
        ['aniversario', 'Aniversário'],
        ['data', 'Data comemorativa'],
        ['casamento', 'Casamento ou chá'],
        ['sem', 'Sem ocasião especial'],
      ]),
    },
    {
      id: 'estilo',
      type: 'choice',
      label: 'Estilo',
      title: 'Qual estilo combina mais?',
      options: options([
        ['classico', 'Clássico'],
        ['moderno', 'Moderno'],
        ['divertido', 'Divertido'],
        ['pratico', 'Prático, para o dia a dia'],
      ]),
    },
    {
      id: 'preco',
      type: 'choice',
      label: 'Faixa de preço',
      title: 'Quanto pretende gastar?',
      options: options([
        ['ate100', 'Até R$ 100'],
        ['100a300', 'De R$ 100 a R$ 300'],
        ['300mais', 'Acima de R$ 300'],
      ]),
    },
    {
      id: 'quando',
      type: 'choice',
      label: 'Quando vai comprar',
      title: 'Para quando você precisa?',
      options: options([
        ['hoje', 'Hoje ou amanhã'],
        ['semana', 'Ainda esta semana'],
        ['olhando', 'Só estou olhando'],
      ]),
    },
    contactStep('{nome}, para qual WhatsApp enviamos o seu cupom?', 'Liberar meu cupom'),
  ],
  results: [
    {
      id: 'agora',
      name: 'Qualificado · compra agora',
      route: 'A',
      tags: [],
      pixel: PIXEL_LEAD,
      icon: 'gift',
      title: '{nome}, o seu cupom está liberado!',
      blocks: [
        { id: 'a1', type: 'highlight', icon: 'gift', text: CUPOM },
        {
          id: 'a2',
          type: 'text',
          text: 'Nossa equipe também vai te mandar no WhatsApp **{whatsapp}** as opções que combinam com o que você respondeu.',
        },
        { id: 'a3', type: 'button', label: 'Ver os produtos', kind: 'link', url: '' },
      ],
    },
    {
      id: 'semana',
      name: 'Morno · compra esta semana',
      route: 'B',
      tags: [],
      pixel: PIXEL_WARM,
      icon: 'gift',
      title: '{nome}, o seu cupom está liberado!',
      blocks: [
        { id: 's1', type: 'highlight', icon: 'gift', text: CUPOM },
        {
          id: 's2',
          type: 'text',
          text: 'Separamos algumas ideias para você. Se quiser ajuda para escolher, é só chamar a gente no WhatsApp.',
        },
        { id: 's3', type: 'button', label: 'Ver os produtos', kind: 'link', url: '' },
      ],
    },
    {
      id: 'olhando',
      name: 'Frio · só olhando',
      route: 'C',
      tags: [],
      pixel: PIXEL_COLD,
      icon: 'gift',
      title: '{nome}, guardamos um cupom para você.',
      blocks: [
        { id: 'o1', type: 'highlight', icon: 'gift', text: CUPOM },
        { id: 'o2', type: 'text', text: 'Quando decidir, é só usar. Ele fica guardado no seu WhatsApp.' },
        { id: 'o3', type: 'button', label: 'Ver os produtos', kind: 'link', url: '' },
      ],
    },
  ],
  rules: [
    { id: 'regra_frio', resultId: 'olhando', match: 'any', conditions: [is('quando', 'olhando')] },
    { id: 'regra_agora', resultId: 'agora', match: 'any', conditions: [is('quando', 'hoje')] },
  ],
  defaultResultId: 'semana',
  tagRules: [
    { id: 'tag_proprio', tag: 'compra-propria', match: 'all', conditions: [is('para_quem', 'mim')] },
    ...tagPerOption('para_quem', 'presente', [
      ['mulher', 'mulher'],
      ['homem', 'homem'],
      ['crianca', 'crianca'],
      ['casal', 'casal'],
    ]),
  ],
  appearance: { accent: '#e11d48' },
  settings: {
    tags: ['quiz-cupom'],
    submittingText: 'Liberando o seu cupom…',
    privacyNote: 'Sem spam: só o cupom e as indicações.',
  },
}

// ------------------------------------------------------------
// Serviços para empresas (B2B) · diagnóstico
// ------------------------------------------------------------

export const SERVICOS_B2B = {
  version: 1,
  intro: {
    enabled: true,
    tag: 'Diagnóstico gratuito',
    headline: 'Descubra o que está travando o crescimento da sua empresa',
    sub: 'Responda 7 perguntas em 2 minutos e receba um diagnóstico do seu momento.',
    cta: 'Começar meu diagnóstico',
    bullets: [
      { strong: '2 minutos,', text: '7 perguntas objetivas' },
      { strong: 'Resultado na hora', text: 'e conversa com um especialista' },
    ],
  },
  steps: [
    nameStep(),
    {
      id: 'cargo',
      type: 'choice',
      label: 'Cargo',
      title: 'Prazer, {nome}. Qual é o seu papel na empresa?',
      options: options([
        ['dono', 'Dono(a) ou sócio(a)'],
        ['diretor', 'Diretor(a) ou gerente'],
        ['colaborador', 'Colaborador(a)'],
        ['outro', 'Outro'],
      ]),
    },
    {
      id: 'porte',
      type: 'choice',
      label: 'Porte',
      title: 'Quantas pessoas trabalham na empresa?',
      options: options([
        ['1a5', 'Até 5'],
        ['6a20', 'De 6 a 20'],
        ['21a100', 'De 21 a 100'],
        ['100mais', 'Mais de 100'],
      ]),
    },
    {
      id: 'faturamento',
      type: 'choice',
      label: 'Faturamento mensal',
      title: 'Quanto a empresa fatura por mês, em média?',
      note: 'Confidencial. Serve só para calibrar o diagnóstico.',
      options: options([
        ['ate20', 'Até R$ 20 mil'],
        ['20a50', 'De R$ 20 mil a R$ 50 mil'],
        ['50a200', 'De R$ 50 mil a R$ 200 mil'],
        ['200a1m', 'De R$ 200 mil a R$ 1 milhão'],
        ['1mmais', 'Acima de R$ 1 milhão'],
      ]),
    },
    {
      id: 'desafio',
      type: 'choice',
      label: 'Maior desafio',
      title: '{nome}, qual é o maior desafio da empresa hoje?',
      options: options([
        ['vender', 'Vender mais'],
        ['processos', 'Organizar processos e equipe'],
        ['custos', 'Reduzir custos'],
        ['previsibilidade', 'Crescer com previsibilidade'],
        ['outro', 'Outro'],
      ]),
    },
    {
      id: 'prazo',
      type: 'choice',
      label: 'Quando quer começar',
      title: 'Se fizer sentido, quando vocês querem começar?',
      options: options([
        ['ja', 'O quanto antes'],
        ['30dias', 'Nos próximos 30 dias'],
        ['3meses', 'Daqui a uns 3 meses'],
        ['pesquisando', 'Só estou pesquisando'],
      ]),
    },
    {
      id: 'investimento',
      type: 'choice',
      label: 'Investimento mensal',
      title: 'Quanto faz sentido investir por mês para resolver isso?',
      options: options([
        ['sem', 'Ainda não tenho verba'],
        ['ate2k', 'Até R$ 2 mil'],
        ['2a5k', 'De R$ 2 mil a R$ 5 mil'],
        ['5a10k', 'De R$ 5 mil a R$ 10 mil'],
        ['10kmais', 'Acima de R$ 10 mil'],
      ]),
    },
    contactStep(
      'Pronto, {nome}. O seu diagnóstico está montado. Para onde a gente envia?',
      'Ver meu resultado',
      [WHATSAPP, COMPANY, EMAIL_OPTIONAL],
    ),
  ],
  results: [
    {
      id: 'a',
      name: 'A · Qualificado',
      route: 'A',
      tags: [],
      pixel: PIXEL_LEAD,
      icon: 'check',
      title: '{nome}, a sua empresa tem perfil para dar o próximo passo.',
      blocks: [
        {
          id: 'a1',
          type: 'text',
          text: 'Pelas suas respostas, a {empresa} já tem estrutura e momento para crescer com método. Nossa equipe vai te chamar no WhatsApp **{whatsapp}** para uma conversa de diagnóstico.',
        },
        {
          id: 'a2',
          type: 'highlight',
          icon: 'message',
          text: '**Dica:** para a conversa render, o ideal é que um sócio participe com você.',
          showIf: [isNot('cargo', 'dono')],
        },
        whatsappButton('a3', 'Agendar a conversa'),
      ],
    },
    {
      id: 'b',
      name: 'B · Morno',
      route: 'B',
      tags: [],
      pixel: PIXEL_WARM,
      icon: 'bulb',
      title: '{nome}, a sua empresa está perto, mas ainda vale ajustar a base.',
      blocks: [
        {
          id: 'b1',
          type: 'text',
          text: 'Antes de investir pesado, vale organizar o que vem primeiro. Nossa equipe vai te mandar pelo WhatsApp os próximos passos para o seu momento.',
        },
        whatsappButton('b2', 'Conversar pelo WhatsApp'),
      ],
    },
    {
      id: 'c',
      name: 'C · Desqualificado',
      route: 'C',
      tags: [],
      pixel: PIXEL_COLD,
      icon: 'gift',
      title: '{nome}, obrigado por responder com sinceridade.',
      blocks: [
        {
          id: 'c1',
          type: 'text',
          text: 'Pelo momento da sua empresa, um projeto agora seria mais custo do que solução. Vamos te mandar conteúdos para você começar a ajustar por conta própria.',
        },
        { id: 'c2', type: 'button', label: 'Quero o material', kind: 'link', url: '' },
      ],
    },
  ],
  // C first: one eliminating answer beats the others. Then B, for who is
  // missing one piece. Everyone else is A.
  rules: [
    {
      id: 'regra_c',
      resultId: 'c',
      match: 'any',
      conditions: [is('faturamento', 'ate20'), is('investimento', 'sem')],
    },
    {
      id: 'regra_b',
      resultId: 'b',
      match: 'any',
      conditions: [
        is('cargo', 'colaborador', 'outro'),
        is('faturamento', '20a50'),
        is('prazo', 'pesquisando'),
      ],
    },
  ],
  defaultResultId: 'a',
  tagRules: [
    { id: 'tag_decisor_sim', tag: 'decisor:sim', match: 'all', conditions: [is('cargo', 'dono')] },
    { id: 'tag_decisor_nao', tag: 'decisor:nao', match: 'all', conditions: [isNot('cargo', 'dono')] },
    {
      id: 'tag_verba',
      tag: 'verba-baixa',
      match: 'all',
      conditions: [is('investimento', 'ate2k')],
      resultIds: ['a'],
    },
    ...tagPerOption('desafio', 'desafio', [
      ['vender', 'vendas'],
      ['processos', 'processos'],
      ['custos', 'custos'],
      ['previsibilidade', 'previsibilidade'],
    ]),
  ],
  appearance: { accent: '#0f766e' },
  settings: {
    tags: ['quiz-diagnostico'],
    submittingText: 'Montando o seu resultado…',
    privacyNote: 'Seus dados ficam só com a gente. Nada de spam.',
  },
}

// ------------------------------------------------------------
// Energia solar · simulação de economia
// ------------------------------------------------------------

export const ENERGIA_SOLAR = {
  version: 1,
  intro: {
    enabled: true,
    tag: 'Simulação gratuita',
    headline: 'Descubra quanto você pode economizar com energia solar',
    sub: 'Responda 5 perguntas e receba uma simulação feita para o seu consumo.',
    cta: 'Simular minha economia',
    bullets: [
      { strong: 'Leva 1 minuto', text: '' },
      { strong: 'Simulação pelo WhatsApp,', text: 'com base na sua conta de luz' },
    ],
  },
  steps: [
    nameStep(),
    {
      id: 'imovel',
      type: 'choice',
      label: 'Tipo de imóvel',
      title: 'Prazer, {nome}. Onde você quer instalar?',
      options: options([
        ['casa', 'Na minha casa'],
        ['empresa', 'Na minha empresa ou comércio'],
        ['rural', 'Em uma propriedade rural'],
        ['industria', 'Em uma indústria'],
      ]),
    },
    {
      id: 'conta',
      type: 'choice',
      label: 'Conta de luz',
      title: 'Quanto vem a sua conta de luz por mês, em média?',
      options: options([
        ['ate200', 'Até R$ 200'],
        ['200a500', 'De R$ 200 a R$ 500'],
        ['500a1000', 'De R$ 500 a R$ 1.000'],
        ['1000a3000', 'De R$ 1.000 a R$ 3.000'],
        ['3000mais', 'Acima de R$ 3.000'],
      ]),
    },
    {
      id: 'posse',
      type: 'choice',
      label: 'Imóvel próprio',
      title: 'O imóvel é próprio ou alugado?',
      options: options([
        ['proprio', 'Próprio'],
        ['alugado', 'Alugado'],
        ['familia', 'De familiares ou cedido'],
      ]),
    },
    {
      id: 'pagamento',
      type: 'choice',
      label: 'Forma de pagamento',
      title: 'Como você prefere pagar o sistema?',
      options: options([
        ['avista', 'À vista'],
        ['financiamento', 'Financiamento'],
        ['cartao', 'Cartão de crédito'],
        ['nao_sei', 'Ainda não sei'],
      ]),
    },
    {
      id: 'prazo',
      type: 'choice',
      label: 'Prazo',
      title: 'Para quando você quer o sistema funcionando?',
      options: options([
        ['ja', 'O quanto antes'],
        ['3meses', 'Nos próximos 3 meses'],
        ['pesquisando', 'Só estou pesquisando'],
      ]),
    },
    contactStep('{nome}, para qual WhatsApp enviamos a sua simulação?', 'Receber minha simulação', [
      WHATSAPP,
      CITY,
    ]),
  ],
  results: [
    {
      id: 'qualificado',
      name: 'Qualificado · conta alta e prazo curto',
      route: 'A',
      tags: [],
      pixel: PIXEL_LEAD,
      icon: 'check',
      title: '{nome}, a energia solar combina com o seu consumo.',
      blocks: [
        {
          id: 'q1',
          type: 'text',
          text: 'Com base nas suas respostas, a nossa equipe vai preparar uma simulação de economia e te enviar pelo WhatsApp **{whatsapp}**.',
        },
        {
          id: 'q2',
          type: 'highlight',
          icon: 'bulb',
          text: 'A economia real depende do consumo, da área disponível e da taxa mínima da distribuidora. A simulação considera tudo isso.',
        },
        whatsappButton('q3', 'Falar com um consultor'),
      ],
    },
    {
      id: 'avaliando',
      name: 'Morno · ainda avaliando',
      route: 'B',
      tags: [],
      pixel: PIXEL_WARM,
      icon: 'bulb',
      title: '{nome}, vamos te mostrar se vale a pena para você.',
      blocks: [
        {
          id: 'a1',
          type: 'text',
          text: 'Nossa equipe vai te chamar no WhatsApp para entender melhor o seu consumo e as formas de pagamento.',
        },
        whatsappButton('a2', 'Tirar uma dúvida agora'),
      ],
    },
    {
      id: 'frio',
      name: 'Frio · conta baixa ou só pesquisando',
      route: 'C',
      tags: [],
      pixel: PIXEL_COLD,
      icon: 'gift',
      title: 'Obrigado, {nome}!',
      blocks: [
        {
          id: 'f1',
          type: 'text',
          text: 'Com o consumo atual, a economia pode ser pequena. Se a sua conta aumentar, ou se quiser conversar, é só chamar a gente.',
        },
        whatsappButton('f2', 'Chamar no WhatsApp'),
      ],
    },
  ],
  rules: [
    {
      id: 'regra_frio',
      resultId: 'frio',
      match: 'any',
      conditions: [is('conta', 'ate200'), is('prazo', 'pesquisando')],
    },
    {
      id: 'regra_avaliando',
      resultId: 'avaliando',
      match: 'any',
      conditions: [is('posse', 'alugado'), is('pagamento', 'nao_sei')],
    },
  ],
  defaultResultId: 'qualificado',
  tagRules: [
    ...tagPerOption('imovel', 'solar', [
      ['casa', 'residencial'],
      ['empresa', 'comercial'],
      ['rural', 'rural'],
      ['industria', 'industrial'],
    ]),
    { id: 'tag_conta_alta', tag: 'conta-alta', match: 'all', conditions: [is('conta', '1000a3000', '3000mais')] },
  ],
  appearance: { accent: '#eab308' },
  settings: {
    tags: ['quiz-energia-solar'],
    submittingText: 'Preparando a sua simulação…',
    privacyNote: 'Seus dados são usados só para a simulação.',
  },
}

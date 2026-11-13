// ============================================================
// Móveis planejados: the quiz Harpium itself uses to qualify furniture
// stores as clients of its advisory. It used to run as its own site
// (quiz-planejados); here it is data, with the same screens, the same
// A/B/C rule and the same result texts.
//
// For Harpium's own demand, not for the agency's clients: it is the
// last model in the list (templates.ts).
// ============================================================

import { is, isNot, options } from './shared'

/** What comes first, by the answer to "o que mais te incomoda nas vendas". */
const CHALLENGE_PHRASE: [string, string][] = [
  ['nao_fecha', 'o seu processo comercial, antes de trazer mais gente'],
  ['poucos', 'um posicionamento que faça a loja ser lembrada'],
  ['indicacao', 'um canal próprio de aquisição'],
  ['preco', 'a forma como sua marca comunica valor'],
  ['anuncio', 'a estratégia por trás dos anúncios'],
]

export const MOVEIS_PLANEJADOS = {
  version: 1,
  intro: {
    enabled: true,
    tag: 'Diagnóstico gratuito · Móveis planejados',
    headline: 'Sua loja vende por indicação ou porque tem um sistema?',
    sub: 'Descubra em 2 minutos o que está travando as vendas da sua loja.',
    cta: 'Começar meu diagnóstico',
    bullets: [
      { strong: 'R$ 29 mil em anúncios → R$ 1,1 milhão em vendas', text: 'em 12 meses' },
      { strong: 'R$ 358 mil em vendas em 9 meses', text: 'só pelo digital' },
      { strong: 'Exclusividade:', text: 'atendemos só uma loja por região' },
    ],
  },
  steps: [
    {
      id: 'nome',
      type: 'fields',
      label: 'Nome',
      title: 'Antes de começar: como posso te chamar?',
      cta: 'Continuar',
      fields: [
        { id: 'primeiro_nome', kind: 'name', label: 'Primeiro nome', placeholder: 'Seu primeiro nome', required: true },
      ],
    },
    {
      id: 'tipo',
      type: 'choice',
      label: 'Tipo de empresa',
      title: 'Prazer, {nome}. O que descreve melhor a sua empresa?',
      options: options([
        ['fabrica', 'Fábrica ou marcenaria com showroom próprio'],
        ['loja', 'Loja de móveis planejados (revenda ou franquia)'],
        ['marcenaria', 'Marcenaria sem loja física'],
        ['arquiteto', 'Sou arquiteto(a) ou designer de interiores'],
        ['outro', 'Outro'],
      ]),
    },
    {
      id: 'cargo',
      type: 'choice',
      label: 'Cargo',
      title: 'E qual é o seu papel na empresa?',
      options: options([
        ['dono', 'Sou o dono(a) ou sócio(a)'],
        ['gerente', 'Gerente da loja ou responsável comercial'],
        ['marketing', 'Cuido do marketing'],
        ['outro', 'Outro'],
      ]),
    },
    {
      id: 'decisao',
      type: 'choice',
      label: 'Quem decide o investimento',
      title: '{nome}, quando a empresa decide investir em marketing, quem dá a palavra final?',
      options: options([
        ['junto', 'Eu decido junto com o dono'],
        ['levo', 'O dono decide, mas eu levo a proposta'],
        ['so_dono', 'Só o dono decide'],
      ]),
      showIf: [is('cargo', 'gerente')],
    },
    {
      id: 'faturamento',
      type: 'choice',
      label: 'Faturamento mensal',
      title: 'Em média, quanto a empresa fatura por mês?',
      note: 'Essa informação é confidencial e serve só para calibrarmos o diagnóstico.',
      options: options([
        ['ate30', 'Até R$ 30 mil'],
        ['30a50', 'De R$ 30 mil a R$ 50 mil'],
        ['50a75', 'De R$ 50 mil a R$ 75 mil'],
        ['75a150', 'De R$ 75 mil a R$ 150 mil'],
        ['150a300', 'De R$ 150 mil a R$ 300 mil'],
        ['300mais', 'Acima de R$ 300 mil'],
      ]),
    },
    {
      id: 'ticket',
      type: 'choice',
      label: 'Ticket médio do projeto',
      title: 'Qual é o ticket médio de um projeto fechado?',
      options: options([
        ['ate15', 'Até R$ 15 mil'],
        ['15a40', 'De R$ 15 mil a R$ 40 mil'],
        ['40a80', 'De R$ 40 mil a R$ 80 mil'],
        ['80mais', 'Acima de R$ 80 mil'],
      ]),
    },
    {
      id: 'origem',
      type: 'choice',
      label: 'De onde vêm os clientes',
      title: 'Hoje, de onde vem a maior parte dos seus clientes?',
      options: options([
        ['indicacao', 'Indicação de clientes ou arquitetos'],
        ['instagram', 'Instagram (orgânico)'],
        ['anuncios', 'Anúncios pagos'],
        ['loja', 'Movimento da loja física'],
        ['nao_sei', 'Não sei dizer com certeza'],
      ]),
    },
    {
      id: 'desafio',
      type: 'choice',
      label: 'Maior desafio nas vendas',
      title: '{nome}, o que mais te incomoda nas vendas hoje?',
      options: options([
        ['nao_fecha', 'Os orçamentos chegam, mas pouca gente fecha'],
        ['poucos', 'Chegam poucos clientes novos'],
        ['indicacao', 'Dependo demais de indicação e de arquitetos'],
        ['preco', 'Atraio muita gente procurando só preço'],
        ['anuncio', 'Já tentei anúncio e não deu retorno'],
      ]),
    },
    {
      id: 'investimento',
      type: 'choice',
      label: 'Investimento mensal em marketing',
      title: '{nome}, quanto faz sentido investir por mês em marketing?',
      note: 'Somando time e anúncios.',
      options: options([
        ['sem_verba', 'Ainda não tenho verba para isso'],
        ['ate2500', 'Menos de R$ 2.500'],
        ['2500a5000', 'De R$ 2.500 a R$ 5.000'],
        ['5000a10000', 'De R$ 5.000 a R$ 10.000'],
        ['10000mais', 'Acima de R$ 10.000'],
      ]),
    },
    {
      id: 'prazo',
      type: 'choice',
      label: 'Quando quer começar',
      title: 'E se fizer sentido, quando você quer começar?',
      options: options([
        ['ja', 'O quanto antes'],
        ['30dias', 'Nos próximos 30 dias'],
        ['3meses', 'Daqui a uns 3 meses'],
        ['pesquisando', 'Por enquanto estou só pesquisando'],
      ]),
    },
    {
      id: 'contato',
      type: 'fields',
      label: 'Contato',
      title: 'Pronto, {nome}. Seu diagnóstico já está montado. Para onde a gente envia?',
      cta: 'Ver meu resultado',
      fields: [
        { id: 'whatsapp', kind: 'phone', label: 'WhatsApp', placeholder: '(11) 91234-5678', required: true },
        { id: 'empresa', kind: 'company', label: 'Nome da empresa', placeholder: 'Ex.: Planejados Silva', required: true },
        { id: 'cidade', kind: 'city', label: 'Cidade / UF', placeholder: 'Ex.: Palmas / TO', required: true },
        { id: 'instagram', kind: 'instagram', label: '@ do Instagram da empresa', placeholder: '@suaempresa', required: false },
      ],
    },
  ],
  results: [
    {
      id: 'a',
      name: 'A · Qualificado',
      route: 'A',
      tags: [],
      pixel: { kind: 'standard', name: 'Lead' },
      icon: 'check',
      title: '{nome}, sua empresa tem perfil para crescer com a Harpium.',
      blocks: [
        {
          id: 'a1',
          type: 'text',
          text: 'Pelas suas respostas, a {empresa} já tem estrutura, ticket e momento para transformar marketing em venda previsível. O que falta é método, e é exatamente isso que a gente faz.',
        },
        {
          id: 'a2',
          type: 'text',
          text: 'Uma loja de planejados que atendemos investiu **R$ 29 mil em anúncios em 12 meses** e o marketing passou a responder por **quase metade do faturamento da empresa**. É esse tipo de conversa que vamos ter com você.',
        },
        {
          id: 'a3',
          type: 'highlight',
          icon: 'message',
          text: '**Próximo passo:** nosso time vai te chamar no WhatsApp para entender o cenário e marcar uma conversa estratégica. **Para ela render de verdade, o ideal é que o dono participe com você.**\nFica de olho no número **{whatsapp}**.',
          showIf: [is('cargo', 'gerente')],
        },
        {
          id: 'a4',
          type: 'highlight',
          icon: 'message',
          text: '**Próximo passo:** nosso time vai te chamar no WhatsApp em instantes para entender alguns detalhes e marcar uma conversa estratégica.\nFica de olho no número **{whatsapp}**.',
          showIf: [isNot('cargo', 'gerente')],
        },
      ],
    },
    {
      id: 'b',
      name: 'B · Morno',
      route: 'B',
      tags: [],
      pixel: { kind: 'custom', name: 'QuizMorno' },
      icon: 'bulb',
      title: '{nome}, sua empresa está perto, mas ainda não é hora de uma assessoria completa.',
      blocks: [
        ...CHALLENGE_PHRASE.map(([optionId, phrase]) => ({
          id: `b_${optionId}`,
          type: 'text',
          text: `Antes de investir em tráfego, vale ajustar o que vem primeiro: ${phrase}.`,
          showIf: [is('desafio', optionId)],
        })),
        {
          id: 'b2',
          type: 'text',
          text: 'O **Raio-X Comercial** é uma análise completa da sua loja (Instagram, anúncios, atendimento e processo de venda) com um plano claro para os próximos 90 dias.',
        },
        {
          id: 'b3',
          type: 'bullets',
          items: [
            'Análise prévia da sua loja, incluindo um contato oculto no WhatsApp',
            'Sessão estratégica de 90 minutos, ao vivo',
            'Plano de 90 dias: prioridades, verba de mídia, roteiro comercial e metas',
            'Retorno de 30 minutos depois de 30 dias',
          ],
        },
        {
          id: 'b4',
          type: 'highlight',
          icon: 'bulb',
          text: 'Se decidir seguir com a Harpium depois, o valor do Raio-X é abatido da assessoria.',
        },
        { id: 'b5', type: 'button', label: 'Quero meu Raio-X · R$ 697', kind: 'link', url: '' },
      ],
    },
    {
      id: 'c',
      name: 'C · Desqualificado',
      route: 'C',
      tags: [],
      pixel: { kind: 'custom', name: 'QuizDesqualificado' },
      icon: 'gift',
      title: '{nome}, obrigado por responder com sinceridade.',
      blocks: [
        {
          id: 'c1',
          type: 'text',
          text: 'Pelo momento da sua empresa, uma assessoria agora seria mais custo do que solução. Mas dá para começar a ajustar sozinho.',
        },
        {
          id: 'c2',
          type: 'highlight',
          icon: 'gift',
          text: '**Baixe grátis:** 5 erros que fazem sua loja de planejados atrair só quem pede desconto.',
        },
        {
          id: 'c3',
          type: 'text',
          text: 'Você também entra na lista do nosso material completo para lojas de planejados, com condição especial para quem chegou por aqui.',
        },
        { id: 'c4', type: 'button', label: 'Quero o material', kind: 'link', url: '' },
      ],
    },
  ],
  // C first: one eliminating answer beats everything else. Then B, for
  // who is missing one piece. Everyone else is A.
  rules: [
    {
      id: 'regra_c',
      resultId: 'c',
      match: 'any',
      conditions: [
        is('tipo', 'arquiteto', 'outro'),
        is('faturamento', 'ate30', '30a50'),
        is('investimento', 'sem_verba'),
      ],
    },
    {
      id: 'regra_b',
      resultId: 'b',
      match: 'any',
      conditions: [
        isNot('cargo', 'dono', 'gerente'),
        is('faturamento', '50a75'),
        is('prazo', 'pesquisando'),
      ],
    },
  ],
  defaultResultId: 'a',
  tagRules: [
    { id: 'tag_decisor_sim', tag: 'decisor:sim', match: 'all', conditions: [is('cargo', 'dono')] },
    { id: 'tag_decisor_nao', tag: 'decisor:nao', match: 'all', conditions: [isNot('cargo', 'dono')] },
    {
      id: 'tag_prioridade',
      tag: 'prioridade-baixa',
      match: 'all',
      conditions: [is('cargo', 'gerente'), is('decisao', 'so_dono')],
    },
    {
      // Bills from R$ 75 mil but declared under R$ 2.500 a month: still
      // A (the first offer is the advisory), flagged for the SDR.
      id: 'tag_verba',
      tag: 'verba-baixa',
      match: 'all',
      conditions: [isNot('investimento', '2500a5000', '5000a10000', '10000mais')],
      resultIds: ['a'],
    },
  ],
  appearance: { accent: '#22ced2' },
  settings: {
    tags: ['quiz-planejados'],
    submittingText: 'Montando seu resultado…',
    privacyNote: 'Seus dados ficam só com a Harpium. Nada de spam.',
  },
}

// ============================================================
// In-app help: the tutorial behind the "?" in the top bar, the ⓘ next
// to tricky fields and the /ajuda page.
//
// Content lives here as data rather than in messages/*.json: it is
// long-form prose written for the customer, and one module keeps a
// tutorial step, the matching field tip and the page that links them
// next to each other. The app ships in Portuguese only.
//
// `route` ties a topic to a nav href, so the top bar can open the
// right one for whatever screen is showing. Tips point back at a topic
// so "Ver tutorial completo" lands on the long version.
// ============================================================

export interface HelpTopic {
  /** URL anchor on /ajuda. */
  id: string;
  title: string;
  /** Nav href this topic explains, if it is a screen. */
  route?: string;
  /** One or two sentences: what the screen is for. */
  summary: string;
  /** How to do the main job, in order. */
  steps: string[];
  /** Good to know — limits, gotchas, shortcuts. */
  tips?: string[];
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "primeiros-passos",
    title: "Primeiros passos",
    summary:
      "O que configurar antes de começar a atender, nesta ordem. Leva cerca de 30 minutos e só precisa ser feito uma vez.",
    steps: [
      "Conecte o WhatsApp em Canais: escolha a API oficial da Meta, a uazapi (lendo um QR code) ou a Evolution API.",
      "Convide sua equipe em Configurações › Membros da equipe e escolha o papel de cada pessoa.",
      "Crie as etiquetas e os campos personalizados que sua empresa usa em Configurações › Campos e etiquetas.",
      "Monte o funil de vendas em Funis, com as etapas do seu processo.",
      "Cadastre respostas rápidas em Configurações › Respostas rápidas para as mensagens que vocês repetem todo dia.",
      "Se for usar agentes de IA, cole a chave da OpenAI ou da Anthropic em Agentes › Chave e modelo.",
      "Mande uma mensagem de teste de outro celular para o número conectado e veja se ela aparece na Caixa de entrada.",
    ],
    tips: [
      "Ficou com dúvida em algum campo? Procure o ícone ⓘ ao lado dele.",
      "O botão ? no topo de cada tela abre o resumo daquela tela.",
    ],
  },
  {
    id: "painel",
    title: "Painel",
    route: "/dashboard",
    summary:
      "A visão geral do dia: conversas ativas, contatos novos, valor dos negócios abertos e mensagens enviadas, comparados com ontem.",
    steps: [
      "Confira os números do topo para saber como está o movimento de hoje.",
      "Use os atalhos para criar um contato, um negócio, uma transmissão ou uma automação sem trocar de tela.",
      "Acompanhe a Atividade recente para ver o que a equipe e as automações fizeram por último.",
    ],
  },
  {
    id: "caixa-de-entrada",
    title: "Caixa de entrada",
    route: "/inbox",
    summary:
      "Onde a equipe atende. Todas as conversas de WhatsApp (e de Instagram, se conectado) chegam aqui, em tempo real.",
    steps: [
      "Escolha uma conversa na lista da esquerda. Use os filtros Todas, Não lidas, Abertas, Pendentes e Fechadas, ou busque por nome e telefone.",
      "Responda na caixa de mensagem. Digite / para usar uma resposta rápida, ou anexe imagens, áudios e documentos.",
      "Mude o status da conversa: Aberta enquanto atende, Pendente quando espera o cliente, Fechada quando terminar.",
      "No painel da direita, veja e edite os dados do contato, adicione etiquetas e crie um negócio no funil.",
    ],
    tips: [
      "Janela de 24 horas: o WhatsApp só deixa enviar mensagem livre até 24 horas depois da última mensagem do cliente. Depois disso, só com um modelo aprovado (em Configurações › Modelos).",
      "O ponto colorido no ícone da Caixa de entrada mostra que há conversas não lidas.",
    ],
  },
  {
    id: "notificacoes",
    title: "Notificações",
    route: "/notifications",
    summary:
      "Avisos do sistema para você: conversas atribuídas, aprovações pendentes dos agentes, pedidos de acesso e outros eventos.",
    steps: [
      "Clique numa notificação para ir direto à tela relacionada.",
      "Use Marcar todas como lidas para limpar a lista.",
    ],
  },
  {
    id: "contatos",
    title: "Contatos",
    route: "/contacts",
    summary:
      "A lista de todas as pessoas com quem sua empresa conversa. Quem manda mensagem pelo WhatsApp entra aqui sozinho.",
    steps: [
      "Busque por nome, telefone ou e-mail, ou filtre por etiquetas.",
      "Clique em Adicionar contato para cadastrar alguém à mão. O telefone precisa ter DDI e DDD, por exemplo +55 11 99999-9999.",
      "Clique em Importar para trazer uma planilha CSV. As etiquetas da planilha são criadas automaticamente.",
      "Abra um contato para ver as conversas, os negócios, a temperatura (frio, morno, quente) e os dados de qualificação.",
      "Selecione vários contatos para excluir em lote.",
    ],
    tips: [
      "Campos personalizados (como CPF ou data de aniversário) são criados em Configurações › Campos e etiquetas e aparecem em todos os contatos.",
      "O sistema evita duplicados: um mesmo telefone em formatos diferentes vira um contato só.",
    ],
  },
  {
    id: "leads",
    title: "Leads",
    route: "/leads",
    summary:
      "Leads que chegam de anúncios e formulários: Facebook e Instagram Lead Ads, Google Ads e qualquer ferramenta que envie por webhook (Zapier, Make).",
    steps: [
      "Para receber leads do Facebook, clique em Conectar Facebook e escolha as Páginas. Só administradores podem fazer isso.",
      "Para Google Ads, abra o Tutorial Google Ads na própria tela e cole a chave indicada no formulário de lead do Google.",
      "Para Zapier ou Make, abra o tutorial correspondente e use a URL de webhook mostrada na tela.",
      "Cada lead novo aparece na lista com origem, data e dados preenchidos. Abra um lead para virar contato e iniciar a conversa.",
    ],
    tips: [
      "Todo lead com telefone ou e-mail já cai no primeiro funil, na primeira etapa, como \"Lead <origem> · <nome>\". Quem já tem um negócio aberto não ganha outro.",
    ],
  },
  {
    id: "funis",
    title: "Funis",
    route: "/pipelines",
    summary:
      "O quadro de vendas. Cada cartão é um negócio, e cada coluna é uma etapa do seu processo.",
    steps: [
      "Clique em Criar funil. As etapas padrão (Novo lead, Qualificado, Proposta enviada, Negociação, Ganho) já vêm prontas e podem ser mudadas.",
      "Clique em Adicionar negócio, escolha o contato e informe o título e o valor.",
      "Arraste o cartão entre as colunas conforme o negócio avança.",
      "Abra o negócio para marcar como Ganho ou Perdido, anotar e definir a data prevista de fechamento.",
    ],
    tips: [
      "Ninguém precisa criar o cartão de quem chega: o primeiro contato no WhatsApp ou no Instagram e cada lead de anúncio ou formulário já entram no primeiro funil, na primeira etapa. Quem já tem um negócio aberto não ganha outro.",
      "A moeda dos valores é definida em Configurações › Negócios e moeda.",
      "Você pode ter mais de um funil, por exemplo um para vendas e outro para pós-venda.",
    ],
  },
  {
    id: "agenda",
    title: "Agenda",
    route: "/agenda",
    summary:
      "Os horários marcados de cada profissional. Serve para ver quem está livre, marcar, remarcar e cancelar sem sair do CRM.",
    steps: [
      "Um administrador cria uma agenda para cada profissional (ou sala) no ícone de engrenagem e define os dias e horários de atendimento e a duração padrão da consulta.",
      "Na visão Semana você vê a semana de um profissional; na visão Dia, todos os profissionais lado a lado.",
      "Clique em um horário vazio, ou em Agendar, escolha o contato e salve. O horário fica reservado.",
      "Clique em Horários livres para ver as próximas vagas dentro do horário de atendimento e marcar direto em uma delas.",
      "Abra um agendamento para mudar a situação (Marcado, Confirmado, Realizado, Faltou), remarcar ou cancelar.",
      "Use Bloquear para férias, almoço ou feriado: ninguém consegue marcar naquele período.",
      "Para marcar sem sair do atendimento, use Marcar horário no painel do contato, na Caixa de entrada ou na ficha dele em Contatos › Tarefas.",
      "Para o cliente ser avisado, ligue a confirmação e o lembrete na engrenagem, em cada agenda, e ajuste o texto se quiser.",
      "Para o agente de IA marcar sozinho, abra o agente em Agentes e dê a ele a ferramenta Agenda. Ele passa a ver os horários livres dos próximos 10 dias e só oferece o que está livre.",
      "Para o cliente marcar sozinho, edite a agenda na engrenagem, ligue o Link público de agendamento e envie o link. Ele escolhe um horário livre e informa nome e WhatsApp.",
      "Para ver a agenda no celular, ligue Ver no Google Agenda, Apple ou Outlook na mesma tela e cole o endereço no aplicativo de agenda.",
    ],
    tips: [
      "Dois agendamentos não cabem no mesmo horário da mesma agenda: o sistema recusa o segundo.",
      "Na API oficial do WhatsApp, um texto só é entregue até 24 horas depois da última mensagem do cliente. Para o lembrete chegar sempre, escolha um modelo aprovado na agenda.",
      "Remarcar manda a confirmação de novo, com o horário novo. Desligue Avisar o cliente no agendamento de quem não quer receber.",
      "Agente com autonomia 1 ou 2 não marca sozinho: ele reserva o horário, que aparece tracejado como Aguardando aprovação, e você aprova ou recusa na própria agenda ou em Agentes › Aprovações.",
      "O agente de IA marca, mas não remarca nem cancela: nesses casos ele passa a conversa para uma pessoa.",
      "Pelo link público, a pessoa só vê os horários livres dos próximos 30 dias, nunca quem ocupa os outros. Desligar o link faz ele parar de funcionar na hora.",
      "Cada agendamento feito pelo link avisa no sino quem pode marcar. O que espera aprovação aparece no topo da Agenda, em Aguardando aprovação, seja qual for a semana.",
      "O endereço para Google, Apple e Outlook é só de leitura e o aplicativo atualiza a cada algumas horas. Ele mostra os nomes dos clientes, então passe só para quem pode ver a agenda.",
      "Dá para marcar fora do horário de atendimento, como encaixe. A tela avisa antes de salvar.",
      "Cancelar libera o horário e guarda o registro; ligue Mostrar cancelados para vê-los.",
      "Quem tem acesso de leitura vê a agenda, mas não marca nem altera.",
    ],
  },
  {
    id: "relatorios",
    title: "Relatórios",
    route: "/relatorios",
    summary:
      "Os números do período: conversas, fechamentos, valor ganho, desempenho da equipe e tempo de primeira resposta.",
    steps: [
      "Escolha o período no topo da tela.",
      "Leia cada cartão. O Tempo de primeira resposta mostra a mediana (o tempo típico) e o p90 (o pior caso de 1 em cada 10 clientes).",
      "Baixe os dados de qualquer cartão em CSV para usar numa planilha.",
    ],
  },
  {
    id: "agentes",
    title: "Agentes de IA",
    route: "/agents",
    summary:
      "Assistentes de inteligência artificial que respondem clientes, qualificam leads e fazem tarefas, com o nível de autonomia que você escolher.",
    steps: [
      "Em Chave e modelo, cole uma chave da OpenAI ou da Anthropic. Sem ela, os agentes ficam parados.",
      "Em Equipe, crie um agente a partir da biblioteca de modelos, ou do zero, e escreva as instruções dele.",
      "Defina a autonomia: só sugerir, pedir aprovação ou agir sozinho.",
      "Teste o agente na aba Teste antes de ativar.",
      "Acompanhe o que os agentes fazem em Trabalhando e aprove as ações pendentes em Aprovações.",
    ],
    tips: [
      "O custo da IA é cobrado pela OpenAI ou pela Anthropic, na conta da chave que você colou.",
    ],
  },
  {
    id: "automacoes",
    title: "Automações",
    route: "/automations",
    summary:
      "Regras que trabalham sozinhas: quando algo acontece (mensagem recebida, palavra-chave, contato novo), o sistema executa ações.",
    steps: [
      "Escolha um dos Modelos de início rápido ou clique em Criar automação.",
      "Defina o gatilho: o evento que dispara a automação.",
      "Adicione as ações em ordem: enviar mensagem, adicionar etiqueta, esperar, mover negócio e outras.",
      "Ative a automação. Use Ver registros para conferir cada execução.",
    ],
    tips: [
      "Automações com espera dependem do agendador do servidor estar ligado. Se uma espera nunca termina, fale com o suporte.",
    ],
  },
  {
    id: "fluxos",
    title: "Fluxos",
    route: "/flows",
    summary:
      "Conversas com botões e menus no WhatsApp: boas-vindas, perguntas frequentes e triagem antes de um atendente assumir.",
    steps: [
      "Clique em Novo fluxo, ou comece por um modelo.",
      "Monte o caminho no editor: cada bloco é uma mensagem, uma pergunta com botões ou uma decisão.",
      "Defina como o fluxo começa, por exemplo por uma palavra-chave.",
      "Publique o fluxo (status Ativo). Rascunhos não respondem ninguém.",
    ],
  },
  {
    id: "transmissoes",
    title: "Transmissões",
    route: "/broadcasts",
    summary:
      "Envio em massa para uma lista de contatos usando um modelo de mensagem aprovado pela Meta.",
    steps: [
      "Confira se o modelo que vai usar está aprovado em Configurações › Modelos.",
      "Clique em Nova transmissão, dê um nome e escolha o modelo.",
      "Escolha os destinatários, por exemplo filtrando por etiqueta.",
      "Envie agora ou agende. Depois, acompanhe entregues, lidas e respondidas na própria transmissão.",
    ],
    tips: [
      "A Meta cobra cada mensagem de modelo enviada. Os valores dependem da categoria do modelo (marketing, utilidade, autenticação).",
      "Mandar para quem não pediu derruba a qualidade do seu número. Envie só para quem conhece a sua empresa.",
    ],
  },
  {
    id: "canais",
    title: "Canais",
    route: "/canais",
    summary:
      "Onde você conecta os números de WhatsApp e o Instagram que vão falar com os clientes.",
    steps: [
      "API oficial da Meta: a forma recomendada para empresas. É configurada em Configurações › WhatsApp, com os dados do app da Meta.",
      "uazapi: conecta lendo um QR code com o celular, como no WhatsApp Web. O webhook é configurado sozinho.",
      "Evolution API: para quem já tem uma instância própria. Cole a URL, o nome da instância e a chave.",
      "Instagram Direct: as mensagens da conta profissional caem na mesma Caixa de entrada.",
    ],
    tips: [
      "Use a API oficial para operação séria: as conexões por QR code podem cair e o número corre mais risco de bloqueio.",
    ],
  },
  {
    id: "configuracoes",
    title: "Configurações",
    route: "/settings",
    summary:
      "Os ajustes da sua conta e da empresa, organizados em seções no menu à esquerda da tela.",
    steps: [
      "Seu perfil, Login e segurança e Aparência: seus dados, sua senha e o tema claro ou escuro.",
      "WhatsApp: as credenciais da API oficial da Meta.",
      "Modelos: as mensagens aprovadas pela Meta, usadas em transmissões e fora da janela de 24 horas.",
      "Respostas rápidas, Campos e etiquetas, Negócios e moeda: o que a equipe usa no dia a dia.",
      "Membros da equipe: convide pessoas e defina o papel de cada uma (administrador, atendente ou visualizador).",
      "Chaves de API e Extensão do Chrome: para ligar o CRM a outros sistemas e ao WhatsApp Web.",
    ],
  },
  {
    id: "whatsapp-oficial",
    title: "Conectar o WhatsApp oficial (API da Meta)",
    summary:
      "O passo a passo para ligar um número à API oficial do WhatsApp. Você precisa ser administrador do portfólio da empresa na Meta.",
    steps: [
      "Em developers.facebook.com, crie um app do tipo Empresa e adicione o caso de uso Conectar-se com clientes pelo WhatsApp.",
      "Na Etapa 1 do WhatsApp, anote o ID do número de telefone e o ID da conta do WhatsApp Business.",
      "Em business.facebook.com › Usuários do sistema, crie um usuário administrador, dê a ele acesso ao app e à conta do WhatsApp e gere um token sem validade com as permissões whatsapp_business_messaging e whatsapp_business_management.",
      "No CRM, em Configurações › WhatsApp, cole os dois IDs e o token, invente um token de verificação e um PIN de 6 dígitos e salve.",
      "Na Meta, em Configurar webhooks, cole a URL de callback mostrada no CRM e o mesmo token de verificação. Clique em Verificar e salvar e assine o campo messages.",
      "Publique o app na Meta. Enquanto ele estiver em desenvolvimento, as mensagens reais não chegam.",
      "Clique em Verificar com a Meta no CRM. O número de teste não recebe a primeira mensagem: crie um contato com o seu celular, envie o modelo hello_world e responda pelo WhatsApp.",
    ],
    tips: [
      "O token de acesso (começa com EAA) e o token de verificação são coisas diferentes. Nunca cole o token de acesso no campo de verificação.",
      "Se o CRM envia mas não recebe, a Chave Secreta do app na hospedagem (META_APP_SECRET) não é a do app da Meta ligado ao número.",
    ],
  },
  {
    id: "extensao",
    title: "Extensão do Chrome",
    summary:
      "Mostra os dados do CRM ao lado das conversas no WhatsApp Web: contato, temperatura e negócio, com troca de etapa ali mesmo.",
    steps: [
      "Em Configurações › Extensão do Chrome, baixe a extensão e instale no Chrome.",
      "Gere a sua chave pessoal na mesma tela.",
      "Na extensão, cole o endereço do CRM e a chave. Deve aparecer Conectado.",
      "Abra o WhatsApp Web e uma conversa: o painel do CRM aparece ao lado.",
    ],
  },
];

export interface HelpTip {
  title: string;
  body: string;
  /** Topic id on /ajuda with the long version. */
  topic?: string;
}

/** Short explanations for the ⓘ next to fields, keyed by place. */
export const HELP_TIPS = {
  "whatsapp.phoneNumberId": {
    title: "ID do número de telefone",
    body: "Um número longo que a Meta dá para cada telefone conectado. Fica em developers.facebook.com › seu app › WhatsApp › Etapa 1, ao lado do número. Não é o telefone em si.",
    topic: "whatsapp-oficial",
  },
  "whatsapp.wabaId": {
    title: "ID da conta do WhatsApp Business",
    body: "Aparece na mesma tela do ID do número, como Identificação da conta de mensagens. Sem ele as mensagens recebidas não chegam ao CRM.",
    topic: "whatsapp-oficial",
  },
  "whatsapp.accessToken": {
    title: "Token de acesso permanente",
    body: "Uma chave longa que começa com EAA. Gere em business.facebook.com › Usuários do sistema, com validade Nunca. O token da tela de teste da Meta expira em 24 horas.",
    topic: "whatsapp-oficial",
  },
  "whatsapp.verifyToken": {
    title: "Token de verificação",
    body: "Uma senha que você mesmo inventa, por exemplo minha-empresa-2026. Digite a mesma aqui e na Meta, em Configurar webhooks. Não é o token de acesso.",
    topic: "whatsapp-oficial",
  },
  "whatsapp.pin": {
    title: "PIN de verificação em duas etapas",
    body: "Registra o número na Meta para receber mensagens. Em número real, use os 6 dígitos da verificação em duas etapas. No número de teste da Meta, invente 6 dígitos e anote: eles viram o PIN do número.",
    topic: "whatsapp-oficial",
  },
  "whatsapp.webhookUrl": {
    title: "URL de callback",
    body: "Copie e cole na Meta, em Configurar webhooks. É por ela que as mensagens dos clientes chegam ao CRM.",
    topic: "whatsapp-oficial",
  },
  "contacts.customFields": {
    title: "Campos personalizados",
    body: "Informações extras que sua empresa quer guardar de cada contato, como CPF, plano ou data de aniversário. Valem para todos os contatos.",
    topic: "contatos",
  },
  "broadcasts.template": {
    title: "Por que precisa de modelo?",
    body: "O WhatsApp só deixa a empresa iniciar uma conversa com uma mensagem de modelo aprovada pela Meta. Cada envio é cobrado pela Meta.",
    topic: "transmissoes",
  },
  "automations.overview": {
    title: "Como funciona uma automação",
    body: "Um gatilho (o que acontece) e uma lista de ações (o que o sistema faz). Comece por um modelo pronto e ajuste.",
    topic: "automacoes",
  },
} satisfies Record<string, HelpTip>;

export type HelpTipId = keyof typeof HELP_TIPS;

/** The topic that explains the screen at `pathname`, if any. */
export function topicForPath(pathname: string): HelpTopic | undefined {
  return HELP_TOPICS.find(
    (t) =>
      t.route &&
      (t.route === "/dashboard"
        ? pathname === t.route
        : pathname === t.route || pathname.startsWith(`${t.route}/`)),
  );
}

/** Lower-case, accent-free text for the /ajuda search box. */
export function normalizeForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Topics whose title, summary, steps or tips contain every word of `query`. */
export function searchTopics(query: string): HelpTopic[] {
  const words = normalizeForSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return HELP_TOPICS;
  return HELP_TOPICS.filter((t) => {
    const haystack = normalizeForSearch(
      [t.title, t.summary, ...t.steps, ...(t.tips ?? [])].join(" "),
    );
    return words.every((w) => haystack.includes(w));
  });
}

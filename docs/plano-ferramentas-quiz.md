# Plano: aba "Ferramentas" e a primeira ferramenta, Quiz e formulários

Data: 12 de novembro de 2026. Status: **as quatro fases estão escritas e testadas, na branch `feat/ferramentas-quiz`**. Falta aplicar a migration 072 em produção e fazer o merge; os dois esperam o OK do dono.

## Andamento (12 de novembro de 2026)

O dono aprovou as cinco recomendações e pediu as quatro fases de uma vez. Um commit por fase.

- **Fase 1, feita:** botão Ferramentas, tabelas (migration 072), motor guiado por dados, modelo "Móveis planejados", página pública `/q/<endereço>`, lead pelo recebimento universal, Pixel, UTMs e registro de cada visita.
  - O modelo decide as 3.600 combinações de respostas igual ao quiz do zip (teste automático).
- **Fase 2, feita:** construtor com as abas Perguntas, Resultados e Aparência, prévia em formato de celular e rascunho separado do publicado.
- **Fase 3, feita:** aba Relatório com números, funil, respostas, campanha, criativo, aparelho, pessoas e CSV.
- **Fase 4, feita, com uma troca:**
  - lead parcial, por quiz, 30 minutos depois da última resposta;
  - API de Conversões da Meta, com o token cifrado;
  - código para incorporar em site;
  - domínio próprio pela variável `NEXT_PUBLIC_QUIZ_URL` (o passo a passo está em `docs/hospedagem.md`);
  - modelos de quiz da agência, que aparecem no "Novo quiz" de todos os CRMs;
  - no painel da agência, `/agencia/<crm>/quiz` mostra os números em qualquer nível de acesso e as pessoas só com "leitura" ou "total".

### O que ficou diferente do plano

- **Modelo de quiz dentro do modelo de CRM do nicho: não foi feito.** Aplicar um modelo de CRM é uma função do banco (migration 053), e incluir quizzes nela é uma mudança à parte. No lugar, os modelos de quiz da agência ficam disponíveis para todos os CRMs.
- **Limpeza das visitas antigas: não foi feita.** As visitas ficam guardadas sem prazo. Dá para criar a rotina depois, quando houver volume.
- **Tipos de pergunta:** texto curto, texto longo, número, nome, WhatsApp, e-mail, empresa, cidade e Instagram são campos. Uma tela pode ter um campo só ou vários.

### O que foi conferido e o que não foi

- **Conferido:**
  - 2.371 testes automáticos passando, entre eles a migration 072 rodando num Postgres de teste com as regras de acesso, e uma visita completa virando contato e lead pelo código real de recebimento;
  - build de produção;
  - no navegador, com dados de exemplo: o quiz do início ao resultado, as abas do construtor, a prévia e o relatório.
- **Não conferido:** o caminho inteiro contra o banco de produção, porque a migration 072 ainda não foi aplicada. Isso inclui criar um quiz pela tela, publicar, responder pelo link e ver o lead no CRM. É o primeiro teste a fazer depois de aplicar a migration.

### Depois de colocar no ar

1. Aplicar a migration 072 no Supabase.
2. Em **Ferramentas › Quiz e formulários › Novo**, criar o quiz a partir do modelo "Móveis planejados".
3. Preencher o que dependia de variável no quiz antigo: o ID do Pixel (Divulgação) e os links dos botões "Quero meu Raio-X" e "Quero o material" (Resultados).
4. Publicar, responder uma vez de ponta a ponta e conferir o lead no CRM.
5. Trocar o link nos anúncios. O quiz do Cloudflare pode ser desligado depois.

## O pedido

- Trazer para dentro do CRM o mini sistema de perguntas do `quiz-planejados.zip` (estilo Typeform).
- A agência e os clientes criam os próprios quizzes e formulários, e os leads caem direto no CRM de quem criou.
- Relatório por quiz: até onde cada pessoa respondeu, quantas visitas e cliques teve, e o que foi respondido.
- Um botão **Ferramentas** na barra de cima, ao lado do botão dos agentes. O quiz é a primeira ferramenta; outras entram depois no mesmo lugar.

## O que veio no zip

O "Quiz Harpium · Móveis Planejados", publicado no Cloudflare (`harpium-quiz-planejados`):

| Parte | Como está hoje |
|---|---|
| Telas | Entrada, nome, 9 perguntas de escolha, contato (WhatsApp, empresa, cidade/UF, Instagram) e resultado |
| Lógica | Uma pergunta só aparece para gerente. O título usa o nome da pessoa (`{nome}`) |
| Resultado | Regra A (qualificado), B (morno) e C (desqualificado), cada um com a própria tela, mais etiquetas extras (`decisor:sim`, `verba-baixa`, `prioridade-baixa`) |
| Lead | Ao concluir, o servidor manda o lead para a URL de recebimento do CRM (formato Harpium Lead v1) |
| Rastreio | UTMs, Pixel da Meta (`Lead` só na rota A; eventos próprios em B e C) e o mesmo `event_id` no Pixel e no CRM |
| Painel | `/painel` com senha: funil por tela, respostas, desempenho por criativo, lista de pessoas e CSV |

**O limite dele:** tudo está escrito no código. Mudar uma pergunta é editar um arquivo e publicar de novo, e cada quiz novo seria um projeto novo, com banco, senha e publicação próprios.

## O que o CRM já tem e será reaproveitado

- **Recebimento universal de leads:** cria ou atualiza o contato, aplica etiquetas, grava as respostas em campos personalizados, abre o cartão no funil e dispara "lead recebido" para automações, webhook e Agent SDR. O quiz vai gravar por esse mesmo caminho, direto, sem URL nem token no meio.
- **Página pública sem login:** o link de agendamento (`/marcar/...`) já é o molde: endereço difícil de adivinhar, limite de acessos por IP e nada de dado do CRM exposto.
- **Gráficos da tela de Relatórios:** barras por categoria e por dia, cartões de número.
- **Papéis e consentimento:** administrador e atendente em cada CRM, e o nível de acesso que o dono deu à agência.

## Como fica para quem usa

> **Barra de cima › Ferramentas › Quiz e formulários › Novo** → escolhe um modelo pronto ou começa do zero → monta as perguntas → publica → copia o link e põe no anúncio.

- **Ferramentas:** uma tela com um cartão por ferramenta. Hoje, "Quiz e formulários". As próximas aparecem ali.
- **Lista de quizzes:** nome, situação (rascunho, publicado, pausado), visitas, leads, taxa de conclusão e o link.
- **Cada quiz tem cinco abas:**

| Aba | O que faz |
|---|---|
| Perguntas | Telas em ordem: entrada, perguntas, contato. Arrastar para reordenar, duplicar, apagar |
| Resultados | As telas de resultado e a regra que leva a cada uma |
| Aparência | Logo, cor de destaque e textos dos botões |
| Divulgação | Link público, ID do Pixel, evento de cada resultado e montador de link com UTM |
| Relatório | Funil, respostas, campanhas e pessoas |

- **Link público:** `…/q/nome-do-quiz`. Abre sem login, no celular e no computador, com o mesmo visual do quiz do zip.

### Perguntas

- **Tipos:** escolha única (um toque avança), múltipla escolha, texto curto, texto longo, número, nome, WhatsApp, e-mail, cidade/UF, Instagram e tela só de mensagem.
- **Condição:** "mostrar só se a resposta da pergunta X for Y".
- **Nome no texto:** `{nome}` no título vira o primeiro nome da pessoa.
- **Formulário simples** é o mesmo quiz com uma tela de campos e um resultado só.

### Resultados

- Quantos resultados quiser, não só três.
- Cada resultado tem: título, texto, lista de itens, botão (link ou WhatsApp), etiquetas e o evento do Pixel.
- Cada resultado é marcado como **qualificado, morno ou desqualificado**. Isso vira a rota A, B ou C que o CRM já entende, então automações e o Agent SDR continuam filtrando como hoje.
- As regras são lidas de cima para baixo; a primeira que bater decide. Existe um resultado padrão para quem não cair em nenhuma.
- Etiquetas extras por resposta (ex.: respondeu "dono" → `decisor:sim`).

### O que chega no CRM quando a pessoa conclui

| No CRM | De onde vem |
|---|---|
| Contato criado ou atualizado | Nome, WhatsApp, e-mail, empresa, cidade, Instagram |
| Lead em "Leads recebidos", com a origem igual ao nome do quiz | A conclusão do quiz |
| Etiquetas | Do quiz, do resultado e das respostas |
| Campos personalizados | Cada pergunta e a resposta escolhida |
| Cartão no funil | Regra atual dos leads |
| Campanha e anúncio | UTMs do link |
| Automações, webhook e Agent SDR | Evento "lead recebido", como qualquer outro lead |

### Relatório

- **Números do período:** visitas, quantos começaram, quantos concluíram, taxa de conclusão e quantos caíram em cada resultado.
- **Funil por tela:** quantos chegaram a cada pergunta e onde pararam.
- **Respostas:** a distribuição de cada pergunta.
- **Cliques:** no botão de começar e no botão de cada tela de resultado.
- **Por campanha e por criativo** (`utm_campaign`, `utm_content`) e por aparelho (celular ou computador).
- **Pessoas:** uma linha por pessoa, com o resultado ou a tela em que parou, filtro por resultado e por abandono, link para o contato no CRM e exportação em CSV.
- **Filtro de período:** hoje, 7 dias, 30 dias, tudo.

O registro de cada visita começa na Fase 1, então o relatório da Fase 3 já nasce com o histórico.

## Decisões para você

| # | Decisão | Recomendação |
|---|---|---|
| 1 | **Endereço do link público.** No endereço do CRM (`harpium-crm.netlify.app/q/...`) ou num subdomínio próprio (ex.: `quiz.harpium.com.br/...`) | Começar no endereço do CRM na Fase 1 e ligar um subdomínio na Fase 4. É um registro na Cloudflare e um apelido no Netlify; os links antigos continuam valendo |
| 2 | **Visual.** O layout do zip com a marca de cada cliente, ou temas livres | O layout do zip, trocando logo e cor de destaque. Fontes e fundo ficam fixos, para todo quiz sair bonito sem trabalho |
| 3 | **Quem cria e edita.** | Administradores de cada CRM. Atendentes só veem o relatório. A agência entra pelo acesso que o dono já deu: com nível "total" edita; com "leitura" vê; com "métricas" vê só os números, sem nomes nem telefones |
| 4 | **Quem parou no meio vira lead?** Só acontece se o contato for pedido antes do fim | Não na Fase 1: só quem conclui vira lead, como no zip. Quem parou aparece no relatório. A opção "lead parcial" fica para a Fase 4 |
| 5 | **O quiz atual no Cloudflare.** | Recriar como o primeiro modelo pronto ("Móveis planejados") no CRM da agência, conferir lado a lado e só então trocar o link dos anúncios. O histórico do painel antigo fica lá; não é importado |

## Fases

Cada fase termina com um PR e uma demonstração. A migration e o merge esperam o seu OK, como sempre.

### Fase 1 · Ferramentas e o quiz no ar a partir do modelo (migration 072)

- Botão **Ferramentas** na barra de cima, ao lado do chip dos agentes, e no menu do celular. Tela `/ferramentas` com o cartão "Quiz e formulários".
- Tabelas dos quizzes e das visitas (`quizzes`, `quiz_sessions`), isoladas por CRM.
- O motor do quiz guiado por dados: telas, condição, `{nome}`, regras e resultados saem da definição guardada, não do código.
- Modelo pronto **"Móveis planejados"**, idêntico ao do zip: mesmas perguntas, mesma regra A/B/C, mesmas telas de resultado.
- Página pública `/q/<endereço>` com o visual do zip.
- Ao concluir, o lead entra no CRM pelo recebimento universal (tabela acima).
- UTMs, Pixel e `event_id` por quiz.
- Registro de cada visita, tela a tela, desde o primeiro dia.
- Ajustes sem construtor: nome, endereço do link, ID do Pixel, links dos botões de resultado, publicar e pausar.

**Pronto quando:** um quiz criado do modelo no CRM da agência responde igual ao do zip, e um teste completo deixa no CRM o contato, o lead com `rota-a`/`rota-b`/`rota-c`, as respostas nos campos, o cartão no funil e a automação de "lead recebido" disparada.

### Fase 2 · Construtor

- Criar do zero ou duplicar um quiz.
- Todos os tipos de pergunta, reordenar, condição e `{nome}`.
- Resultados e regras.
- Aparência: logo, cor e textos.
- Pré-visualização ao lado, no formato de celular.
- **Rascunho e publicado:** editar não mexe no que está no ar até clicar em Publicar.

**Pronto quando:** um administrador de um CRM cliente monta e publica um quiz novo sozinho, sem ajuda nossa.

### Fase 3 · Relatório

- Tudo da seção "Relatório" acima, na aba do quiz.
- Visitas, leads e conclusão na lista de quizzes.
- CSV das pessoas.

**Pronto quando:** dá para responder "em qual pergunta as pessoas desistem" e "qual criativo traz lead qualificado" sem sair do CRM.

### Fase 4 · Agência e extras (cada item é opcional)

- **Modelos de quiz no painel da agência:** montar uma vez e copiar para o CRM de um cliente, ou incluir no modelo de CRM do nicho.
- **Subdomínio próprio** (decisão 1).
- **Incorporar no site do cliente** (iframe). Hoje o CRM proíbe ser aberto dentro de outro site; a liberação valeria só para as páginas de quiz.
- **API de Conversões da Meta** pelo servidor, com o mesmo `event_id` do Pixel, para o lead não contar duas vezes.
- **Lead parcial** (decisão 4).

## Notas técnicas

- **Branch:** `feat/ferramentas-quiz`, criada da `main`. A pasta de trabalho está em `feat/leads-universal`, 24 commits atrás da `main`.
- **Migration 072:** produção está em 071. Segue o modelo da 068: membros leem, administradores escrevem, e a página pública grava pelo servidor.
- **O resultado é calculado no servidor.** No zip o navegador calcula a rota e o servidor confia. No CRM a mesma função roda dos dois lados: o navegador mostra a tela na hora e o servidor refaz a conta antes de gravar etiquetas e rota, para ninguém forjar um lead qualificado.
- **Página pública:** limite de acessos por IP, corpo de no máximo 20 KB, respostas conferidas contra a definição do quiz e um campo-isca contra robôs. Sem CAPTCHA.
- **Cache:** as páginas do CRM ficam até 5 minutos na borda. A definição do quiz é lida sem cache, para uma edição publicada valer na hora.
- **Visual do zip dentro do CRM:** o quiz usa Tailwind 3 e React 18; o CRM, Next 16 e React 19. As telas são reescritas no padrão do CRM, mantendo cores, tipografia e animações. Nada do zip roda como está.
- **LGPD:** a tela de contato pode levar um texto de consentimento com link para a política. O aceite vai junto com o lead, que já tem esse campo.
- **Volume:** cada visita é uma linha, atualizada a cada tela. Visitas sem contato com mais de 12 meses podem ser apagadas por rotina (a definir na Fase 3).
- **Antes de escrever código:** ler os guias em `node_modules/next/dist/docs/`, como pede o `AGENTS.md`.

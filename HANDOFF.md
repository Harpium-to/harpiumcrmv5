# Continuação — estado e próximos passos

Para quem assume o trabalho daqui. Escrito em novembro de 2026, depois
dos commits `a2b3c3d` e `7fc745c` na branch `feat/agencia-supervisao-ptbr`.

---

## 0. O passo bloqueante: aplicar as migrations

**Nada do que foi construído funciona até isso acontecer.** Treze
migrations estão no repo e não foram aplicadas:

| Migration | O que entrega | Sem ela |
|---|---|---|
| `044_agent_team.sql` | agentes e histórico de execução | `/agents` mostra estado vazio; auto-resposta cai no assistente único antigo |
| `045_agent_operation.sql` | cargo, autonomia, fila, aprovações, memória, qualificação de lead | a operação de agentes inteira some |
| `046_deal_close_timestamp.sql` | data real de fechamento de negócio | relatórios usam `updated_at` e se marcam como aproximados |
| `047_instagram_channel.sql` | canal Instagram, `conversations.channel` | Instagram não aparece; inbox inalterado |
| `048_report_first_response.sql` | função `report_first_response` + índice `messages(conversation_id, created_at, id)` | o cartão "Tempo de primeira resposta" em `/relatorios` explica que falta a migration |
| `049_plataforma_acesso.sql` | Fase 1 da plataforma (ver §1A): vários CRMs por usuário, consentimento de acesso da agência por CRM, papéis da agência | o app usa o caminho antigo (um CRM por usuário, agência sem papéis) — mesmo comportamento de antes |
| `050_ciclo_vida_crm.sql` | Fase 2 (ver §1B): a agência cria CRMs e convida o dono, status (implantação / ativo / suspenso / arquivado), carteira do gestor, convite preso a um e-mail | "Novo CRM" e a gestão do CRM respondem que falta a 050; o resto funciona como na 049 |
| `051_consentimento_agencia.sql` | Fase 3 (ver §1C): histórico do consentimento, pedidos de acesso da agência, notificação ao dono, registro do que a agência fez | a tela "Acesso da agência" mostra só o nível; pedir acesso responde que falta a 051 |
| `052_uso_plataforma.sql` | Fase 4 (ver §1D): dias de uso por membro (via heartbeat de presença) e `agencia_platform_usage()` | o painel mostra traços nas colunas de uso e explica que falta a 052 |
| `053_modelos_nicho.sql` | Fase 5 (ver §1E): modelos por nicho (Clínica médica, Academia, Serviços), aplicar e salvar CRM como modelo | "Modelos" explica que falta a 053; Novo CRM cria sem modelo |
| `054_extensao_chrome.sql` | 0B (ver §1F): chave pessoal da extensão para qualquer atendente | a tela da extensão oferece o download e diz que falta a 054 para conectar |
| `055_modo_suporte.sql` | Fase 6 (ver §1G): sair do modo suporte e auditoria de cada alteração da agência dentro do CRM do cliente | entrar funciona (049); sair responde que falta a 055 e nada é auditado além da entrada |
| `056_agencia_totais.sql` | totais do console da agência contados no banco (ver §3.4) | o console pagina as linhas (certo até 100 mil; acima disso a tela falha em vez de mostrar número errado) |

Elas são idempotentes e foram escritas para rodar em ordem. Cada
superfície degrada sozinha enquanto isso — nada quebra, só não existe.

Aplicar: pelo SQL editor do Supabase, ou `supabase db push` se o
projeto estiver linkado.

**Depois de aplicar, confira nesta ordem:** `/agents` lista agentes →
criar um pela biblioteca → `/relatorios` para de mostrar o aviso de
aproximação → o cartão de primeira resposta mostra números →
`/canais/instagram` aceita credenciais.

A 048 cria um índice em `messages`. Sem `CONCURRENTLY` (o SQL editor
roda tudo numa transação), então ela trava escrita em `messages` pelo
tempo de construir o índice — em conta pequena é instantâneo, em conta
grande rode fora do horário de pico.

**A 049 mexe na função de que todas as regras de acesso dependem**
(`is_account_member`). Faça backup antes, aplique fora do horário de
pico, e depois confira: entrar com um dono, um atendente e um
visualizador de clientes diferentes, cada um vê só o próprio CRM; a
lista de membros em Configurações continua igual; `/agencia/membros`
mostra o papel de cada um (os membros atuais viram Super admin).

---

## 1A. Fase 1 da plataforma — o que a 049 muda

Plano completo em `docs/plano-plataforma-agencia.md`. A Fase 1 é só
fundação: **nenhuma tela de cliente muda.**

- **`account_members`** é a fonte de verdade de quem está em qual CRM.
  Um usuário pode estar em vários. `profiles.account_id` passou a
  significar **o CRM aberto agora**, e `profiles.account_role` é só um
  espelho do papel nesse CRM, para a UI do cliente.
- **O RLS só enxerga o CRM ativo.** `is_account_member()` exige que o
  alvo seja o CRM ativo *e* que a pessoa seja membro (ou agência com
  consentimento). Isso evita que uma consulta sem `.eq('account_id')`
  misture dados de dois CRMs.
- **Consentimento da agência por CRM** (`account_agency_access`):
  `metrics` (nada linha a linha) / `read` (≈ visualizador) / `full`
  (≈ admin, nunca dono), mais acesso temporário que expira sozinho. Só
  o **dono** muda (`set_agency_access`). CRMs que já existiam começam em
  `read` (o que o console já mostra hoje); CRMs novos em `metrics`.
- **Papéis da agência** (`agencia_membros.role`): `super_admin`,
  `manager`, `support`. Os atuais viraram super_admin; novos começam
  em support. Suporte nunca passa de leitura.
- **RPCs novas:** `current_account_context` (o que `getCurrentAccount`
  usa), `list_my_accounts`, `set_active_account` (registra na
  auditoria quando é a agência entrando), `set_agency_access`.
- **Convite de dono** existe, mas só o service role cria (um admin não
  consegue se promover a dono por convite).
- **Cadastro** continua criando um CRM pessoal, atrás da flag
  `platform_settings.auto_personal_account`. A Fase 2 desliga junto com
  a tela "Aguardando liberação".
- **Apagar um CRM não apaga mais os perfis** de quem estava nele (a FK
  da 017 era `ON DELETE CASCADE`).
- **Upload de mídia** (chat-media, flow-media) passou a exigir papel de
  atendente ou acima.

O **console `/agencia` ainda lê tudo pelo service role**, sem olhar o
nível de consentimento. Isso é a Fase 3. Até lá, o consentimento só vale
para quem entra num CRM pelo caminho do RLS (`set_active_account`), que
ainda não tem tela.

Testes: `supabase/tests/plataforma-acesso.test.ts` roda as 49
migrations no PGlite, cria usuários no modelo antigo, aplica a 049 duas
vezes e cobre cada combinação papel × nível. Foram conferidos
sabotando a migration (tirar a regra do CRM ativo, tirar o limite do
suporte): 5 testes quebram.

---

## 1B. Fase 2 — ciclo de vida do CRM (050)

- **A agência cria o CRM** em `/agencia/novo`: nome, e-mail do dono,
  nicho, gestor responsável, nível de acesso proposto, observações. O
  CRM nasce **em implantação**, com um **convite de dono preso àquele
  e-mail** (vale 14 dias). O link aparece uma vez; se a pessoa já tem
  login, também vê o convite dentro do sistema, sem o link.
- **Dono provisório.** Webhooks gravam linhas com
  `accounts.owner_user_id` (colunas `user_id` são NOT NULL), então um
  CRM criado pela agência usa **quem o criou** como ponteiro até o
  cliente aceitar. Não é participação e não dá acesso. O dono de
  verdade é quem tem papel `owner` em `account_members` — o console já
  lê assim.
- **Status** aplicado no banco (`is_account_member`): suspenso = todo
  mundo só lê (mensagens continuam chegando por webhook); arquivado =
  some para todos, e quem estava nele é movido para outro CRM. Só a
  agência muda status, nicho, gestor e notas (`agencia_update_account`,
  com trigger que barra a sessão do cliente — nem o dono altera).
- **Carteira do gestor:** gestor só opera (admin) os CRMs em que é o
  responsável; nos outros, mesmo com acesso Total, só lê. Arquivar e
  trocar o gestor é só super admin.
- **Cadastro sem CRM:** `/aguardando` mostra os convites para o e-mail
  da pessoa e o botão de aceitar. O console lista quem está aguardando
  com "Criar CRM para esta pessoa". A chave "Cadastro novo cria um CRM
  pessoal" fica no fim de `/agencia` (super admin). **Continua ligada**
  até alguém desligar.
- **Trocar de CRM** e **Painel da agência** ficam no menu do perfil.
- **Convite de dono para um CRM existente** (ficha do CRM → "Convidar
  o dono" / "Passar a propriedade"): é como se monta o caso real — o
  CRM da Harpium com o dono definitivo.

Testes: `supabase/tests/ciclo-vida.test.ts` (17 casos, conferidos
sabotando a migration) e renderização do painel de gestão e da tela de
espera.

---

## 1C. Fase 3 — consentimento do cliente (051)

- **O console respeita o nível.** Contatos, inbox, conversa, quadro do
  funil, exportação e os blocos de contatos/conversas recentes da ficha
  checam o consentimento **antes de ler** (`loadConsentGate` em
  `src/lib/agencia/consent.ts`). Em Métricas nada pessoal é lido — nem
  e-mails da equipe do cliente — e a página mostra o motivo e o
  formulário de pedido. Antes da 049 não há consentimento e o console
  funciona como sempre; qualquer outra falha ao ler o nível fecha em
  Métricas.
- **Pedido de acesso** (super admin, ou gestor da carteira): nível,
  duração (permanente / 24 h / 3 dias / 7 dias) e motivo. O dono recebe
  uma notificação que abre direto a tela certa. Um pedido novo cancela
  o anterior; pedir o que já está liberado é recusado.
- **Configurações › Acesso da agência** (cliente): nível atual com a
  descrição de cada um, troca de nível e acesso temporário (só o dono,
  e funciona mesmo com o CRM suspenso), pedido pendente com Liberar /
  Recusar, aviso de LGPD em CRMs de saúde, e — para dono e admins —
  **o que a agência fez ali, com o nome de quem fez**, e o histórico
  de mudanças de nível.
- **Histórico do consentimento** (`account_agency_access_log`) é
  gravado por trigger: nenhum caminho muda o nível sem registro. Cada
  mudança leva a versão do texto aceito
  (`AGENCY_CONSENT_TERMS_VERSION` em `src/lib/agencia/crm.ts` — suba a
  versão se mudar o texto das descrições).

Testes: `supabase/tests/consentimento.test.ts` (14 casos). A sabotagem
achou um buraco no próprio teste — um atendente **negando** um pedido
só é barrado pela checagem de dono de `decide_agency_access_request`
(aprovar falha por outro caminho) — e o caso foi acrescentado.

Corrigido de passagem: a seção "Respostas rápidas" de Configurações
não tinha chave de tradução (`Settings.sections.quick-replies`).

---

## 1D. Fase 4 — painel da plataforma (052)

- **`/agencia` virou o Painel da plataforma**: números da carteira
  (ativos, em implantação, em risco, sem acesso há 7+ dias, suspensos,
  pessoas ativas, mensagens, ganhos — cada um filtra a tabela ao
  clicar), "Precisam de atenção", "Quem mais usa · quem menos usa",
  volume de mensagens e a **tabela de CRMs** com nota de saúde e
  tendência, último acesso, pessoas ativas, mensagens da semana com a
  variação, canal e alertas. Filtros por status, nicho, gestor, "só em
  risco" e "sem acesso"; ordena por saúde (pior primeiro), uso, último
  acesso ou nome. A ficha de cada CRM ganhou "Uso e saúde", com a nota
  decomposta.
- **De onde vem "uso":** `touch_presence()` (o heartbeat de presença
  que o app já manda a cada ~30 s) grava um dia em
  `account_activity_days` para cada membro com o CRM aberto e em
  primeiro plano. A agência dentro de um CRM de cliente **não conta**.
  Datas em horário de São Paulo. O histórico começa no dia em que a 052
  for aplicada (antes, só o último heartbeat de cada um).
- **`agencia_platform_usage()`** calcula tudo numa consulta, sob
  demanda (sem cron). Só agregados: aparece em qualquer nível de
  consentimento. Só o service role chama. Se o volume crescer muito,
  guarde a saída dela numa tabela diária e leia de lá.
- **Nota de saúde e alertas** ficam em TypeScript
  (`src/lib/agencia/health.ts`), com os pesos do plano e testes que
  dizem para que serve cada um. Ajuste ali. A tendência compara com a
  mesma nota uma semana antes.
- **Ainda não medido:** tempo de primeira resposta na nota (a função da
  048 é por CRM; a nota usa "conversas sem resposta há 24h+"), uso dos
  relatórios, token de canal perto de vencer.

Testes: `supabase/tests/uso.test.ts` (11 casos, conferidos sabotando a
migration), `health.test.ts`, `panel.test.ts` e renderização da tabela
e do cartão de saúde.

---

## 1E. Fase 5 — modelos por nicho (053)

- **Três modelos do sistema**, escolhidos pelo dono: **Clínica médica**
  (acesso sugerido: Métricas — dados de saúde), **Academia / Studio**
  (Leitura) e **Serviços / Agência** (Total). Cada um traz funil com
  etapas, etiquetas, campos, respostas rápidas e duas automações. O
  conteúdo está na própria migration, em português.
- **Na criação do CRM** (`/agencia/novo`) o modelo é pré-selecionado
  pelo nicho e já propõe o nível de acesso sugerido (se o operador não
  mexeu à mão). É aplicado logo depois da criação; se falhar, o CRM fica
  criado e a página diz para aplicar de novo.
- **Na ficha do CRM**: histórico do que foi aplicado, "Aplicar" e
  "Salvar como modelo". Aplicar é **aditivo** (o que já existe com o
  mesmo nome fica como está) e **mexe no CRM do cliente**, então só vale
  em implantação ou com acesso Total. Salvar copia só a estrutura —
  nunca contatos ou conversas — e exige mais que Métricas.
- **Automações chegam sempre desligadas.** Passos referenciam etiquetas
  e funis **pelo nome**; viram ids ao aplicar e voltam a nome ao salvar.
  Só passos que viajam entre CRMs são aceitos (nada que aponte para uma
  pessoa, um template da Meta, um webhook ou um campo por id).
- **`/agencia/modelos`**: lista, visão legível de cada modelo e editor
  (super admin) — nome, descrição, nicho, acesso sugerido, ativo, e o
  conteúdo em JSON validado por `parseTemplateContent`
  (`src/lib/agencia/templates.ts`), o mesmo validador que a API usa e
  que os testes rodam contra os três modelos da migration.
- **Ficou de fora**: vocabulário por nicho ("paciente" / "aluno"),
  agentes de IA no modelo, campos de tipo diferente de texto (o app só
  edita texto hoje — as opções sugeridas ficam guardadas no campo),
  lembrete de consulta (não há agenda no sistema).

Testes: `supabase/tests/modelos.test.ts` (15 casos, conferidos
sabotando a migration), `templates.test.ts`, `template-store.test.ts`
e renderização da visão do modelo e do bloco da ficha.

---

## 1F. Extensão do Chrome visível no CRM (054)

- **Menu do perfil › Extensão do Chrome** e **Configurações › Extensão
  do Chrome** (grupo Conta: cada pessoa instala no próprio navegador).
- **Instalar:** botão "Baixar extensão (.zip)" + os 4 passos. O `.zip`
  é gerado por `scripts/build-extension-zip.mjs` antes de `next build`
  e `next dev` (`prebuild` / `predev`) em `public/downloads/` (fora do
  git). Node puro, sem dependência, reproduzível; o teste confere com
  `unzip -t`. Quando a extensão estiver na Chrome Web Store, defina
  `NEXT_PUBLIC_EXTENSION_STORE_URL` e o botão vira "Adicionar ao Chrome".
- **Conectar:** "Gerar minha chave" cria uma chave **pessoal** (só
  atendente ou acima; nunca a agência dentro do CRM) com exatamente os
  escopos da extensão — fixados no banco. Mostra endereço do CRM e chave
  para copiar, uma vez. Gerar outra revoga a anterior; sair do CRM ou
  virar visualizador revoga sozinho. Status "Conectada · último uso".
- **A API pública passou a respeitar o status do CRM** (brecha da
  Fase 2): suspenso = só leitura também pela API; arquivado = chave
  recusada (`src/lib/auth/api-context.ts`).
- **Nome da extensão** continua "CRM Connector" no `manifest.json`.
  Trocar para a marca da plataforma é decisão do dono.

## 1G. Fase 6 — modo suporte (055)

- **Ficha do CRM no console › "Entrar no CRM"**: aparece quando o dono
  liberou Leitura ou Total; o rótulo diz com que papel (Total = admin
  para super admin e gestor da carteira; o resto, leitura). Abre o CRM
  do cliente como ele é, no `/dashboard`.
- **Dentro do CRM**, uma faixa fixa: "Modo suporte: você está no CRM X
  pela agência, como …. Tudo o que você alterar aqui fica registrado
  para o dono", com **Sair do modo suporte** (volta ao console e ao CRM
  da própria pessoa). A faixa lê `/api/account/context` (servidor), não
  o espelho do perfil.
- **Auditoria de cada alteração**: trigger em contatos, negócios,
  conversas (criar/excluir), mensagens (enviar), automações, fluxos,
  disparos, funis, etiquetas, campos e respostas rápidas grava
  `<tabela>_<operação>` quando quem escreve é a agência. O dono lê em
  Configurações › Acesso da agência ("Criou um contato", "Enviou uma
  mensagem"…). Escritas feitas por rotas com service role não têm
  usuário e não entram.
- **Limite conhecido:** os membros do cliente não veem o nome de quem da
  agência escreveu algo (a regra de perfis só mostra colegas do CRM).

Testes: `supabase/tests/extensao.test.ts` (7) e `modo-suporte.test.ts`
(7), ambos conferidos sabotando a migration; zip; API pública com CRM
suspenso/arquivado; renderização da tela da extensão e da faixa.

---

## 1. O que está pronto

- **Design** — sistema de tokens em `globals.css`, acento dirige os
  neutros, rail + top bar, ~25 rotas.
- **Agentes** — cargo, autonomia 1–4, ferramentas, canais, horário com
  fuso, metas, 9 estados operacionais, custo. Fila com `FOR UPDATE SKIP
  LOCKED`, runner, cron, aprovações com trava de uso único, memória
  semântica, fábrica em linguagem natural, visualização de rede,
  duplicar, avatar.
- **Relatórios** — 16 recortes, export CSV, impressão em PDF, analista
  comercial IA, atingimento de meta.
- **Instagram Direct** — parse, webhook assinado, envio, config, canal
  na conversa.
- **Extensão de Chrome** — MV3 em `extension/`, autenticada por chave
  de API, painel no WhatsApp Web.

882 testes passando, nenhuma falha.

---

## 2. O que falta, em ordem de valor

### 2.1 Prospecção real na web — **precisa de decisão do dono, não de código**

O agente prospector tem cargo, prompt e ferramentas, mas buscar
empresas exige um provedor de busca. O tipo de tarefa `prospect` falha
de propósito com `unsupported_kind` em `src/lib/agents/runner.ts` em
vez de fingir que rodou.

Antes de escrever qualquer coisa, **pergunte ao dono**: qual provedor
(Serper, Exa, Apify, scraping próprio), qual custo aceitável por lead,
e o que é legal raspar no contexto dele. Não escolha por ele — é
dinheiro recorrente e risco jurídico.

Quando decidido: a ferramenta entra em `src/lib/agents/tools.ts`
(`research` já existe como capacidade), e o runner ganha um
`runProspectTask` ao lado de `runMessageTask` / `runAnalysisTask`.

### 2.2 Instagram: mídia e janela de 24 horas

Hoje o canal manda e recebe **só texto**. Mídia recebida vira um
marcador (`[imagem]`, `[menção em story]`).

- Baixar a mídia da Graph API e guardar no bucket, como o webhook do
  WhatsApp já faz em `src/app/api/whatsapp/webhook/route.ts`.
- Enviar imagem (`message: { attachment: {...} }`).
- A janela de 24 horas: a Meta recusa envio fora dela. O erro já chega
  com o texto da Meta até o inbox (`InstagramApiError` →
  `sendInstagramToConversation`), mas a UI poderia **avisar antes** de
  a pessoa digitar, comparando `last_message_at` com agora.

### 2.3 Instagram: conectar por OAuth em vez de colar token

Hoje a configuração é colar o ID da conta e o token da Página. Existe
OAuth de Facebook funcionando no repo
(`src/app/api/meta/oauth/start` + callback, usado pelo Lead Ads) que
já lista Páginas e guarda token cifrado. Dá para reaproveitar quase
inteiro: pedir também `instagram_basic` e
`instagram_manage_messages`, e listar as contas de Instagram
vinculadas às Páginas.

**Por que não foi feito:** exige um app Meta revisado com essas
permissões, processo de semanas que só o dono da conta inicia. O
formulário funciona no dia em que a permissão sai.

### 2.4 Extensão: empacotar e ampliar

- Publicar na Chrome Web Store (ou distribuir o `.zip` para carregar
  sem compactar — `extension/README.md` tem as instruções).
- Comandos rápidos além de ver/criar: marcar temperatura, mudar etapa
  do funil. **A API já aceita a primeira parte:** o
  `PATCH /api/v1/contacts/[id]` recebe `temperature`, `potential`,
  `segment`, `source`, `city`, `job_title`, `instagram`, `website`
  (validação em `parseContactPatch`, `src/lib/api/v1/contacts.ts`), e
  a ferramenta `update_contact` do MCP também, e o painel da extensão
  tem o seletor Frio / Morno / Quente. Mudar etapa também está feito:
  `/api/v1/deals` (listar, ler, `PATCH` com `stage_id` validado contra o
  funil do próprio negócio), `/api/v1/pipelines`, escopos `deals:read`
  / `deals:write`, ferramentas MCP e o seletor de etapa no painel.
  Criar negócio pela API ainda não existe.

### 2.5 ~~Relatórios: tempo de primeira resposta~~ — feito

RPC `report_first_response` na migration 048 (pareamento com
`LATERAL`, testado no PGlite). Uma rajada de mensagens do cliente conta
como uma espera; sem resposta conta à parte, nunca como zero; tempo de
relógio, não horário comercial (a conta não guarda horário). Cartão em
`src/components/reports/first-response.tsx`, CSV
`first_response_by_day`, e o analista IA recebe os números.

O dashboard ainda usa a versão própria em `loadResponseTime`
(`src/lib/dashboard/queries.ts`, duas semanas, em TypeScript). Dá para
apontá-lo para a RPC depois que a 048 estiver aplicada.

---

## 3. Dívidas que eu encontrei e NÃO consertei

Não são minhas, mas são reais e alguém vai tropeçar nelas.

### 3.1 ~~O dashboard trunca em 1000 linhas~~ — corrigido

`src/lib/dashboard/queries.ts` agora lê mensagens e negócios por
`fetchAllRows` (com `id` como desempate da ordenação) e soma `value`
com `num()` — antes, `NUMERIC` em string concatenava em vez de somar.
Coberto por `src/lib/dashboard/queries.test.ts`.

### 3.2 ~~Dois testes falhando por fuso~~ — corrigido

`date-utils.test.ts` constrói datas locais (`new Date(2026, 4, 18)`).

### 3.4 ~~O console da agência truncava em 1000 linhas~~ — corrigido

`listAccountsOverview`, `getAgencyOverview`, `getAccountMetrics`,
`getAccountDetail` e `getAccountBoard` (`src/lib/agencia/queries.ts`)
somavam linhas em JS sem paginar: contatos, conversas, negócios e o
gráfico de mensagens paravam de crescer quando a carteira inteira
passava de 1000 linhas. Agora os totais vêm de
`agencia_account_totals()` e `agencia_message_stats()` (056), que
devolvem **um** jsonb — função que retorna linhas bateria no mesmo
limite. Sem a 056, `src/lib/agencia/totals.ts` pagina com
`fetchAllRows`. Negócios de um CRM e membros também paginam; o quadro
busca nomes de contato em lotes de 200.

### 3.3 ~~Avatares órfãos no storage~~ — corrigido

`src/lib/storage/avatars.ts`: depois que o perfil ou o agente salva, o
arquivo antigo é apagado — só se nenhum agente ou perfil visível ainda
aponta para ele (duplicar agente copia o `avatar_url`). Upload cujo
save falha também é apagado. Arquivo na pasta de outro usuário fica:
a policy do bucket só deixa apagar a própria pasta.

---

## 4. Convenções deste repo que uma sessão nova vai errar

Eu errei metade destas antes de olhar o código ao redor.

1. **`numeric` volta como string do PostgREST.** `'1200.00' + '800.00'`
   é `'1200.00800.00'`. Toda soma de dinheiro passa por `Number()` —
   ver `num()` em `src/lib/reports/aggregate.ts`.

2. **Embedding de pgvector viaja como texto.** Array JSON não coage
   para `vector` atravessando o PostgREST. A função SQL recebe `text` e
   faz `::vector(1536)` dentro; o TS manda `toVectorLiteral(...)`. Ver
   `src/lib/agents/memory.ts` e a migration 030.

3. **O `select()` do supabase-js é parseado em tempo de compilação.**
   String montada dinamicamente transforma todas as colunas em
   `unknown` e um nome errado vira 400 em produção em vez de erro de
   build. Use dois selects literais num ternário — ver
   `loadContacts` em `src/lib/reports/queries.ts`.

4. **`next-intl` explode em chave faltante.** Nunca monte chave
   concatenando valor de coluna livre (`t(\`role${agent.role}\`)`). O
   padrão aqui é uma função que devolve `null` para valor
   desconhecido — ver `roleLabelKey`, `goalLabelKey`.

5. **O lint do React Compiler reclama de função que *devolve*
   componente.** Exporte um `Record<string, LucideIcon>` e leia a
   propriedade no call site — ver `src/components/agents/agent-icon.tsx`.

6. **Tipagem de rota dinâmica:** `{ params }: { params: Promise<{ id:
   string }> }`. O tipo `RouteContext<>` só existe depois de um
   `next typegen` e quebra o build limpo.

7. **O índice único de telefone é parcial** (`WHERE phone_normalized
   <> ''`). É o que permite um contato sem telefone (Instagram)
   conviver com a unicidade. Não "conserte" para total.

8. **`CONVERSATION_SELECT` é `*`.** Coluna nova em `conversations`
   aparece sozinha quando a migration roda, e some sem quebrar antes.

9. **Esta build do lucide não tem ícones de marca** (removidos por
   marca registrada). Sem `Instagram`, sem `Chrome`. Use genéricos
   (`AtSign`, `Puzzle`).

10. **Migrations são idempotentes.** `IF NOT EXISTS`, `DROP POLICY` antes
    de `CREATE POLICY`, `DO $$` para constraint.

11. **`.surface` não carrega blur.** Quem precisa pede `.surface-blur`.
    Cada `backdrop-filter` força composição offscreen própria, e
    `.surface` é o que todo `Card` resolve.

12. **Marcas de gráfico usam os tokens `--viz-*`**, não o acento. O
    acento é afinado para botão; `sand` é um creme que some como barra
    sobre card claro. Os tokens foram validados contra as superfícies
    reais (contraste, croma, separação sob daltonismo). Se mudar,
    revalide — verde/vermelho reprova.

13. **Quem está num CRM é `account_members`, não `profiles.account_id`**
    (049). `profiles.account_id` é só o CRM aberto agora. Para listar
    membros, contar usuários de um CRM ou checar participação, leia
    `account_members`. O mesmo vale para "quem é o dono": é o membro
    com papel `owner`, não `accounts.owner_user_id` (050 usa esse campo
    como ponteiro provisório da agência). E não confie em `profiles.account_role` no
    servidor: use `getCurrentAccount()`, que pergunta ao banco e
    acompanha um acesso temporário da agência expirando.

14. **Regra de acesso nova = teste no PGlite.** `supabase/tests/`
    roda as migrations de verdade. Mexeu em policy, RPC `SECURITY
    DEFINER` ou `is_account_member`, acrescente o caso lá. Função que
    recebe um id de usuário arbitrário precisa de `REVOKE ... FROM
    PUBLIC, anon, authenticated`: o Supabase concede `EXECUTE`
    explicitamente a esses papéis, e `FROM PUBLIC` sozinho não tira.

---

## 5. Como verificar

```bash
npx tsc --noEmit                 # precisa sair limpo
npx eslint .                     # 0 erros (43 warnings pré-existentes)
npx vitest run                   # 1139 passando (inclui supabase/tests)
npx next build                   # precisa compilar
```

Telas logadas não foram verificadas visualmente em nenhuma sessão até
aqui — não havia sessão no navegador e não se entra com credenciais do
dono. O que dá para fazer sem login, e foi feito: renderizar os
componentes com `renderToStaticMarkup` e conferir a saída (ver
`src/components/agents/agent-network.test.tsx` e
`src/components/reports/charts.test.tsx`). **Vale repetir esse padrão
em vez de assumir que a tela está certa.**

---

## 6. Decisões que parecem erro e não são

Não "conserte" estas sem entender o porquê:

- **O analista IA recalcula os números no servidor** em vez de receber
  os da tela. Quem pudesse mandar os números faria o analista
  confirmá-los em prosa convincente.
- **Meta sem fonte de medição não vira 0%.** Não há tabela de agenda
  nem de propostas, e `deals` não tem atribuição a agente IA. 0% leria
  como agente falhando, e alguém desligaria um agente que funciona.
- **Ganho/perdido é azul↔vermelho, não verde/vermelho.** Verde e
  vermelho medem ΔE 4.1 sob deuteranopia e num segmento de barra não
  cabe ícone.
- **A extensão devolve `null` em vez de palpite** quando não reconhece
  a conversa. Registro do cliente errado ao lado da conversa de outro
  é pior que painel vazio.
- **O parser do Instagram descarta eco.** A Meta devolve as nossas
  próprias mensagens; ingerir isso com auto-resposta ligada é um
  agente conversando consigo mesmo, cobrado por turno.
- **`fetchAllRows` estoura em vez de truncar.** Relatório que entrega
  60% de outubro em silêncio é pior que relatório que falha.
- **Autonomia: ferramenta é checada antes do nível.** Senão aprovar
  concederia a ferramenta que falta.

# Plano: distribuição de atendimento — setores, transferência e a IA escolhendo para quem passar

Documento de planejamento. Escrito em 20/11/2026 a partir do `main` do CRM
(`af88875`).

**Andamento:**

- 20/11/2026: plano escrito e **aprovado** pelo dono ("pode ir fazendo tudo"),
  com todas as decisões do §8 conforme a recomendação.
- 20/11/2026: **Fases 1 a 5 implementadas** no ramo
  `feat/distribuicao-atendimento` (a 6 ficou de fora: decisão separada).
  Migrations **076**, **077** e **078**. **Nada publicado ainda**: falta
  aplicar as três migrations em produção, nesta ordem, e fazer o merge
  (ver "Para pôr no ar", no fim).

### O que mudou em relação ao plano

- **"Retomar IA" tira a conversa do setor.** A função de transferência
  ganhou `p_leave_team`, e um gatilho faz o mesmo quando a IA volta numa
  conversa sem responsável. Assim, a conversa nunca aparece na fila de um
  setor enquanto o robô responde.
- **A distribuição na chegada só roda depois que a IA decide** (mensagem de
  texto, fora de fluxo). Mensagem só de mídia não dispara a regra de
  chegada; a próxima mensagem de texto dispara.
- **A reabertura é marcada pelo banco** (`reopened_pending`), só quando quem
  reabre é a mensagem do cliente. Assim a regra de retorno vale igual nos
  quatro canais, e reabrir a conversa na caixa de entrada não conta como
  retorno.
- **O modelo de nicho com setores foi junto na 078**, não numa migration à
  parte.
- **Não feito:** "sem atendente" e "prazo estourado" por setor no painel da
  agência e no Agency OS (Fase 5). Isso pede mudar as funções de uso da
  plataforma (052/056) e o Agency OS. O prazo estourado já avisa o dono e os
  administradores do CRM.

---

## 1. O pedido

> Numa clínica com vários atendentes (recepção, financeiro, a secretária de
> cada dentista), a conversa tem que chegar em quem resolve. A IA, ou o
> próprio sistema, identifica o assunto e manda para a pessoa certa. Qualquer
> atendente consegue passar a conversa para outro. Nada fica perdido, e quem
> recebe já sabe do que se trata.

## 2. A resposta curta

- **A transferência manual já funciona.** O que falta é o sistema decidir
  sozinho, de forma justa, e nenhuma conversa se perder.
- Entra um conceito novo, o **setor**. É um grupo de pessoas que resolve um
  assunto (Recepção, Financeiro, Orçamentos, Dra. Ana), com uma frase dizendo
  o que ele resolve. Dentro de cada setor, uma regra escolhe a pessoa:
  rodízio, quem está com menos conversas, ou fila (quem pegar primeiro).
- **A IA escolhe o setor lendo essa frase**, na mesma resposta em que ela já
  decide passar a conversa. Não há chamada de IA a mais nem custo a mais.
- Tudo é opcional: um CRM sem setores continua funcionando como hoje.
- São 6 fases. A primeira conserta o que está quebrado e já ajuda quem não
  tem setor nenhum.

## 3. Como está hoje (conferido no código)

### O que já funciona e vamos aproveitar

| O quê | Onde |
|---|---|
| Menu **Atribuir** no topo da conversa, com a bolinha de online | `src/components/inbox/message-thread.tsx` |
| Quem recebe ganha notificação no sino | gatilho `on_conversation_assigned` (`027_notifications.sql`) |
| **Assumir** e **Retomar IA**, também pela API pública | `ai-thread-banner.tsx`, `src/lib/api/v1/conversation-state.ts` |
| A IA passa para uma pessoa: avisa o cliente, se pausa, deixa um resumo e a conversa vai para **Aguardando**, com alerta | `src/lib/ai/auto-reply.ts`, `058_aguardando_atendente.sql` |
| A Harpi atribui conversa, com confirmação e desfazer | `src/lib/assistente/tools/crm.ts` (`atribuir_conversa`) |
| Automação "Atribuir conversa → pessoa específica" | `src/lib/automations/engine.ts` |
| Presença online/ausente de cada pessoa | `024_member_presence.sql`, `src/hooks/use-presence.ts` |
| Tempo até a 1ª resposta por pessoa, nos relatórios | `report_first_response` (048) |
| Uma agenda por profissional | `calendars` (067) |
| O agendador externo (cron-job.org) que já chama o CRM a cada poucos minutos | `/api/automations/cron` |

### O que está quebrado ou faltando

1. **O "Rodízio" não faz rodízio.** É a opção padrão de "Atribuir conversa"
   (no construtor, no modelo de automação e na Harpi). Só que o motor pega
   `profiles … limit(1)`, sem ordem, e tudo cai na mesma pessoa. Além disso,
   `profiles.account_id` inclui quem da agência estiver dentro do CRM naquele
   momento, porque entrar no CRM de um cliente muda esse campo
   (`set_active_account`). O próprio código marca o trecho como provisório.
2. **A IA não escolhe o destino.** Ela decide *quando* passar, mas manda
   sempre para uma pessoa só (Configurações › IA › "Passar para") ou para a
   fila geral. A coluna `agents.handoff_agent_id` (044) existe e o código já a
   respeita, mas não há campo no formulário do agente e a API não a aceita
   (`src/lib/agents/payload.ts`). Na prática, ela fica sempre vazia.
3. **Não existe setor.** `agents.department` é só um rótulo do agente de IA,
   não um grupo de pessoas.
4. **A caixa de entrada não tem "Minhas" nem "Sem responsável".** Os filtros
   são Todas, Aguardando, Não lidas, Abertas, Pendentes e Fechadas, mais
   etiqueta e empresa.
5. **Transferir não leva nota nem deixa histórico.** O menu grava direto do
   navegador e nada registra quem passou para quem. A notificação é genérica
   e está em inglês no banco ("New conversation assigned").
6. **O gatilho de automação "Conversa atribuída" nunca dispara.** Ele aparece
   no construtor, mas o motor só é acionado por mensagem recebida, lead
   recebido, sequências da API e um endpoint manual.
7. **O bloco "Passar para humano" dos fluxos não deixa escolher ninguém.** O
   motor aceita `assign_to`, mas a tela só tem "nota interna", e essa nota
   fica só no registro do fluxo. A conversa também não entra em Aguardando,
   porque hoje só a IA marca isso.
8. **Mensagem sem palavra-chave, num CRM sem agente padrão, fica parada.**
   Ninguém responde e ninguém é avisado (`auto-reply.ts`:
   `if (!route) return`).
9. **Paciente que volta.** No UAZAPI, na Evolution e no Instagram, a conversa
   encerrada reabre com o mesmo responsável. Se ela tinha sido passada, a IA
   continua pausada. Se o responsável estiver de folga, ninguém fica sabendo.
   **Na API oficial do WhatsApp, ela nem reabre:** continua em "Fechadas" e só
   ganha o contador de não lidas. O update de
   `src/app/api/whatsapp/webhook/route.ts` não volta o `status` para `open`,
   como os outros três canais fazem.
10. **Não existe prazo.** Uma conversa atribuída a quem não responde fica
    parada. Só o painel da agência mostra "sem resposta há 24h+".

## 4. Como vai ficar para quem usa

### 4.1 As palavras

- **Responsável:** a pessoa que cuida da conversa agora (já existe).
- **Setor:** um grupo de pessoas que resolve um assunto. Tem nome, cor,
  pessoas e uma frase dizendo **o que resolve**. A IA lê essa frase. Um setor
  pode ter uma pessoa só ("Dra. Ana"), então "mandar para a pessoa certa" e
  "mandar para o setor certo" viram a mesma coisa.
- **Distribuição:** como o setor escolhe a pessoa:
  - **Rodízio:** um para cada, na vez;
  - **Menos ocupado:** quem tem menos conversas abertas;
  - **Fila:** ninguém é escolhido; fica com a conversa quem do setor clicar
    primeiro em **Pegar**.
- **Transferência:** passar a conversa para uma pessoa ou um setor, com uma
  nota opcional. Fica registrada na conversa.

### 4.2 Um dia na clínica

1. **9h02.** O paciente escreve: "Oi! Dá pra parcelar o implante?". O agente
   de IA "Recepção" responde o que sabe e percebe que o assunto é do
   financeiro. Ele escreve "Vou te passar para o nosso financeiro, já te
   respondem" e passa a conversa para o setor **Financeiro**.
2. O Financeiro está em **Rodízio, só para quem está online**, e hoje a vez é
   da Carla. No sino dela aparece: *"Recepção (IA) passou para você a conversa
   com João · Financeiro · quer parcelar o implante"*. A conversa aparece em
   **Minhas**, com a faixa Aguardando.
3. **9h20.** A Carla ainda não respondeu, e o prazo do setor é de 15 minutos.
   Conforme a configuração do setor, a gestora recebe um aviso ou a conversa
   vai para o próximo da vez.
4. A Carla vê que o paciente quer fazer uma avaliação antes. Ela clica em
   **Transferir → Dra. Ana** e escreve a nota "quer avaliar antes de fechar".
   Na conversa aparece a linha *"Carla passou para Dra. Ana · quer avaliar
   antes de fechar"*, e a Dra. Ana recebe a notificação com a nota.
5. A conversa é encerrada. Três dias depois o paciente volta. Como ele falou
   com a Dra. Ana há menos de 7 dias e ela está online, a conversa volta
   direto para ela. Se tivessem passado dois meses, a IA atenderia do zero.

### 4.3 Caixa de entrada

- **Filtros novos:** Minhas, Sem responsável e, com setores, **Fila dos meus
  setores** e **Setor ▾**. Cada um tem contador. A caixa lembra o último
  filtro de cada pessoa.
- **Linha da conversa:** mostra as iniciais do responsável e a etiqueta
  colorida do setor.
- **Topo da conversa:** o menu "Atribuir" vira **Transferir**. Escolhe-se uma
  pessoa ou um setor e escreve-se uma nota opcional. Cada pessoa aparece com a
  bolinha de online e o número de conversas abertas. O atalho **Assumir**
  continua.
- **Dentro da conversa:** as passagens aparecem como linhas discretas entre
  as mensagens, no estilo do separador de data. Elas não vão para o cliente.
- **Conversa na fila de um setor:** tem o botão **Pegar**. Se duas pessoas
  clicarem juntas, só uma fica com a conversa.

### 4.4 Configurações › Equipe

- Cada pessoa ganha a chave **Recebe conversas**. Ela é desligada para quem
  não atende (o dono, um dentista) ou para quem está de férias. A própria
  pessoa liga e desliga a chave pelo menu do avatar ("Pausar recebimento").
- Aba nova **Setores**. Cada setor tem:
  - nome e cor;
  - **o que esse setor resolve** (ex.: "boletos, pagamentos, parcelamento,
    nota fiscal"), com o aviso de que a IA lê esse texto;
  - as pessoas do setor;
  - **como distribuir:** Rodízio, Menos ocupado ou Fila;
  - **só para quem está online**;
  - limite de conversas abertas por pessoa (opcional);
  - prazo para responder, e o que fazer quando ele estoura: avisar a gestão
    ou passar para o próximo;
  - **setor de entrada:** um por CRM. Recebe o que ninguém soube classificar.
- Só admin ou dono cria e edita setores. Qualquer atendente transfere.

### 4.5 A IA

Em Configurações › IA, e em cada agente de IA, entra o campo **"Quando passar
para uma pessoa"**:

- **A IA escolhe o setor:** é o padrão quando o CRM tem setores;
- **Sempre este setor;**
- **Sempre esta pessoa;**
- **Fila geral:** o que acontece hoje.

O teste da IA passa a mostrar "passaria para: Financeiro". Assim dá para
conferir a configuração antes de ligar.

### 4.6 Fluxos, automações, Harpi e API

- **Fluxo:** o bloco "Passar para humano" ganha "Para: setor, pessoa ou fila
  geral". A nota aparece na conversa, e a conversa entra em Aguardando.
- **Automação "Atribuir conversa":** tem Rodízio (agora de verdade), Pessoa
  específica e **Setor**. O gatilho "Conversa atribuída" passa a disparar. Por
  exemplo: mandar "Oi, sou a Carla e vou continuar seu atendimento".
- **Harpi:** entende pedidos como "passa a conversa do João para o
  financeiro, com a nota 'quer parcelar'".
- **API pública:** ganha `POST /api/v1/conversations/{id}/transfer` e o
  webhook `conversation.assigned`. O servidor MCP ganha a ferramenta
  "transferir".

### 4.7 Avisos

- As notificações passam a ser em português e dizem quem passou, de onde veio
  e a nota.
- Avisos novos:
  - "Ninguém online no Financeiro: 3 conversas na fila";
  - "Conversa com João passou do prazo (15 min) sem resposta".

## 5. Desenho técnico

### 5.1 Um caminho só para atribuir

Hoje cada lugar grava `assigned_agent_id` do seu jeito: o navegador, a IA, a
Harpi, a API, as automações e os fluxos. Por isso não existe histórico e o
gatilho de automação não dispara. A proposta:

- **No banco:** a função `transfer_conversation(...)` (SECURITY DEFINER) faz
  tudo numa transação só:
  - trava o setor;
  - escolhe a pessoa, quando é distribuição;
  - atualiza a conversa (`assigned_agent_id`, `team_id`, `assigned_at`);
  - grava o histórico;
  - cria **uma** notificação, em português e com a nota.
- **No servidor:** a função `transferirConversa()` (`src/lib/atendimento/`)
  chama a do banco e depois dispara a automação "Conversa atribuída" e o
  webhook. **Todos** os caminhos passam por ela:
  - a rota nova da caixa de entrada, `POST /api/conversations/{id}/transfer`;
  - a IA, os fluxos e as automações;
  - a Harpi e a API v1;
  - o agendador.
- **Rede de segurança:** um gatilho `AFTER UPDATE OF assigned_agent_id` grava
  no histórico qualquer mudança que não tenha passado pela função (origem
  `outro`). É o mesmo princípio da 058: quem guarda o fato é o banco, não cada
  tela.
- O gatilho de notificação da 027 é substituído, para não sair notificação em
  dobro.
- O navegador deixa de gravar `assigned_agent_id` direto.
- **Ninguém é notificado de uma atribuição feita a si mesmo.** Hoje a API
  precisa marcar essa notificação como lida na mão.

### 5.2 Banco de dados

**076 (Fase 1)**

- **`conversation_transfers`** (o histórico):
  - colunas: `id`, `account_id`, `conversation_id`, `from_user_id`,
    `to_user_id`, `actor_user_id` (nulo quando foi a IA ou o sistema),
    `source`, `note` (até 500 caracteres), `created_at`;
  - valores de `source`: `manual`, `ia`, `rodizio`, `fluxo`, `automacao`,
    `harpi`, `api`, `prazo`, `retorno`, `chegada` ou `outro`;
  - índices: `(conversation_id, created_at)` e
    `(account_id, to_user_id, created_at desc)`;
  - RLS: os membros do CRM leem; ninguém insere direto.
- **`conversations.assigned_at`**.
- **`account_members.receives_conversations`**: começa ligado; um leitor
  nunca recebe. Só muda por função: a própria pessoa muda a sua, e admin muda
  a de qualquer um.
- **Funções:**
  - `pick_next_attendant(account, team)`;
  - `transfer_conversation(...)`;
  - o gatilho do histórico;
  - a notificação da 027, reescrita em português.

**077 (Fases 2 e 3)**

- **`teams`** (os setores):
  - `id`, `account_id`, `name`, `color`, `active`, `position` e as datas;
  - `code`: curto e único no CRM. É o que a IA escreve;
  - `description`: o que o setor resolve;
  - `mode`: `rodizio`, `menos_ocupado` ou `fila`;
  - `online_only`, `max_open_per_person`;
  - `sla_minutes` e `sla_action` (`avisar` ou `proximo`);
  - `is_entry`: um por CRM, garantido por índice parcial único.
- **`team_members`:** `team_id`, `user_id`, `account_id`. Só entra quem está em
  `account_members`.
- **`conversations.team_id`**, e `from_team_id` e `to_team_id` no histórico.
- **Destino da IA:**
  - em `ai_configs`: `handoff_mode` e `handoff_team_id`;
  - em `agents`: `handoff_mode` e `handoff_team_id` (`agents.handoff_agent_id`
    já existe).
- **`claim_conversation(conv)`:** é o "Pegar". Só funciona se a conversa ainda
  estiver sem responsável.
- Tipo de notificação novo: setor sem ninguém disponível.

**078 (Fase 4)**

- **Regras do CRM**, numa linha por CRM:
  - chegada: fila geral, setor de entrada ou por canal;
  - retorno: mesma pessoa até N dias, IA ou distribuir; e o valor de N.
- **`conversations.sla_alerted_at`**, para não avisar duas vezes.
- Tipo de notificação novo: prazo estourado.

O código tem que funcionar com a migration ainda não aplicada, como já é o
padrão do projeto. Tabela ou coluna que falta vira "sem setores", com o
comportamento de hoje.

### 5.3 Como a pessoa é escolhida

- **Candidatos:**
  - membros do CRM (`account_members`) com papel dono, admin ou atendente, e
    com "Recebe conversas" ligado;
  - num setor, só quem é do setor;
  - com "só online", só quem está com a bolinha verde (mesma regra de
    presença da tela);
  - quem bateu o limite de conversas do setor sai da vez;
  - **nunca entra:** leitor, ou alguém da agência que só está dentro do CRM.
- **Ordem:**
  - **Rodízio:** primeiro quem recebeu há mais tempo, contado pelo histórico.
    Quem nunca recebeu vem na frente;
  - **Menos ocupado:** quem tem menos conversas abertas como responsável. O
    empate é decidido pelo rodízio.
- **Duas conversas ao mesmo tempo:** há uma trava `pg_advisory_xact_lock` por
  setor (ou pelo CRM, quando não há setor). A segunda espera a primeira e já
  vê no histórico quem acabou de receber.
- **Ninguém disponível:**
  - **num setor:** a conversa fica na fila do setor, sem responsável e em
    Aguardando. As pessoas do setor e a gestão são avisadas;
  - **no rodízio da equipe toda** (Fase 1, sem setor): procura primeiro quem
    está online. Se ninguém estiver, distribui entre todos que recebem, para
    a conversa nunca ficar sem dono (decisão 2).

### 5.4 A IA escolhendo o setor

- **No prompt** (`src/lib/ai/defaults.ts`, modo de resposta automática). Só
  entra quando o destino é "A IA escolhe" e há setores ativos:
  - a lista no formato `código: o que resolve`;
  - a instrução: ao passar, terminar com `[[HANDOFF codigo]]`. Se nenhum setor
    servir, ou houver dúvida, só `[[HANDOFF]]`. É o mesmo formato do
    `[[AGENDAR …]]` que já existe.
- **Leitura da resposta:** `parseGeneration` (`src/lib/ai/generate.ts`) passa
  a aceitar os dois formatos e **remove o marcador do texto**. Hoje ele só
  procura `[[HANDOFF]]`. Sem essa mudança, `[[HANDOFF financeiro]]` iria
  escrito para o cliente. Um código que não existe no CRM conta como "sem
  escolha".
- **Ordem do destino:**
  1. a escolha da IA;
  2. o destino fixo do agente;
  3. o destino da conta;
  4. o setor de entrada;
  5. a fila geral (como hoje).

  Quando a passagem é pelo limite de respostas (`reply_cap`), não há escolha
  da IA e a ordem começa no item 2.
- Continua valendo a regra de hoje: **nunca tirar a conversa de uma pessoa que
  já é responsável.** A passagem da IA também mantém a trava de hoje: ela só
  acontece uma vez, por causa do `ai_autoreply_disabled = false` no WHERE.
- **Segurança:** a IA só escolhe entre os setores deste CRM. O pior que um
  cliente consegue, tentando manipular, é cair em outro setor. O prompt já
  manda ignorar pedidos para escrever frases de controle.
- **Custo:** nenhuma chamada a mais, porque a escolha sai na mesma resposta.

### 5.5 Quando distribuir, e quando não

Hoje **qualquer responsável cala a IA** (`human_assigned` em
`auto-reply.ts`). Por isso:

- **Distribui:**
  - quando a IA passa a conversa;
  - quando um fluxo passa;
  - quando uma automação manda;
  - quando alguém transfere para um setor;
  - quando o agendador varre uma fila.
- **Na chegada (Fase 4), só se ninguém mais assumir.** Isso vale quando
  nenhuma IA vai responder naquele canal e nenhum fluxo ou automação pegou a
  conversa.
  - A decisão fica logo depois da decisão da IA, onde as três entradas já
    chamam a IA: `src/app/api/whatsapp/webhook/route.ts`,
    `src/app/api/instagram/webhook/route.ts` e
    `src/lib/channels/inbound-dispatch.ts`.
  - Para isso, `dispatchInboundToAiReply` deixa de devolver `void` e passa a
    dizer o que aconteceu: respondeu, passou, ou ninguém assumiu.
- O caso 8 do §3 (sem palavra-chave e sem agente padrão) entra aqui: a
  conversa vai para a distribuição em vez de ficar parada.

### 5.6 Paciente que volta

Quando uma conversa encerrada reabre por mensagem do cliente, antes de chamar
a IA:

- **O paciente falou com uma pessoa nos últimos N dias (padrão 7) e ela está
  disponível:** a conversa fica com ela. A pessoa é avisada ("João voltou a
  falar") e a conversa vai para Aguardando.
- **A pessoa está indisponível:** distribui no setor da conversa ou pela regra
  de chegada.
- **Passou de N dias:** recomeça do zero. Saem o responsável e o setor, e a IA
  volta a responder, como no "Retomar IA". Depois segue o caminho normal.

### 5.7 Prazo e varredura da fila

Tudo roda no tick do agendador que já existe (`/api/automations/cron`):

- **Prazo:** pega conversas com responsável, em Aguardando há mais tempo que o
  prazo do setor e ainda sem aviso. Conforme o setor, avisa a gestão ou passa
  para o próximo (origem `prazo`).
- **Varredura:** se uma fila de setor tem conversas e alguém do setor ficou
  online, distribui.
- **Precisão:** é o intervalo do agendador, de 5 a 10 minutos. A tela avisa:
  "o prazo é conferido a cada poucos minutos".

## 6. Fases

### Fase 1. Arrumar o básico (sem setor nenhum) · tamanho M · migration 076

- Rodízio de verdade na automação "Atribuir conversa": a equipe toda, online
  primeiro, respeitando "Recebe conversas".
- A chave **Recebe conversas** em cada pessoa, e "Pausar recebimento" no menu
  do avatar.
- **Transferir** com nota, com o histórico dentro da conversa e a notificação
  em português com a nota.
- Filtros **Minhas** e **Sem responsável**, com contador, e as iniciais do
  responsável na linha.
- O campo **"Passar para"** em cada agente de IA (uma pessoa, ou o padrão da
  conta), no formulário e na API (`payload.ts`), validando que a pessoa é da
  equipe.
- As listas de pessoas passam a usar a equipe oficial do CRM
  (`/api/account/members`), em vez de ler `profiles` direto.
- O gatilho "Conversa atribuída" passa a disparar, com proteção contra laço:
  uma automação que atribui não pode disparar a si mesma de novo.
- IA, Harpi, API e automações passam pelo caminho único do §5.1.
- **Conserto rápido:** a API oficial do WhatsApp passa a reabrir a conversa
  encerrada quando o cliente escreve, como os outros canais já fazem (caso 9
  do §3). Mensagem enviada pela própria empresa não reabre.
- **Pronto quando:**
  - com 3 pessoas online, 9 conversas pela automação de rodízio dão 3 para
    cada, na ordem;
  - na API oficial, uma mensagem do cliente numa conversa fechada a reabre;
  - duas conversas no mesmo segundo não furam a vez (teste de banco em
    `supabase/tests/`);
  - a nota da transferência aparece na conversa e na notificação de quem
    recebeu;
  - "Minhas" mostra só as minhas;
  - com um agente configurado para passar à Maria, a passagem cai na Maria;
  - uma automação com o gatilho "Conversa atribuída" roda;
  - `npm test`, `npm run typecheck` e `npm run lint` passam.

### Fase 2. Setores · tamanho G · migration 077

- As tabelas, a tela de setores (§4.4) e a distribuição por setor: rodízio,
  menos ocupado ou fila; só online; limite por pessoa; setor de entrada.
- Transferir para um setor, **Pegar** da fila, os filtros "Fila dos meus
  setores" e "Setor", e a etiqueta do setor na linha da conversa.
- O aviso de setor sem ninguém disponível.
- **Pronto quando:**
  - num setor em Fila, duas pessoas clicam em Pegar ao mesmo tempo e só uma
    fica com a conversa;
  - "menos ocupado" respeita o limite;
  - desligar "Recebe conversas" tira a pessoa da vez na hora;
  - um CRM sem setores continua igual a hoje.

### Fase 3. A IA escolhe o setor · tamanho M · sem migration nova (as colunas vêm na 077)

- O prompt, a leitura do `[[HANDOFF codigo]]` e a ordem de destino (§5.4),
  com o campo na conta e em cada agente. O teste da IA mostra o setor
  escolhido.
- **Fluxo:** "Passar para humano" com setor ou pessoa, a nota na conversa e
  Aguardando.
- **Automação:** "Atribuir conversa → Setor", com a validação, o construtor e
  a Harpi atualizados.
- **Harpi:** `atribuir_conversa` ganha setor e nota, e entra a ferramenta
  `listar_setores`.
- **API v1:** entram `transfer` e o webhook `conversation.assigned`,
  documentados em `docs/public-api.md`, e a ferramenta no `mcp-server/`.
- **Pronto quando:**
  - uma bateria de 20 mensagens típicas de clínica cai no setor certo em pelo
    menos 18 (agendar, remarcar, preço, parcelamento, boleto, reclamação,
    "quero falar com a Dra. Ana", dúvida depois do procedimento…);
  - as mensagens em que a IA fica em dúvida vão para o setor de entrada;
  - uma mensagem tentando forçar `[[HANDOFF x]]` não quebra nada;
  - o custo por conversa não muda.

### Fase 4. Chegada, retorno e prazo · tamanho M · migration 078

- **Distribuição na chegada,** para canal sem IA: fila geral, setor de entrada
  ou por canal (WhatsApp e Instagram).
- **Paciente que volta** (§5.6).
- **Prazo por setor** e a varredura das filas no agendador (§5.7).
- A mensagem que nenhum agente de IA pega vai para a distribuição (caso 8 do
  §3).
- **Pronto quando:**
  - num CRM sem IA, uma mensagem nova cai na pessoa da vez;
  - num CRM com IA, a IA continua respondendo (a regra de chegada não a cala);
  - o paciente que volta em 3 dias cai na mesma pessoa, e o que volta em 30
    dias recomeça do zero;
  - um prazo estourado avisa uma vez só.

### Fase 5. Números e modelos · tamanho M

- **Relatórios › Atendimento:**
  - por pessoa: conversas recebidas, conversas passadas adiante, tempo até a
    1ª resposta e conversas abertas agora;
  - por setor: entradas, tempo na fila e prazos estourados;
  - o analista com IA passa a ler esses números.
- **Painel da agência e Agency OS:** "sem atendente" e "prazo estourado" por
  setor.
- **Modelo de nicho "Clínica":** traz setores sugeridos (Recepção,
  Agendamento, Financeiro, Orçamentos), sem pessoas.
- **Ajuda do sistema e Harpi:** passam a explicar setores e transferências.

### Fase 6 (decisão separada). Cada atendente vê só o que é dele · tamanho G

- É uma opção por CRM: o atendente vê só as conversas dele e as dos setores
  dele. Admin e dono continuam vendo tudo.
- Mexe na segurança do banco (RLS) de conversas e mensagens, e também nos
  relatórios, na Harpi, na API e na extensão.
- Ajuda as clínicas com a LGPD, porque elas lidam com dado de saúde.
  Recomendo fazer só quando um cliente pedir, com um plano próprio.

### Depois (fora deste plano)

- A IA escolher, pelo assunto, qual agente de IA continua a conversa. Hoje é
  por palavra-chave.
- Avisar o atendente no WhatsApp dele quando ele recebe uma conversa.
- Ligar o setor "Dra. Ana" à agenda dela, para a IA marcar direto com a
  profissional certa.

## 7. Ordem de entrega e publicação

1. **Fase 1:** um PR com a 076. Já resolve o rodízio, a transferência com nota
   e os filtros.
2. **Fases 2 e 3 juntas:** um PR com a 077. Para uma clínica, setor sem a IA
   escolhendo vale pouco.
3. **Fase 4:** um PR com a 078.
4. **Fase 5:** um PR.

Em cada entrega:

- a migration é aplicada à mão no SQL editor do Supabase, como sempre;
- o merge só acontece depois do seu "pode";
- é preciso conferir que o Netlify publicou.

Juntar as fases em poucas publicações também economiza créditos do Netlify.

## 8. Decisões que precisam ser suas

1. **Nome:** "Setores", "Equipes" ou "Departamentos"?
   *Recomendo **Setores**: é a palavra usada na clínica, e os textos dos
   agentes de IA já falam em "setor".*
2. **Rodízio da equipe toda (Fase 1) quando ninguém está online:** distribuir
   mesmo assim ou deixar na fila geral?
   *Recomendo distribuir entre todos que recebem, para nada ficar sem dono. Nos
   setores, a opção "só online" fica a critério de cada um.*
3. **"Recebe conversas" começa ligado para todos?**
   *Recomendo que sim. Na implantação, a agência desliga quem não atende (dono,
   dentistas). Se começasse desligado, um CRM poderia ficar sem ninguém
   recebendo.*
4. **Modo padrão de um setor novo:** Rodízio ou Menos ocupado?
   *Recomendo **Rodízio**: é o mais fácil de entender e de conferir.*
5. **Paciente que volta:** fica com a mesma pessoa até quantos dias?
   *Recomendo **7**, ajustável por CRM.*
6. **Prazo estourado, o que fazer por padrão:** avisar a gestão ou passar para
   o próximo?
   *Recomendo **avisar** no começo, porque passar sozinho pode confundir a
   equipe. Cada setor pode mudar.*
7. **Quem transfere para quem:** qualquer atendente pode transferir para
   qualquer pessoa ou setor?
   *Recomendo que sim, e que só admin crie e edite setores.*
8. **Fase 6 (visibilidade restrita):** fazer agora ou só quando pedirem?
   *Recomendo só quando pedirem.*

## 9. Riscos e cuidados

- **Atribuir cala a IA.** Distribuir na chegada num canal com IA desligaria a
  IA. A regra do §5.5 existe para evitar isso, e tem teste próprio.
- **Corrida:**
  - duas mensagens chegando juntas: resolvido pela trava por setor;
  - dois cliques em "Pegar": resolvido pelo
    `UPDATE … WHERE assigned_agent_id IS NULL`.

  Os dois casos têm teste no banco de verdade (`supabase/tests/`).
- **Laço de automação:** "Conversa atribuída" → "Atribuir conversa" → … O
  motor tem que cortar a repetição.
- **Marcador vazando para o cliente:** se a leitura do `[[HANDOFF codigo]]`
  não for atualizada junto com o prompt, o marcador vai escrito para o
  paciente. Os dois mudam no mesmo commit, e há um teste para isso.
- **Notificação em dobro:** a da 027 é substituída, não somada.
- **Agência em modo suporte** nunca entra na vez. Por isso os candidatos saem
  de `account_members`, e não de `profiles.account_id`.
- **Nunca tirar a conversa de quem já é responsável,** a não ser numa
  transferência explícita.
- **Migration à mão:** 076, 077 e 078, nesta ordem. O código funciona antes e
  depois de cada uma.
- **Numeração:** a 073 está no PR #46 (extrator de leads) e a próxima livre é
  a 076. Conferir de novo antes de criar.
- **CRM sem setores** tem que continuar idêntico ao de hoje, com um teste de
  regressão para isso.

## 10. Para quem for executar

- Trabalhar num worktree novo a partir do `main` (ramo
  `feat/distribuicao-atendimento`). A pasta principal está num ramo antigo.
- **Arquivos centrais:**
  - IA: `src/lib/ai/auto-reply.ts`, `defaults.ts`, `generate.ts` e
    `handoff.ts`;
  - automações: `src/lib/automations/engine.ts`, `validate.ts` e
    `templates.ts`;
  - fluxos: `src/lib/flows/engine.ts` e
    `src/components/flows/forms/node-config-form.tsx`;
  - caixa de entrada: `src/components/inbox/message-thread.tsx`,
    `conversation-list.tsx` e `src/app/(dashboard)/inbox/page.tsx`;
  - agentes: `src/components/agents/agent-form.tsx` e
    `src/lib/agents/payload.ts`;
  - configurações: `src/components/settings/ai-config.tsx` e
    `members-tab.tsx`;
  - Harpi: `src/lib/assistente/tools/crm.ts`, `automacoes.ts`, `leitura.ts` e
    `prompt.ts`;
  - API: `src/lib/api/v1/`, `src/lib/webhooks/events.ts` e `mcp-server/`;
  - agendador: `src/app/api/automations/cron/route.ts`.
- **Testes:**
  - `vitest` para as partes puras: escolha da pessoa, leitura do
    `[[HANDOFF …]]` e ordem de destino;
  - `supabase/tests/distribuicao.test.ts` para as funções do banco, a
    concorrência e a RLS, no molde de `aguardando-atendente.test.ts`.
- **Prévia de um worktree:** criar uma configuração temporária em
  `.claude/launch.json` com `npm --prefix <worktree>` e removê-la depois.
- Para testar o rodízio, é preciso ter 3 usuários num CRM de teste.

## 11. Tamanho

| Fase | Tamanho | Migration |
|---|---|---|
| 1. Arrumar o básico | M | 076 |
| 2. Setores | G | 077 |
| 3. A IA escolhe o setor | M | (usa a 077) |
| 4. Chegada, retorno e prazo | M | 078 |
| 5. Números e modelos | M | talvez uma pequena, para o modelo de nicho |
| 6. Visibilidade restrita | G | decisão separada |

## 12. Para pôr no ar

1. Aplicar no SQL editor do Supabase, **nesta ordem**, uma de cada vez:
   `076_distribuicao_atendimento.sql`, `077_setores.sql`,
   `078_chegada_retorno_prazo.sql`.
2. Conferir: tabelas `conversation_transfers`, `teams`, `team_members` e
   `inbox_settings` com RLS; as funções `transfer_conversation`,
   `pick_next_attendant`, `claim_reopened` e `atendimento_tick`; e
   `notifications_type_check` com `team_queue`, `conversation_overdue` e
   `conversation_returned`.
3. Fazer o merge e conferir que o Netlify publicou.
4. Num CRM de teste, criar dois setores, colocar pessoas e transferir uma
   conversa para cada um.

Sem as migrations, o código novo não quebra o que já existe:
- a transferência cai na gravação antiga;
- os setores ficam vazios;
- as regras de chegada e de retorno não rodam.

## 13. Testes

- **Banco** (`supabase/tests/distribuicao.test.ts`): 30 testes. Cobrem o
  rodízio justo, "Recebe conversas", o histórico, a notificação em
  português, o "Pegar" disputado, os setores (rodízio, só online, fila,
  menos ocupado, limite, aviso de fila, RLS), a reabertura, o prazo, a
  varredura das filas e as regras do CRM.
- **Unidade**: destino da IA, leitura do `[[HANDOFF setor]]`, regras de
  chegada e retorno, texto do histórico, relatório de atendimento e a IA
  passando para o setor escolhido.
- **Suíte inteira**: 2.654 testes passando, `tsc` e `eslint` limpos.

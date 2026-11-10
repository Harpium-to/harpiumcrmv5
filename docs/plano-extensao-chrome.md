# Plano: melhorar a extensão do Chrome

A extensão (`extension/`, hoje "CRM Connector" v0.3.0) mostra o contato
do CRM ao lado da conversa no WhatsApp Web, cria o lead, marca a
temperatura e move o negócio no funil.

Frentes escolhidas no início: **corrigir o que falha**, **mais ações no
painel** e **visual e marca Harpium**. Conexão em um clique e Chrome Web
Store ficam para depois.

**Nova direção (09/11/2026):** a extensão passa a ter como referência o
WaSeller (https://waseller.com.br): as mesmas funções, só que ligadas
ao CRM. O cliente escolhe onde atender — na caixa de entrada do CRM ou
no WhatsApp Web com a extensão — e os dois lados mostram os mesmos
dados. Veja "Nova direção" abaixo; as fases 2 em diante foram refeitas.

A regra de segurança atual continua valendo em todas as fases: a chave
só existe no service worker (`background.js`), o painel nunca lê texto
de mensagem e, na dúvida sobre quem é o contato, o painel não chuta.

---

## Diagnóstico

### O que falha hoje

1. **Contato existe, mas o painel diz "Sem cadastro".** A busca manda
   os dígitos do WhatsApp (`5531999998888`) para `?search=`, que faz
   `ilike` no campo `phone` como foi digitado. Falha em dois casos
   comuns:
   - telefone salvo com formatação (`+55 (31) 99999-8888`): os dígitos
     juntos não aparecem dentro do texto formatado;
   - **nono dígito**: o WhatsApp identifica muitos celulares do Brasil
     sem o 9 (`553199998888`, 12 dígitos), e o CRM tem com o 9
     (13 dígitos), ou o contrário.

   Consequência, conforme o caso (conferido na Fase 1):
   - nono dígito, número salvo só com dígitos: "Criar no CRM" devolvia
     o contato que já existia, mas o painel continuava em "Sem
     cadastro" — parecia não fazer nada;
   - mesmo número salvo com formatação: "Criar no CRM" dava erro (o
     "acha ou cria" do CRM também procurava pelo texto digitado e o
     banco recusava o repetido);
   - formatação **e** nono dígito: aí sim nascia um **contato
     duplicado**, sem os negócios e etiquetas do original.

2. **Conversas que o painel não reconhece.** O WhatsApp está trocando o
   identificador das conversas pelo `@lid`, um código que **não é o
   telefone**. A extensão corretamente não trata isso como número, mas
   aí cai em "Abra uma conversa individual" com a conversa individual
   aberta. Isso tende a crescer conforme o WhatsApp avança a mudança.

3. **Painel tapa a conversa.** É uma janela flutuante de 268px fixa no
   canto superior direito, por cima do cabeçalho e das mensagens. O
   "recolher" não é lembrado: ao recarregar a página, abre de novo.

### O que falta

- Anotações do contato (a tabela `contact_notes` existe, a API não
  expõe).
- Editar nome, e-mail, empresa e etiquetas (a API já aceita, o painel
  não oferece).
- Criar negócio (a API não tem `POST /deals`).
- Saber o estado da conversa no CRM: IA respondendo, aguardando
  atendente (migration 058), e **assumir** dali.

### Visual

Nome genérico "CRM Connector", ícone genérico, cores do WhatsApp. Não
parece produto da Harpium.

---

## Fase 1 — Corrigir o que falha ✅ (em produção desde 09/11/2026; conferida no WhatsApp real em 10/11)

Só extensão + um ajuste na API pública. **Sem migration.** Extensão
0.4.0, PR #14 (`feat/extensao-fase1-correcoes`).

Feito além do previsto:
- O "acha ou cria" compartilhado (`findExistingContact`, usado também
  pelo webhook, pelo formulário e pela importação) procura pelos
  dígitos (`phone_normalized`) e, entre vários candidatos com os
  mesmos últimos 8 dígitos, prefere o mesmo número, depois a outra
  forma do nono dígito, e só então o mais solto. Antes pegava o
  primeiro que viesse — podia ser alguém de outro DDD.
- O service worker fecha o `chrome.storage.local` para content scripts
  (`setAccessLevel`). O README dizia que eles não alcançavam a chave,
  mas por padrão alcançam.
- Na busca manual, um número digitado sem DDI cai para "contém esses
  dígitos" quando a busca exata não acha nada.

Fica para depois (não é da extensão): a regra geral do CRM para "mesmo
número" (`phonesMatch`) aceita quem só tem os mesmos últimos 8 dígitos.
Com a preferência acima ela só decide quando não há nada melhor, mas
ainda pode juntar duas pessoas de DDDs diferentes.

1. **Busca por telefone de verdade.** Novo filtro `?phone=` em
   `GET /api/v1/contacts` que compara pelo `phone_normalized` (só
   dígitos, coluna da migration 022) e aceita as duas formas do
   celular brasileiro: com e sem o nono dígito (só para `+55`, DDD
   válido e número de celular). A extensão passa a usar esse filtro.
   - Se encontrar **mais de um** contato (o com 9 e o sem 9), o painel
     mostra os dois e pede para escolher, em vez de pegar o primeiro.
2. **Criar sem duplicar.** Antes de criar, a mesma busca com as
   variantes. O `POST /api/v1/contacts` (que já é "acha ou cria")
   também passa a considerar as variantes, o que protege qualquer
   outro cliente da API.
3. **Conversas com `@lid`.** Duas saídas, nesta ordem:
   - se o cabeçalho da conversa mostra o próprio número (contato que
     não está na agenda do celular), usar esse número;
   - senão, o painel diz "O WhatsApp não mostra o número desta
     conversa" e oferece **buscar no CRM por nome ou telefone**. O
     atendente escolhe o contato e a extensão **lembra o vínculo**
     daquela conversa (só neste navegador), para não perguntar de
     novo.
4. **Recolher lembrado** entre recarregamentos.
5. Testes de unidade para as variantes de telefone e a leitura do
   `@lid` (mesmo padrão de `chat-id.test.js`), e teste da API para o
   filtro `?phone=`.

**Como testar:** você carrega a extensão no seu Chrome e abre três
conversas: um contato salvo com formatação, um celular de DDD fora de
SP/RJ e uma conversa que hoje aparece como "abra uma conversa
individual". Eu não consigo entrar no seu WhatsApp Web daqui.

## Nova direção — as funções do WaSeller, integradas ao CRM

### O que o WaSeller oferece

Lista tirada do site deles em 09/11/2026:

- CRM no estilo Kanban dentro do WhatsApp Web
- Áudio, imagem, vídeo e texto pronto ("script") com 1 clique
- Funil de mensagens com 1 clique (uma sequência de mensagens)
- Agendamento de mensagens
- Autorresponder (respostas automáticas)
- Fluxo de chatbot
- Postagem de status agendada
- Disparos em massa (eles avisam: "sujeito às políticas de uso do
  WhatsApp")
- Assinatura do atendente nas mensagens
- Notas, tarefas e lembretes
- Tags e etiquetas
- Follow-up automático
- Google Agenda integrado
- Exportação de contatos
- Webhook

Só vi o site, não a extensão por dentro. Onde o comportamento exato
importar (por exemplo, como é o funil de mensagens), confirmo com você
na fase correspondente.

### A decisão que define o resto: por onde as mensagens saem

Hoje a extensão não envia nada. Quase tudo na lista acima envia. Há
dois caminhos:

**A. Pelo número conectado ao CRM (recomendado).** A extensão é a tela
dentro do WhatsApp Web; quem envia é o CRM, pelo canal que o cliente já
conectou (WhatsApp por QR/UAZAPI ou API oficial). A mensagem aparece no
WhatsApp Web porque é a mesma conta.
- Agendamento, follow-up e chatbot funcionam com o computador
  desligado, porque rodam no servidor.
- Tudo fica registrado no CRM e usa os mesmos motores que já existem
  (automações, fluxos, disparos, IA).
- Não depende das partes internas da página do WhatsApp, que mudam sem
  aviso.
- Exige que o número aberto no WhatsApp Web seja o mesmo conectado em
  Canais.

**B. De dentro da página do WhatsApp Web.** É como as extensões desse
tipo costumam funcionar: o código entra na página e aciona o envio por
ali.
- Funciona sem conectar o número ao CRM.
- Só funciona com a aba aberta; agendamento e chatbot param quando o
  navegador fecha.
- Quebra quando o WhatsApp muda a página, e é o tipo de automação que
  mais pesa em bloqueio de número.
- O que foi enviado não chega ao CRM sozinho.

**Meio-termo possível:** A para tudo, e, para quem não conectou o
número, a extensão só **cola o texto** no campo de mensagem para a
pessoa apertar enviar.

### Função por função

| Função | O CRM já tem | Falta |
| --- | --- | --- |
| Kanban | Funis, etapas e negócios; API para ler e mover negócio | Quadro dentro do WhatsApp Web; criar negócio pela API |
| Mídia e texto com 1 clique | Respostas rápidas (texto e botões); envio de mídia pela API | Respostas rápidas com áudio, imagem, vídeo e arquivo; lista na extensão |
| Funil de mensagens | Fluxos (chatbot) | Sequência disparada à mão numa conversa |
| Agendar mensagem | Só disparo agendado e "esperar" nas automações | Mensagem agendada por conversa (tabela nova + rotina no servidor) |
| Autorresponder | Automações: primeira mensagem, palavra-chave, mensagem nova | Atalho na extensão; no WhatsApp por QR depende do branch `claude/mystifying-sanderson-f8da81` (outra conversa, ainda fora do `main`) |
| Chatbot | Fluxos e agente de IA | Idem |
| Follow-up automático | Automações com "esperar" | Gatilho "cliente não respondeu em X" |
| Status agendado | Nada | Depende de o provedor (UAZAPI) aceitar postar status: a confirmar |
| Disparo em massa | Disparos com modelo aprovado (API oficial) | No número por QR: decidir se entra, e com quais limites |
| Assinatura do atendente | Nada | Nome de quem atende na mensagem |
| Notas | Notas do contato (só nas telas do CRM) | API pública de notas |
| Tarefas e lembretes | Só tarefas dos agentes de IA | Tarefas e lembretes de pessoas (tabela nova, aviso na hora) |
| Etiquetas | Etiquetas; a API já troca as do contato | Listar etiquetas pela API |
| Google Agenda | Nada | Integração nova (login Google) |
| Exportar contatos | Não encontrei na tela de contatos: a confirmar | Exportar CSV |
| Webhook | Webhooks em Configurações | Nada |

Quase toda função nova precisa de três coisas: rota nova na API
pública, escopo novo na chave da extensão (migration que atualiza as
chaves existentes) e a tela na extensão.

### Fases propostas

Cada fase em um branch próprio, aprovada antes de começar.

**Fase 2 — Base visual ✅ (em produção desde 10/11/2026, extensão
0.5.0, PR #15).**
- Nome "Harpium CRM" e ícones da águia (fonte em `docs/marca/`).
- Painel encaixado numa coluna à direita, que estreita o WhatsApp.
  Recolhido, vira uma aba na borda e o WhatsApp volta à largura
  inteira. A extensão confere se o WhatsApp estreitou mesmo; se não, ou
  em janela com menos de 1180px, o painel flutua no canto como antes.
- Visual do CRM (tons quentes, creme sobre café), claro ou escuro
  conforme o que o WhatsApp está mostrando (`extension/theme.js`).
- Nome do CRM conectado no cabeçalho.
- Ficha em blocos (Contato, Negócios), prontos para receber os da
  Fase 3.
- Página de opções com o mesmo visual, e com a instrução certa de onde
  gerar a chave (dizia Configurações › API).
- Estilos isolados da página do WhatsApp (`all: revert` dentro do
  painel), para ele ficar igual lá e na página de teste.

Ficou para as fases que vão usar: as abas internas (Fase 3), os botões
junto ao campo de mensagem (Fase 4) e a tela cheia do quadro (Fase 6).

**Teste no WhatsApp real (09/11/2026).** A coluna, o tema e o nome do
CRM funcionaram. O painel, porém, não reconhecia nenhuma conversa, e a
causa não era da Fase 2:

- O WhatsApp Web **tirou o identificador da conversa da página**. O
  `data-id` das mensagens, que a extensão lia desde a primeira versão,
  hoje traz só o código da mensagem. Nenhum atributo da página diz mais
  com quem é a conversa. Conferido no WhatsApp real: 0 de 25
  mensagens com identificador; de 698 conversas, 609 usam `@lid` (todas
  com o número conhecido pelo WhatsApp), 2 usam o telefone e 87 são
  grupos.
- **Consequência: a 0.4.0 que está em produção não reconhece conversa
  nenhuma** no WhatsApp de hoje. Mostra "Abra uma conversa individual"
  com uma aberta.
- **Correção (nesta 0.5.0):** `extension/page-bridge.js` roda no
  ambiente do código do WhatsApp e responde qual conversa está aberta:
  o identificador e, para `@lid`, o número que o WhatsApp tem. O painel
  valida a resposta e mantém a leitura antiga como reserva. Com isso o
  número passa a vir até nas conversas `@lid`, que antes exigiam
  vínculo à mão.
- O painel agora separa três situações que antes tinham a mesma
  mensagem: nenhuma conversa aberta, grupo ou canal, e "não consegui
  identificar esta conversa" (o aviso de que o WhatsApp mudou de novo).
- O vínculo automático ficou só para o caso em que o número veio do
  cabeçalho. Achar pelo número que o WhatsApp informa não cria vínculo.

Isso muda uma premissa do plano: a extensão **passa a ter um pedaço
rodando dentro da página do WhatsApp**. Ele só lê qual conversa está
aberta; o envio continua pelo CRM (decisão de 09/11).

**Ainda a confirmar no WhatsApp real:** que a 0.5.0 corrigida reconhece
as conversas, e que fotos e vídeos em tela cheia não ficam com botões
embaixo do painel.

**Fase 3 — Ficha completa do contato.** O que não envia mensagem.
Dividida em duas, porque só a segunda precisa de migration.

*3A ✅ (em produção desde 10/11/2026, extensão 0.6.0, PR #16; falta
testar no WhatsApp real).* **Sem migration.**
- Ficha em abas: **Negócios**, **Notas** e **Dados**. A aba aberta
  continua aberta na próxima conversa.
- Negócios: criar (título, valor, funil, etapa), mover de etapa, fechar
  como ganho ou perdido, com "Desfazer".
- Notas: ver as anotações da equipe e escrever outra. O autor é a
  pessoa dona da chave da extensão.
- Dados: editar nome, e-mail, empresa e etiquetas, com as etiquetas do
  CRM como sugestão.
- API pública nova: `GET/POST /api/v1/contacts/{id}/notes`,
  `GET /api/v1/tags` e `POST /api/v1/deals`.
- **Mudança de alcance dos escopos, sem migration:** `contacts:read`
  passa a ler anotações e etiquetas, `contacts:write` a escrever
  anotações, e `deals:write` a criar negócio. Vale para qualquer chave
  que já tenha esses escopos, não só as da extensão.
- Os funis ficam guardados por 1 minuto na extensão, para não pedir de
  novo a cada troca de conversa.

*3B ✅ (em produção desde 10/11/2026, extensão 0.9.0, PR #19; migration
060 aplicada em 10/11/2026; conferida no WhatsApp real em 10/11, menos
a faixa "Assumir").*
- **Tarefas**: aba na ficha do painel, "Minhas tarefas" no rodapé com o
  contador das atrasadas e das de hoje, e a aba Tarefas na tela do
  contato no CRM. Tabela `contact_tasks`; a equipe vê, atendente ou
  acima escreve.
- **Lembretes**: no painel, o contador (atualiza a cada 5 min com o
  WhatsApp Web aberto); no CRM, uma notificação no sino na hora
  marcada. A notificação sai do agendador das automações
  (`/api/automations/cron`), para não exigir outro job.
- **Conversa no CRM**: faixa no alto da ficha (IA respondendo, cliente
  esperando, com quem está) e **Assumir**. Feito sem depender do PR
  #10: usa as colunas que já existem; quando a 058 entrar, o "esperando
  há X" passa a aparecer sozinho.
- API: tarefas (`/contacts/{id}/tasks`, `/tasks`, `/tasks/{id}`), estado
  da conversa (`/contacts/{id}/conversation`) e assumir
  (`/conversations/{id}/takeover`). Escopos novos `tasks:read`,
  `tasks:write` e `conversations:write`.
- De quebra: `/contacts?contact=<id>` passa a abrir o contato. O
  "Abrir no CRM" do painel e o aviso de tarefa chegam por aí; antes, o
  link só abria a lista.

Fora desta etapa: atribuir tarefa a outra pessoa pela tela (toda tarefa
nasce para quem criou), tarefas repetidas e devolver a conversa para a
IA pelo painel.

**Fase 4 — Mensagens com 1 clique.** Dividida em duas.

*4A ✅ (em produção desde 10/11/2026, extensão 0.7.0, PR #17; migration
059 aplicada em 10/11/2026; conferida no WhatsApp real em 10/11).*
- Respostas rápidas de texto do CRM dentro do WhatsApp Web, com busca.
  Um clique **coloca o texto no campo de mensagem**; a pessoa envia.
- Variáveis `{{nome}}`, `{{primeiro_nome}}` e `{{empresa}}`, preenchidas
  com o contato. Valem também no inbox do CRM, pela mesma regra.
- API nova: `GET /api/v1/quick-replies`, com escopo próprio
  (`quick_replies:read`). A migration 059 dá esse escopo às chaves da
  extensão, inclusive às que já existem.
- Se o campo de mensagem recusar o texto, a extensão copia e pede para
  colar.

**O envio pelo CRM ficou fora da 4A, de propósito.** Para texto, colocar
no campo é melhor: a pessoa lê e ajusta antes de enviar, funciona com o
número conectado ou não, e não há envio automático. E enviar pelo CRM
exige duas coisas que ainda não existem:
- saber, de forma confiável, se o número aberto no WhatsApp Web é o
  mesmo conectado ao CRM — sem isso a mensagem pode sair de outro
  número;
- a API pública enviar pelo WhatsApp por QR. Hoje `POST /api/v1/messages`
  só usa a API oficial, e o canal por QR (UAZAPI) só envia texto.

*4B (em andamento).* O que precisa mesmo sair pelo CRM. Etapas 1 e 2
em produção desde 10/11/2026 (extensão 0.10.0, PR #21, migration 062
aplicada); etapa 3 em produção desde 10/11 (extensão 0.11.0, PR #22,
migration 063 aplicada); etapa 4 em produção desde 10/11 (extensão
0.12.0, PR #23, sem migration); etapa 5 feita em 10/11 (extensão
0.13.0, sem migration).

**Dependia do PR #12** (WhatsApp D1, "dois caminhos", de outra
conversa), que **entrou em produção em 10/11/2026**, com a migration
061 aplicada. Ele entrega, no servidor, as duas coisas que faltavam para
a 4B:
- um único lugar que decide por onde a mensagem sai
  (`resolveWhatsAppProvider`), usado pelo inbox, pela API pública, pelos
  fluxos, pelas automações e pela IA. Com isso a API pública passa a
  enviar também pelo WhatsApp por QR;
- mídia no WhatsApp por QR (imagem, vídeo, arquivo e áudio como
  mensagem de voz).

Há ainda o branch `claude/mystifying-sanderson-f8da81`, só local, que
refaz parte do mesmo envio de outro jeito e não inclui o D1: precisa
ser reconciliado com o `main` por quem cuida dele.

Etapas, na ordem:

1. ✅ **Saber de que número a mensagem sai.** A extensão lê o número
   logado no WhatsApp Web; o CRM informa o número conectado e o caminho
   escolhido (`GET /api/v1/whatsapp/sender`, escopo `messages:send`,
   lido da Meta ou da instância do QR code a cada consulta, nunca de
   cache). "Enviar pelo CRM" só aparece quando os dois são o mesmo
   número. Sem isso, a mensagem pode sair de outro número. Uma rota
   própria em vez do `/me`: só a chave que pode enviar precisa saber. *Conferido no WhatsApp Web real em 10/11/2026:*
   `require("WAWebUserPrefsMeUser").getMaybeMePnUser()` devolve o número
   logado (servidor `c.us`; veio com 12 dígitos, sem o nono, então a
   comparação usa a mesma equivalência do nono dígito). Cabe no
   `page-bridge.js`, ao lado da leitura da conversa aberta.
2. ✅ **Enviar texto pelo CRM.** Botão "Enviar" nas respostas rápidas, ao
   lado do "colocar no campo", com confirmação (Enviar → Confirmar em
   até 5 segundos). Só aparece quando o número logado é o do CRM e a
   conversa é, pelo número, o contato que o painel mostra. Resposta com
   variável sem dado não é enviada. A chave da extensão ganha
   `messages:send` (migration 062). Regra em `extension/send-check.js`,
   testada. *Falta testar com um número real*, combinado com você.
3. ✅ **Mídia nas respostas rápidas.** Imagem, vídeo, documento e
   áudio: o arquivo é enviado em Configurações › Respostas rápidas ›
   Mídia (com prévia e legenda), fica no bucket `chat-media` na pasta da
   conta, e o CRM só aceita um arquivo dessa pasta
   (`src/lib/quick-replies/media.ts`). No inbox, a resposta entra como
   anexo pronto para enviar. Na extensão, mostra tipo e nome e **só sai
   pelo CRM** (Enviar → Confirmar), porque arquivo não se cola no campo
   do WhatsApp. A API lista essas respostas com `?include=media`.
   Migration 063. O arquivo continua guardado quando a resposta muda ou
   é apagada: as mensagens já enviadas apontam para ele.
4. ✅ **Assinatura do atendente.** "Assinar como [nome]" na lista de
   respostas: a mensagem começa com `*Nome:*` (negrito no WhatsApp).
   O nome vem do CRM (`GET /api/v1/me` passa a trazer `person` nas
   chaves pessoais) e pode ser trocado. A escolha é de cada pessoa e
   fica na extensão. Vale para o envio pelo CRM (texto e legenda; áudio
   não) e para o campo de mensagem quando ele está vazio. O inbox do
   CRM não assina: se fizer falta, é uma preferência por pessoa no CRM,
   com migration.
5. ✅ **Funil de mensagens ("Sequências").** Uma automação com o
   gatilho novo **Sequência (disparo manual)**: mensagens, esperas e
   ações, sem condições. Na extensão, abaixo das respostas: Iniciar →
   Confirmar, e Parar enquanto está em andamento. A primeira mensagem
   sai na hora e o resto pelo agendador das automações. Limites: pelo
   menos 1 minuto entre duas mensagens (ao salvar e ao iniciar), uma
   vez por contato de cada vez, 100 inícios por CRM em 24 horas
   (`src/lib/api/v1/sequences.ts`). API: `/api/v1/sequences`, com
   `messages:send`. O nome "Sequências" evita confundir com o "Funil"
   do quadro de negócios. Intervalos de segundos, como o WaSeller faz
   no navegador, não entram: o agendador anda de minuto em minuto.

Riscos próprios desta etapa:
- **É a primeira que envia de verdade.** Os testes precisam de um
  número real combinado com você; não dá para testar enviando para
  clientes.
- **A chave da extensão passa a poder enviar.** Uma chave vazada envia
  em nome do cliente até ser revogada.
- **WhatsApp por QR:** envio automático em volume é o que mais pesa em
  bloqueio de número. O funil de mensagens precisa de limite por dia e
  de intervalo mínimo.

**Fase 5 — Agendamento e follow-up ✅ (feita em 10/11/2026, extensão
0.14.0, migration 064; feita junto com a 7, a pedido).**
- **Mensagem agendada:** na lista de respostas, "Enviar agora | Agendar".
  Dia e hora, um texto escrito ou uma resposta rápida (com o arquivo,
  se tiver). Sai pelo agendador do CRM (`/api/automations/cron`), pelo
  mesmo núcleo de envio do inbox, mesmo com o WhatsApp Web fechado.
  Agendar segue as condições do Enviar. De 1 minuto a 90 dias à frente,
  até 20 esperando por contato.
- **Follow-up:** "Só se o cliente não responder até lá" — na hora, a
  mensagem é pulada se o cliente escreveu depois de agendada.
- **Sequências:** "Parar se o cliente responder" (nas Automações): depois
  de cada espera, a sequência confere se o cliente escreveu desde que
  começou.
- A ficha do contato no CRM mostra as agendadas (aba Tarefas), com
  Cancelar. O campo de mensagem do inbox não agenda.
- API: `/api/v1/contacts/{id}/scheduled-messages` e
  `/api/v1/scheduled-messages/{id}`, com `messages:send`.

**Fase 6 — Kanban dentro do WhatsApp Web ✅ (em produção desde
10/11/2026, extensão 0.8.0, PR #18; conferida no WhatsApp real em 10/11,
menos o arrastar com o mouse).**
Feita antes da 3B, da 4B e da 5, a pedido. **Sem migration.**
- Botão "Funil" no rodapé do painel abre o quadro por cima do WhatsApp:
  uma coluna por etapa, com quantidade e soma.
- Mover: arrastar o card ou usar o seletor dele. O card muda na hora e
  volta se o CRM recusar.
- "Abrir conversa" no card, pelo link do próprio WhatsApp. **A página
  recarrega**: é o caminho que não depende das partes internas do
  WhatsApp. Abrir sem recarregar fica para quando isso for conferido no
  WhatsApp real.
- Busca, troca de funil, e até 300 negócios em aberto por funil.
- API: os negócios passam a trazer `contact` (id, nome e telefone),
  para o quadro não pedir um contato por card.

Não entrou: **filtrar a lista de conversas do WhatsApp por etiqueta ou
etapa.** Exigiria mexer na lista do próprio WhatsApp, que é a parte
mais frágil da página. O quadro e a busca dele cobrem o "quem está em
qual etapa".

**A conferir no WhatsApp real:** arrastar com o mouse (aqui só deu para
exercitar os eventos de arrastar, não o gesto) e se o WhatsApp reage ao
arrasto como se fosse um arquivo. O seletor do card funciona de
qualquer jeito.

**Fase 7 — Autorresponder e chatbot.**
- Ligar, desligar e escolher o fluxo pela extensão.
- Pausar o robô numa conversa.

**Fase 8 — Disparos e status.**
- Disparo para uma lista ou etiqueta.
- Status agendado, se o provedor permitir.

**Fase 9 — Integrações.**
- Google Agenda, exportação de contatos, atalho para webhooks.

**Botões dentro do WhatsApp Web (pedido em 10/11/2026; sem fase
marcada).** O WaSeller, além do painel, põe botões na própria tela do
WhatsApp, e a extensão deve ter os seus:
- uma barra no alto da conversa (etiqueta, etapa, tarefa, assumir);
- uma coluna de ícones ao lado da conversa (ficha, agenda, notas,
  lembrete);
- uma linha ao lado do campo de mensagem (respostas rápidas, agendar,
  anotação);
- um trilho na lateral esquerda (funil, disparos, agenda).

Como fazer sem ficar frágil: os botões são atalhos para o que o painel
já faz, e ficam **ancorados por posição** (medindo o cabeçalho e o
rodapé da conversa), sem enfiar nada dentro da árvore do WhatsApp, que
ele reconstrói a toda hora. Sem a âncora, os botões somem e o painel
continua valendo. Começar pela linha do campo de mensagem e pela barra
da conversa, que são as que economizam clique no atendimento. Em
10/11 viu-se que algo na página apaga classes desconhecidas do `<html>`
e que o WaSeller cobre a tela inteira quando pede login: a extensão não
pode depender de nada disso.

### Conferência no WhatsApp real (10/11/2026, extensão 0.9.0)

Feita no Chrome do Marcelo, numa conversa de teste, sem enviar nada.

Funcionou:
- **Reconhecer a conversa.** Sem conversa aberta, o painel diz isso.
  Numa conversa `@lid`, a leitura interna trouxe o número que o WhatsApp
  tem, e o contato foi achado no CRM.
- **Ficha.** Negócios, Tarefas, Notas e Dados carregaram do CRM em
  produção.
- **Respostas rápidas.** A lista abriu (vazia: o CRM ainda não tem
  resposta de texto). A colagem no campo de mensagem do WhatsApp real
  funciona: conferida com o mesmo evento de colar que a extensão usa (o
  campo é um editor Lexical). O texto de teste foi apagado em seguida.
- **Minhas tarefas** e **Funil** abriram com os dados reais; o quadro
  cobre o WhatsApp até a coluna do painel.
- Tema claro e nome do CRM no cabeçalho.

Defeito achado, corrigido na 0.9.1:
- **O painel aberto cobria a conversa.** A coluna é aberta por uma
  marca no `<html>`. Era uma classe, e algo na página (o WhatsApp ou o
  WaSeller, instalado nesse Chrome) apaga na hora qualquer classe que
  não conhece. A conferência do encaixe procurava a classe, não achava e
  saía sem fazer nada: o painel não ficava encaixado nem flutuante.
- Correção: a marca passa a ser um atributo (`data-crmc-docked`), que a
  página não apaga; a conferência **mede** se o WhatsApp estreitou, em
  vez de procurar a marca; e a cada ciclo o painel repõe a marca se ela
  sumir e, se o WhatsApp não abrir espaço, flutua.

Não deu para conferir:
- **Grupo.** A tela de login do WaSeller cobriu a lista de conversas
  na janela do teste.
- **Faixa "Assumir".** A conversa de teste não tem atendimento por IA.
- **Arrastar card com o mouse.** O gesto precisa de mão; o seletor do
  card funciona.
- **Lembrete no sino** na hora marcada (depende do agendador em
  produção).

### Riscos

- **Regras do WhatsApp.** Disparo em massa e automação em número
  comum (por QR) são os motivos mais frequentes de bloqueio. Na API
  oficial o disparo exige modelo aprovado. Cada função dessas precisa de
  limite e de aviso claro para o cliente.
- **Promessa atual da extensão.** Hoje ela diz "não lê suas conversas" e
  "não envia mensagens". No caminho A a primeira continua verdadeira (as
  mensagens chegam ao CRM pelo canal, não pela página). A segunda muda:
  ela passa a pedir o envio ao CRM.
- **Chave da extensão.** Ela ganha escopos de envio. Uma chave vazada
  passa a poder mandar mensagem em nome do cliente; a revogação por
  pessoa (migration 054) continua valendo.
- **Tamanho.** São oito fases. Dá para parar em qualquer uma e o que
  ficou pronto continua funcionando.

## Decisões que precisam ser suas

Em aberto:

1. **Disparo em massa no número por QR:** só com limite diário,
   intervalo entre envios e aviso de risco (**recomendado**) · só pela
   API oficial · sem limite. Decide-se antes da Fase 8.
2. **Ordem das fases:** a de cima (**recomendado**) · outra prioridade.

Já decididas:

- Vínculo das conversas `@lid`: guardado no navegador de quem vinculou.
- Nome da extensão: "Harpium CRM".
- Painel: coluna encaixada que estreita o WhatsApp.
- **Envio (09/11/2026):** as mensagens saem pelo número conectado ao
  CRM (caminho A). Para quem não conectou o número, a extensão só cola
  o texto no campo de mensagem e a pessoa envia; as demais funções de
  envio pedem para conectar.

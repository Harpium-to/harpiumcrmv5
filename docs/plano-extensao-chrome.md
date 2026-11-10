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

## Fase 1 — Corrigir o que falha ✅ (em produção desde 09/11/2026, falta testar no WhatsApp real)

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

**Fase 2 — Base visual ✅ (código pronto, extensão 0.5.0, falta testar
no WhatsApp real).** Branch `feat/extensao-fase2-visual`.
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
- Notas, etiquetas, editar nome/e-mail/empresa.
- Criar negócio, mover de etapa, ganhar e perder.
- Tarefas e lembretes.
- Estado da conversa no CRM (IA respondendo, aguardando atendente) e
  **Assumir**.

**Fase 4 — Mensagens com 1 clique.** Primeira fase que envia.
- Respostas rápidas com texto, áudio, imagem, vídeo e arquivo.
- Funil de mensagens (sequência com intervalos).
- Assinatura do atendente.

**Fase 5 — Agendamento e follow-up.**
- Mensagem agendada por conversa.
- Follow-up automático quando o cliente não responde.

**Fase 6 — Kanban dentro do WhatsApp Web.**
- Quadro do funil em tela cheia, com arrastar e soltar.
- Abrir a conversa a partir do card.
- Filtrar a lista de conversas por etiqueta ou etapa.

**Fase 7 — Autorresponder e chatbot.**
- Ligar, desligar e escolher o fluxo pela extensão.
- Pausar o robô numa conversa.

**Fase 8 — Disparos e status.**
- Disparo para uma lista ou etiqueta.
- Status agendado, se o provedor permitir.

**Fase 9 — Integrações.**
- Google Agenda, exportação de contatos, atalho para webhooks.

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

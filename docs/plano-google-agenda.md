# Plano: ligar a Agenda do CRM ao Google Agenda de cada cliente

Data: 12 de novembro de 2026. Status: **G1 no ar; G2 e G3 implementadas (migration 071)**. As cinco decisões valem com as recomendações. Falta só pedir a verificação do Google (G0.8), que depende do vídeo: o roteiro está em `docs/analise-do-app/roteiro-verificacao-google.md`.

## Andamento (12 de novembro de 2026)

- **G0.1 Projeto:** criado o "Harpium CRM" (ID `harpium-crm`) na conta Google da agência, com a Google Calendar API ativada.
- **G0.5 Tela de consentimento:** público Externo, em modo Teste, com os escopos salvos. O Google classifica:
  - `calendar.events.owned` como **sensível**, então pede verificação com vídeo;
  - `calendar.calendarlist.readonly`, `openid` e `email` como não sensíveis;
  - nenhum escopo como restrito, então não há auditoria de segurança.
- **G0.6 Credenciais:**
  - criado o cliente "Harpium CRM (web)";
  - endereços de retorno: `https://harpium.com.br/google/retorno` e `http://localhost:3000/api/google/oauth/callback`;
  - o ID e a chave foram copiados para o Netlify pelo dono.
- **G0.7 Usuários de teste:** a conta da agência e a conta pessoal do dono.
- **G0.3 Site harpium.com.br:** publicado em 12 de novembro, a partir da pasta `harpiumgroup-site` (site "harpium-site" no Netlify):
  - `https://harpium.com.br/privacidade/`: a política do CRM, com a seção "Dados do Google Agenda" e a frase de Uso Limitado;
  - `/google/retorno`: um 302 para `https://harpium-crm.netlify.app/api/google/oauth/callback`, com a query junto;
  - o rodapé e o cartão "Harpium CRM" apontam para essa política.
- **G0.5 Branding:** página inicial `https://harpium.com.br`, política `https://harpium.com.br/privacidade/` e domínio autorizado `harpium.com.br`. O logo fica para a verificação.
- **G0.2 Domínio:** harpium.com.br verificado no Search Console em 12 de novembro, na conta da agência, por um registro TXT `google-site-verification` na Cloudflare. **Não apague esse registro**: sem ele o domínio perde a verificação.
- **Falta da G0:** pedir a verificação do app (vídeo e justificativas), depois que a G1 e a G2 estiverem no ar.
- **G1 (código):** no ar desde 12 de novembro: PR #35, com a migration 069 aplicada e conferida, e a correção do endereço de volta no PR #36. A primeira conexão real funcionou.
  - **Migration 069:** conexões, segredos só do servidor, pedidos de conexão, fila de remoções, gatilhos, `claim` e `finish`.
  - **Rotas:** `/api/google/oauth/start` e `/callback`, e `/api/agenda/google/{calendars,link,disconnect,sync}`.
  - **Envio:** `src/lib/agenda/google-sync.ts`, chamado pelo agendador, pela tela, pela IA, pelo link público e pelas aprovações.
  - **Tela:** o cartão "Google Agenda" na engrenagem e a situação no agendamento.
  - **Testes:** com respostas do Google simuladas e com o banco de verdade (PGlite).
  - **Variáveis `GOOGLE_*`:** criadas no Netlify do CRM.
- **G2 e G3 (código, migration 071):** o usuário pediu, em 12 de novembro, para terminar o plano sem aprovar fase por fase.
  - **G2:**
    - os compromissos do Google aparecem na Agenda como "Ocupado (Google)", sem o título (decisão 3);
    - esses horários não são oferecidos pela IA nem pelo link público;
    - marcar por cima deles pela tela dá aviso;
    - um agendamento do CRM movido ou apagado no Google ganha um aviso e uma notificação no sino (decisão 4);
    - cada agenda tem o liga/desliga "Mostrar os compromissos do Google nesta agenda", pedido pelo usuário, ligado por padrão.
  - **G3:**
    - "Enviar link para o profissional conectar" (7 dias, uma conexão, sem login no CRM);
    - conexão caída avisa os admins no sino e mostra uma faixa na Agenda;
    - um cartão "Google Agenda" no painel da agência, em `/agencia/[CRM]`.
  - **Mudança no desenho da G2:** em vez das marcas de sincronização do Google (`syncToken`), o CRM relê uma janela fixa (de ontem a 90 dias à frente) a cada leitura. É uma chamada por agenda do Google, sem estado para perder. Cada agenda é relida no máximo a cada minuto: pelo agendador, ao abrir a tela da Agenda e logo antes de a IA ou o link público marcarem.
  - **Não feito:** o aviso por push do Google (`events.watch`), que era opcional. O atraso de minutos do agendador não justificou a complexidade.

## O pedido

Cada cliente conecta a própria conta Google no CRM dele, e a Agenda passa a valer nos dois sentidos:
- o que é marcado no CRM aparece no Google Agenda do profissional;
- o que o profissional marca no Google bloqueia aquele horário no CRM, para a equipe, para o agente de IA e para o link público de agendamento.

## O que já existe (PR #31, migration 067)

- **Endereço .ics secreto por agenda:** o Google, o Apple e o Outlook mostram os agendamentos do CRM. Só leitura, e o Google atualiza quando quer, às vezes com horas de atraso.
- **"Adicionar ao meu Google Agenda":** abre o Google com um agendamento já preenchido, um por vez.
- **O que falta:** o Google não manda nada de volta. Um compromisso que está só no Google não ocupa o horário no CRM, e o link público e a IA podem oferecer esse horário.

O endereço .ics continua existindo para quem usa Apple ou Outlook, ou não quer conectar uma conta.

## Como fica para o cliente

> **Agenda › engrenagem › agenda "Dr. João" › Google Agenda › Conectar** → abre a janela do Google → o profissional entra com a conta dele e aceita → escolhe em qual agenda do Google os agendamentos entram → pronto.

| Onde se marca | Quando aparece do outro lado |
|---|---|
| No CRM: tela, agente de IA ou link público | No Google, em segundos. O agendador do CRM é a garantia se algo falhar. |
| No Google | No CRM, no próximo ciclo do agendador (1 a 5 minutos). Antes de a IA ou o link público confirmarem um horário, o CRM confere o Google de novo, na hora. |

### Quem faz o quê

| Etapa | Quem faz |
|---|---|
| Criar o app no Google, verificar o domínio, passar pela verificação | **A Harpium, uma vez.** Um app "Harpium CRM" no Google serve todos os CRMs, como o app da Meta. |
| Autorizar a conta Google | O cliente ou o profissional, em uns 30 segundos. |
| Chaves, tokens, renovação do acesso | Automático. O CRM guarda a autorização cifrada. |
| Custo | A API do Google Agenda é gratuita. Não há cobrança por cliente. |

## Como funciona

- **Uma conta Google pode servir várias agendas do CRM:** uma clínica com uma conta Google pode ligar as agendas "Dr. João" e "Dra. Ana" do CRM a duas agendas diferentes dessa mesma conta.
- **Cada agenda do CRM escolhe:**
  - em qual agenda do Google grava (padrão: a principal da conta);
  - quais agendas do Google contam como ocupado (padrão: a mesma). Dá para marcar também a agenda pessoal, por exemplo.
- **CRM → Google:**
  - marcar cria o evento no Google;
  - remarcar move o evento;
  - cancelar apaga o evento;
  - bloqueios (férias, almoço) também vão para o Google;
  - um agendamento da IA que espera aprovação vai com "(aguardando aprovação)" no título.
- **Google → CRM:** os compromissos do Google viram "Ocupado (Google)":
  - somam aos horários ocupados de "Horários livres", da IA e do link público;
  - na tela, aparecem como blocos cinza;
  - marcar por cima deles pela tela é possível, com um aviso, como já acontece com o encaixe fora do horário de atendimento.
- **Quem manda nos agendamentos do CRM é o CRM.** Se alguém mover ou apagar no Google um evento que o CRM criou, o CRM avisa e uma pessoa decide (ver a decisão 4).
- **O cliente do consultório nunca recebe convite do Google:** o evento é só do profissional.

## O que o CRM pede ao Google, e o que guarda

| Permissão (escopo) | Para quê |
|---|---|
| `calendar.events.owned` | Criar, mover e apagar os eventos do CRM, e ler os horários ocupados nas agendas que a conta possui. É mais estreita que `calendar.events`, que pega todas as agendas a que a conta tem acesso. |
| `calendar.calendarlist.readonly` | Listar as agendas da conta, para o cliente escolher onde gravar e o que conta como ocupado. |
| `openid` e `email` | Mostrar qual conta está conectada ("conectado como joao@…"). |

- **Guardamos:**
  - a autorização (refresh token) cifrada com a mesma chave dos tokens da Meta (`ENCRYPTION_KEY`);
  - o e-mail da conta;
  - as agendas escolhidas;
  - o início e o fim de cada compromisso do Google, de hoje até 90 dias à frente;
  - o ID de cada evento que o CRM criou no Google.
- **Não guardamos:** título, descrição, local nem participantes dos compromissos do Google (ver a decisão 3).
- **Desconectar:** apaga do CRM a autorização e os horários ocupados, e avisa o Google para revogar o acesso.
- **O que o Google exige:** os dados do Google só servem para a agenda funcionar. Não vão para treino de IA nem para ninguém fora do CRM do cliente. A política de privacidade precisa dizer isso.

## Fases

### Fase G0: liberar a Harpium no Google (você, com a minha ajuda no Chrome)

1. **Projeto no Google Cloud:** criar o projeto "Harpium CRM" com a conta Google da agência e ligar a Google Calendar API.
2. **Domínio:**
   - verificar harpium.com.br no Google Search Console com um registro TXT no Cloudflare;
   - o Google só aceita endereços de retorno em domínio verificado, e harpium-crm.netlify.app é da Netlify;
   - ver a decisão 1.
3. **No site harpium.com.br** (Netlify "harpium-site"), três coisas:
   - uma página do Harpium CRM, que o Google vai usar como página inicial do app;
   - `/privacidade`, servindo a política que já existe no CRM (https://harpium-crm.netlify.app/privacidade), para ela ficar no mesmo domínio da página inicial;
   - `/google/retorno`, que repassa a resposta do Google para o CRM.
4. **Política de privacidade:** uma seção "Dados do Google Agenda". Ela diz o que lemos, o que guardamos, como apagar e que seguimos a Política de Dados do Usuário dos Serviços de API do Google, incluindo os requisitos de Uso Limitado.
5. **Tela de consentimento** (tipo Externo): nome "Harpium CRM", o ícone de `docs/analise-do-app/harpium-crm-icon-1024.png`, e-mail de suporte, página inicial, política, domínio autorizado e os escopos acima. O Google marcou só o `calendar.events.owned` como sensível (ver Andamento).
6. **Credenciais:** um cliente OAuth do tipo Web, com retorno em `https://harpium.com.br/google/retorno`. As variáveis `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` vão para o Netlify.
7. **Usuários de teste:** as contas Google da Harpium. No modo "Teste" a autorização vence a cada 7 dias, o que basta para desenvolver e gravar o vídeo.
8. **Verificação**, depois da G1 e da G2 no ar:
   - um vídeo em inglês mostrando a tela de consentimento com os escopos e o uso no CRM;
   - a justificativa de cada escopo;
   - eu preparo o roteiro, como fizemos para a Meta.

   O Google não informa o prazo da verificação.

### Fase G1: conectar e mandar do CRM para o Google (código)

- **Migration 069:**
  - **Conexões Google por CRM:** e-mail da conta, autorização cifrada numa coluna que só o servidor lê, escopos concedidos e situação ("conectado" ou "precisa reconectar", com o motivo).
  - **Na agenda do CRM:** qual conexão, em qual agenda do Google grava e quais contam como ocupado.
  - **No agendamento:**
    - o ID do evento no Google e em qual agenda do Google ele está;
    - a situação do envio (pendente, enviado ou erro) e o erro.
  - **Gatilho:** marca "pendente" quando mudam horário, situação, título, observações, contato ou agenda. Fica no banco porque a tela, a IA, o link público e as aprovações gravam por caminhos diferentes, e assim nenhum escapa.
  - **Pedidos de conexão:** um código de uso único que vale 15 minutos e diz qual CRM, qual agenda e quem pediu. É ele que liga a resposta do Google à agenda certa, e permite a G3 conectar sem login no CRM.
  - Uma função que entrega ao agendador os envios pendentes, cada um uma vez só, como `claim_calendar_notifications`.
- **Servidor:**
  - iniciar a conexão (admin do CRM): gera o código e manda para a janela do Google;
  - retorno: troca o código pela autorização, guarda tudo cifrado, lista as agendas da conta e grava os agendamentos de hoje em diante;
  - empurrão logo após salvar na tela, como o `/api/agenda/notify`. A IA e o link público empurram sozinhos, no servidor;
  - o `/api/automations/cron` envia o que ficou pendente e tenta de novo o que deu erro;
  - desconectar: revoga no Google e apaga do CRM. O CRM pergunta se é para apagar do Google os eventos que ele criou;
  - chamadas diretas à API REST do Google, sem a biblioteca `googleapis`, que é pesada.
- **O que vai para o Google:**
  - **título:** "Consulta · Maria Silva" (ver a decisão 2);
  - **descrição:** o WhatsApp do contato, as observações e o link para a ficha no CRM;
  - **fuso:** o da agenda.
  - **Marca invisível:** o ID do agendamento vai junto, para o CRM reconhecer os próprios eventos e não lê-los de volta como "ocupado".
- **Tela:** em Agenda › engrenagem, cada agenda ganha um cartão "Google Agenda" com quatro opções:
  - Conectar;
  - "Conectado como …";
  - escolher a agenda do Google;
  - Desconectar.

  O agendamento mostra um ícone pequeno "no Google" ou "não foi para o Google", com o motivo.
- **Ajuda:** o tópico da Agenda em `src/lib/help/topics.ts` ganha o passo a passo.
- **Testes automatizados** do caminho todo, com respostas do Google simuladas.

### Fase G2: o Google bloqueia horários no CRM (código)

- **Migration 071:** guarda os horários ocupados (agenda do Google, ID do evento, início e fim, sem título) e, por agenda do Google, quando ela foi lida pela última vez.
- **Liga/desliga por agenda:** "Mostrar os compromissos do Google nesta agenda", ligado por padrão. Desligado, nada vem do Google.
- **Leitura:**
  - o CRM relê do Google a janela de ontem a 90 dias à frente, no máximo a cada minuto por agenda: no ciclo do agendador, ao abrir a tela da Agenda e antes de a IA ou o link público marcarem;
  - os eventos que se repetem entram um a um.
  - **Ficam de fora:**
    - compromissos marcados como "Disponível", como os de dia inteiro, que o Google cria assim por padrão;
    - convites recusados e eventos cancelados;
    - os eventos que o próprio CRM criou.
- **Horários livres:** `freeSlots` (`src/lib/agenda/slots.ts`) já recebe uma lista de ocupados; ela passa a incluir os do Google. A lista vale para a tela, a IA (`src/lib/agenda/ai.ts`) e o link público (`src/lib/agenda/public.ts`).
- **Na hora de marcar:**
  - a IA e o link público releem o Google daquela agenda antes de confirmar;
  - se o Google não responder, valem os ocupados da última leitura e o erro fica registrado.
- **Tela:**
  - blocos cinza "Ocupado (Google)" na semana e no dia;
  - "Horários livres" não oferece esses horários;
  - marcar por cima dá o aviso de encaixe.
- **Agendamento do CRM mexido no Google:** se o evento foi movido ou apagado lá, o agendamento ganha um aviso ("movido no Google para 15:00" ou "apagado no Google") e quem pode marcar recebe uma notificação no sino. Nada muda sozinho, e o cliente não recebe mensagem (decisão 4).

### Fase G3: acabamento

- **Link para o profissional conectar:** o admin gera um link para uma agenda e manda pelo WhatsApp, como o "Enviar link de conexão" do WhatsApp (W2). O profissional abre o link, entra no Google e pronto, sem precisar de login no CRM. O link é de uso único e vale 7 dias.
- **Painel da agência:** em `/agencia/[CRM]`, quais agendas estão ligadas ao Google e quais estão com erro.
- **Conexão caída** (senha trocada, acesso removido no Google): um aviso no sino para os admins e uma faixa na Agenda, "Reconecte o Google Agenda de Dr. João". Os agendamentos continuam no CRM, e nada se perde.
- **Opcional, para baixar o atraso de minutos para segundos:** o aviso por push do Google (`events.watch`). O canal não se renova sozinho e precisa ser recriado antes de vencer, então só vale se o atraso do agendador incomodar.

## Limites e cuidados

- **Só agendas da própria conta:** o escopo escolhido cobre as agendas que a conta conectada possui. Uma agenda compartilhada por outra pessoa não entra, a menos que essa pessoa conecte a conta dela.
- **Google Workspace:** contas de empresa com Google Workspace podem ter o administrador bloqueando apps de terceiros. Nesse caso, o administrador do cliente precisa liberar o "Harpium CRM" no painel dele.
- **Antes da verificação:** o Google mostra a tela "o Google não verificou este app". Ele também limita um app não verificado a 100 usuários novos no total, para sempre; esse limite não volta a zero.
- **No modo "Teste":** só entram os usuários de teste cadastrados, e a autorização vence a cada 7 dias.
- **O CRM continua sendo a fonte da verdade:** se o Google cair, a agenda do CRM segue funcionando. Só a sincronização espera.

## Decisões (tomadas em 12 de novembro de 2026: valem as recomendadas)

1. **Domínio do retorno do Google:**
   - **Recomendado:** usar harpium.com.br, com o retorno passando por harpium.com.br/google/retorno. O CRM fica onde está, e nada muda para o WhatsApp, os webhooks ou os logins.
   - **Alternativa:** mudar o CRM para um endereço próprio, como crm.harpium.com.br. É o mais limpo a longo prazo, mas mexe nos logins do Supabase, no domínio liberado no app da Meta e nos links já enviados. Dá para fazer depois.
2. **O que o CRM grava no Google:**
   - **Recomendado:** nome e WhatsApp do contato e observações, para o profissional saber quem vem.
   - **Alternativa:** só "Agendamento (CRM)", se algum cliente não quiser dados dos pacientes no Google.
3. **O que o CRM mostra dos compromissos do Google:**
   - **Recomendado:** só "Ocupado". É menos dado guardado, a verificação fica mais simples, e nada pessoal do profissional chega à equipe nem à IA.
   - **Alternativa:** mostrar também o título.
4. **Quando alguém mexe no Google num agendamento do CRM:**
   - **Recomendado:** o CRM só avisa, e uma pessoa remarca ou cancela no CRM, que avisa o cliente como hoje.
   - **Alternativa:** o CRM aplica sozinho e manda a mensagem ao cliente. É arriscado, porque apagar um evento por engano no celular cancelaria a consulta do paciente.
5. **Ponte até a verificação:**
   - **Recomendado:** nenhuma. Até o Google verificar, só a Harpium testa com as próprias contas.
   - **Alternativa:** publicar sem verificação para os primeiros clientes. Eles veriam o aviso de app não verificado, e cada conta conectada gastaria uma das 100 vagas permanentes.

## Fontes

- Google, escopos da API do Google Agenda: https://developers.google.com/workspace/calendar/api/auth
- Google, sincronização incremental (`syncToken`, erro 410): https://developers.google.com/workspace/calendar/api/guides/sync
- Google, avisos por push (`events.watch`): https://developers.google.com/workspace/calendar/api/guides/push
- Google, verificação de escopos sensíveis: https://support.google.com/cloud/answer/13464321
- Google, modo Teste e Produção, limite de 100 usuários e autorização de 7 dias: https://support.google.com/cloud/answer/15549945
- Google, tela de app não verificado: https://support.google.com/cloud/answer/7454865
- Google, Política de Dados do Usuário dos Serviços de API (Uso Limitado): https://developers.google.com/terms/api-services-user-data-policy

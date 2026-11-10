# Hospedar e testar — o que só o dono pode fazer

Cada passo aqui pede uma senha, uma chave secreta ou uma decisão de
conta, por isso não dá para automatizar. Siga na ordem: cada etapa
depende da anterior.

| # | Onde | O quê | Tempo |
|---|---|---|---|
| 1 | Supabase | aplicar as migrations que faltam | 10 min |
| 2 | Supabase | URLs de login e sua conta de agência | 5 min |
| 3 | Netlify | variáveis de ambiente e deploy | 15 min |
| 4 | cron-job.org (ou similar) | agendador dos agentes e automações | 10 min |
| 5 | CRM no ar | conectar o WhatsApp e a chave de IA | 10 min |
| 6 | CRM no ar | roteiro de teste | 30 min |

---

## 1. Supabase — migrations

### 1.1 Descobrir quais faltam

No painel do Supabase, abra **SQL Editor** e rode:

```sql
select migration, aplicada from (values
  ('037_agencia_supervisao',    to_regclass('public.agencia_membros') is not null),
  ('038_agencia_auditoria',     to_regclass('public.agencia_auditoria') is not null),
  ('039_leads',                 to_regclass('public.leads') is not null),
  ('040_meta_lead_pages',       to_regclass('public.meta_lead_pages') is not null),
  ('041_app_branding',          to_regclass('public.app_branding') is not null),
  ('042_evolution_channel',     to_regclass('public.evolution_config') is not null),
  ('043_uazapi_channel',        to_regclass('public.uazapi_config') is not null),
  ('044_agent_team',            to_regclass('public.agents') is not null),
  ('045_agent_operation',       to_regclass('public.agent_tasks') is not null),
  ('046_deal_close_timestamp',  exists (select 1 from information_schema.columns
                                        where table_schema = 'public' and table_name = 'deals'
                                          and column_name = 'closed_at')),
  ('047_instagram_channel',     to_regclass('public.instagram_config') is not null),
  ('048_report_first_response', to_regprocedure('public.report_first_response(uuid, timestamptz, timestamptz, text)') is not null)
) as m(migration, aplicada)
order by migration;
```

Cada linha com `aplicada = false` é uma migration que ainda precisa
rodar.

### 1.2 Aplicar

Para cada uma que faltar, **em ordem numérica**: abra o arquivo em
`supabase/migrations/`, copie o conteúdo inteiro, cole numa query nova
do SQL Editor e clique em **Run**. Rode a próxima só depois que a
anterior terminar sem erro.

Todas podem rodar de novo sem estragar nada. Se uma der erro no meio,
corrija a causa e rode o arquivo inteiro outra vez.

> **A 048 cria um índice na tabela de mensagens** e trava o recebimento
> de mensagens enquanto o índice é construído. Numa conta com poucas
> mensagens isso leva segundos. Com muitas, rode fora do horário de
> atendimento.

Rode a consulta do 1.1 de novo no final: tudo precisa dar `true`.

---

## 2. Supabase — login

### 2.1 URLs de autenticação

Em **Authentication › URL Configuration**:

- **Site URL:** o endereço público do CRM, por exemplo
  `https://crm.seudominio.com.br`
- **Redirect URLs:** adicione
  - `https://crm.seudominio.com.br/**`
  - `http://localhost:3000/**` (para testar na sua máquina)

Sem isso, os links de "esqueci a senha" e de confirmação de cadastro
levam para o endereço errado.

### 2.2 Sua conta

1. No CRM, clique em **Criar conta**, ou use a conta que você já tem.
   Para ver as contas existentes: **Authentication › Users**.
2. Para ter o painel da agência (`/agencia`, que supervisiona todos os
   clientes), rode no SQL Editor, com o seu e-mail:

```sql
insert into agencia_membros (user_id, label)
select id, 'Dono' from auth.users where email = 'seu-email@exemplo.com'
on conflict (user_id) do nothing;
```

---

## 3. Netlify — publicar o app

O repositório já tem o `netlify.toml` pronto (Next.js, Node 22).

### 3.1 Ligar o site ao GitHub

Em **Site configuration › Build & deploy › Continuous deployment**,
confirme que o site está ligado a `Harpium-to/harpiumcrmv5`:

- **Production branch:** `main`
- **Deploy Previews:** ative "Any pull request" para testar o PR antes
  de mesclar. O Netlify gera um endereço próprio para o PR #1.

> O que está no ar hoje vem da `main`, que **ainda não tem** nada deste
> PR. Para testar o que foi construído, use o Deploy Preview ou mescle o
> PR.

### 3.2 Variáveis de ambiente

Em **Site configuration › Environment variables**:

| Variável | De onde vem | Obrigatória |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase › Project Settings › API › Project URL | sim |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase › Project Settings › API › `anon` `public` | sim |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase › Project Settings › API › `service_role` (secreta) | sim |
| `ENCRYPTION_KEY` | **a mesma** do seu `.env.local` (ver abaixo) | sim |
| `META_APP_SECRET` | Meta for Developers › seu app › Configurações › Básico | sim |
| `NEXT_PUBLIC_SITE_URL` | o endereço público, sem `/` no final | sim |
| `NEXT_PUBLIC_APP_URL` | o mesmo endereço público | sim |
| `NEXT_PUBLIC_APP_LOCALE` | `pt` | sim |
| `AUTOMATION_CRON_SECRET` | invente: `openssl rand -hex 32` no terminal | sim, para agentes e automações |
| `META_APP_ID` | Meta for Developers › Configurações › Básico | só para Lead Ads e templates com imagem |
| `META_LEADS_VERIFY_TOKEN` | invente uma frase secreta | só para Lead Ads |
| `META_INSTAGRAM_VERIFY_TOKEN` | invente uma frase secreta | só para Instagram (etapa final) |
| `UAZAPI_BASE_URL` | painel da UAZAPI › endereço do servidor da Harpium, sem `/` no final | só para o WhatsApp não oficial (QR code) |
| `UAZAPI_ADMIN_TOKEN` | painel da UAZAPI › token de administrador do servidor (secreto) | só para o WhatsApp não oficial (QR code) |

**Sobre a UAZAPI:** com essas duas variáveis, um cliente que escolhe o
WhatsApp não oficial em Configurações › WhatsApp só lê o QR code: o CRM
cria a instância no servidor da Harpium e configura o webhook sozinho.
O token de administrador fica só no Netlify, nunca no banco. Sem elas,
o caminho não oficial aparece, mas diz ao cliente para falar com a
agência. Ver `docs/plano-whatsapp-dois-caminhos.md`.

**Sobre a `ENCRYPTION_KEY`:** ela cifra os tokens de WhatsApp e as
chaves de IA guardadas no banco. Como o seu computador e o Netlify usam
o **mesmo** Supabase, as duas precisam ter a mesma chave. Se forem
diferentes, o que foi salvo de um lado não abre do outro. Se você nunca
salvou nada, pode gerar uma nova com
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
e colocar a mesma no `.env.local`.

As variáveis `NEXT_PUBLIC_*` entram no build. Depois de mudar qualquer
uma, faça um novo deploy (**Deploys › Trigger deploy**).

---

## 4. Agendador — agentes, automações e flows

Três endpoints precisam ser chamados periodicamente. Sem eles, os
agentes não executam a fila, e as automações com espera e os flows não
avançam. O app não se chama sozinho.

| Endpoint | Frequência |
|---|---|
| `GET https://SEU-DOMINIO/api/agents/cron` | a cada 1 min |
| `GET https://SEU-DOMINIO/api/automations/cron` | a cada 1–5 min |
| `GET https://SEU-DOMINIO/api/flows/cron` | a cada 1–5 min |

Todos exigem o cabeçalho `x-cron-secret` com o valor de
`AUTOMATION_CRON_SECRET`.

O `automations/cron` também envia os **lembretes de tarefas** (o aviso
no sino quando uma tarefa vence, migration 060). Não há job separado
para isso: com ele parado, as tarefas continuam aparecendo, mas ninguém
é avisado na hora.

O mesmo `automations/cron` envia as **mensagens agendadas** e os
**disparos pelo QR code** (migrations 064 e 065), um a cada 30–90 s e até
200 por dia por CRM. Quanto mais frequente o agendador, mais perto da
hora marcada elas saem: com ele a cada 10 minutos, uma mensagem pode
sair até 10 minutos depois.

**Com o cron-job.org** (gratuito): crie um job para cada endpoint. Em
**Advanced › Headers**, adicione `x-cron-secret` com o seu segredo.
Para conferir: a resposta deve ser `200`. `401` é segredo errado e
`503` é a variável faltando no Netlify.

---

## 5. Conectar os canais

### 5.1 WhatsApp

Em **Canais**, escolha um provedor:

- **WhatsApp Cloud API (oficial da Meta):** em Configurações ›
  WhatsApp. A tela mostra a URL do webhook
  (`https://SEU-DOMINIO/api/whatsapp/webhook`) e o token de verificação
  para colar no app da Meta.
- **Evolution API** ou **uazapi:** em Canais, informe o endereço e a
  chave da sua instância. A tela mostra a URL de webhook para
  configurar do lado do provedor.

### 5.2 Assistente de IA

Os agentes usam a chave de IA da própria conta: em **Agentes**, aba de
configuração (`/agents?tab=setup`), cole uma chave da OpenAI ou da
Anthropic. Ela é
guardada cifrada no banco. Sem ela, os agentes ficam parados.

---

## 6. Roteiro de teste

Marque cada item. Se algo falhar, anote a tela e o que apareceu.

**Base**
- [ ] Entrar, sair e entrar de novo; "esqueci a senha" chega por
      e-mail e o link abre no endereço certo
- [ ] `/agencia` aparece para a sua conta de agência

**Atendimento**
- [ ] Mandar uma mensagem de outro celular para o número conectado → ela
      aparece no **Inbox**
- [ ] Responder pelo Inbox → a mensagem chega no celular
- [ ] O contato foi criado em **Contatos**

**Funil**
- [ ] Criar um negócio para o contato em **Funil**
- [ ] Arrastar o negócio de etapa
- [ ] Marcar como ganho → em **Relatórios**, aparece em "fechamentos"
      com a data de hoje

**Relatórios**
- [ ] Sem o aviso de "números aproximados" (sinal de que a 046 entrou)
- [ ] Cartão **Tempo de primeira resposta** com números (048)
- [ ] Baixar um CSV de qualquer cartão

**Agentes**
- [ ] `/agents` lista os agentes; criar um pela biblioteca
- [ ] Com o agente ativo e o cron rodando: mandar uma mensagem e ver a
      resposta automática ou a tarefa na fila

**API e extensão**
- [ ] Configurações › Chaves de API: criar uma chave com `contacts:read`,
      `contacts:write`, `deals:read`, `deals:write`
- [ ] Instalar a extensão (`extension/README.md`), colar o endereço do
      CRM e a chave → "Conectado a …"
- [ ] No WhatsApp Web, abrir a conversa com o contato de teste → painel
      com nome, temperatura e o negócio; trocar a etapa ali e conferir
      no Funil

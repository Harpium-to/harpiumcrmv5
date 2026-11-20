# Integração Harpium CRM ↔ Agency OS (o sistema interno)

Documento de planejamento. Escrito em 20/11/2026 a partir do `main` do CRM
(`17b4528`) e do ramo da pasta do Agency OS (`0be2f26`).

**Andamento:**

- 20/11/2026: plano **aprovado** pelo dono, com todas as decisões do §8
  conforme a recomendação. Nenhum código escrito ainda; a execução
  começa pela Fase 0.

Neste documento, **CRM** = esta pasta (`harpiumcrmv5`, o Harpium CRM) e
**AOS** = a pasta `APP Harpium` (o Agency OS, sistema interno da agência).

---

## 1. Pedido refinado

> O Agency OS tem um CRM comercial simples (`renderCRM`, um funil próprio
> guardado no Firebase). O Harpium CRM é muito mais completo e já é onde a
> agência opera de verdade: leads do quiz, Agent SDR, WhatsApp, funis,
> agenda, automações.
>
> Queremos **ver o Harpium CRM de dentro do Agency OS**:
>
> 1. **Puxar os dados:** leads, contatos, funil e negócios, conversas,
>    tarefas, agenda e os números da operação.
> 2. **Ver a operação por cima:** um painel com o que importa (leads que
>    entraram, quem está esperando resposta, quanto tem no funil, o que foi
>    ganho, se os canais estão conectados).
> 3. **Um botão que leva ao CRM** no ponto exato (aquele lead, aquele
>    negócio, aquela conversa, a tela de automações) para configurar e
>    operar **lá**.
>
> O Agency OS **só lê**. Configurar e operar continua sendo no Harpium CRM.

Consequência natural: como o Harpium CRM é a plataforma que a agência
entrega aos clientes, a mesma ponte mostra também os **CRMs dos clientes**
na ficha de cada cliente do Agency OS, respeitando o nível de acesso que
cada cliente liberou à agência.

---

## 2. A resposta curta: qual é a melhor forma

**Leitura ao vivo por uma API da plataforma + botão "Abrir no CRM" +
webhook só para avisos.**

| Caminho | Como seria | Avaliação |
|---|---|---|
| **Só webhook** | O CRM empurra cada evento para o AOS, que guarda uma cópia no Firebase | ❌ O webhook do CRM hoje tem 4 eventos (mensagem recebida, status de mensagem, conversa criada, lead recebido) e faz uma tentativa só. Para "puxar todos os dados" seria preciso **copiar o CRM inteiro para o Firebase** e manter as duas cópias iguais para sempre: carga inicial, edições, exclusões, eventos perdidos. E dado pessoal de cliente duplicado num banco cujas regras só foram fechadas em outubro. |
| **Iframe** (o CRM dentro de uma moldura) | Uma tela do AOS com o CRM embutido | ❌ O login do CRM é por cookie, e os navegadores (o Safari principalmente) bloqueiam cookie dentro de iframe de outro site: o CRM abriria pedindo login, ou quebrado. Dois menus, duas barras, dois temas. E liberar o CRM para ser emoldurado por outro site abre espaço para clickjacking. |
| **Sincronizar de tempos em tempos** | Um cron puxa tudo e grava no Firebase | ❌ Os mesmos problemas da cópia, com atraso. E o backend do AOS **não pode** escrever nos arrays do estado (`S.leads`): é a regra de ouro do §11A do `CLAUDE.md` do AOS. |
| ✅ **Leitura ao vivo + botão + avisos** (recomendado) | O AOS pergunta ao CRM na hora em que alguém abre a tela, por uma Netlify Function, e mostra. O botão leva ao CRM já no lugar certo. Um webhook avisa de lead novo na hora. | ✅ Uma fonte da verdade só (o CRM). Nenhum dado pessoal copiado. Sempre atualizado. Reaproveita quase tudo que o CRM já tem (painel da agência, consentimento, auditoria, API v1). O webhook entra só onde ele é bom: avisar. |

Em uma frase: **o CRM continua dono dos dados; o Agency OS vira uma janela
de leitura com atalhos para dentro dele.**

---

## 3. O que já existe e vamos reaproveitar

### No Harpium CRM

| Peça | Onde | Uso aqui |
|---|---|---|
| API pública v1: chave por CRM, escopos, paginação por cursor, limite por chave | `src/app/api/v1/*`, `src/lib/api/v1/*`, `docs/public-api.md` | O envelope de resposta (`data`/`meta`/`error`), a paginação e os **serializadores** (`serializeDeal`, `serializeContact`, `serializeConversation`, `serializeMessage`, `serializeTask`) |
| Webhooks assinados (HMAC, `X-Wacrm-Signature`) com o evento `lead.received` | `src/lib/webhooks/*`, migration 028 | O aviso de lead novo (Fase 7) |
| Painel da agência: carteira de CRMs, nota de saúde, alertas, uso | `src/lib/agencia/{queries,crms,panel,health,whatsapp,totals}.ts`, `src/app/agencia/page.tsx` | A carteira dos clientes (Fase 6) sai de `listAccountsOverview` + `loadPlatformUsage` + `loadConsentLevels` + `loadWhatsAppStatuses` + `buildPanelRows` |
| Leitores por CRM **com filtro explícito de `account_id`** | `getAccountMetrics`, `getAccountBoard`, `listAccountContacts`, `listAccountConversations`, `getConversationThread` (`src/lib/agencia/queries.ts`); `loadMessageStats` (`src/lib/agencia/totals.ts`) | Base do resumo e das listas |
| Consentimento do dono (Métricas / Leitura / Total) | migrations 049 a 051, `src/lib/agencia/consent.ts` | Quem vê o quê de cada CRM |
| Auditoria dos acessos da agência, visível ao dono | `agencia_auditoria` (038), `logAgenciaAccess`, rótulos em `src/lib/agencia/crm.ts` | Todo acesso pelo AOS fica registrado |
| Trocar o CRM ativo (membro, ou agência com Leitura ou mais), auditado | `set_active_account` (049/050), `POST /api/account/active` | O botão "Abrir no CRM" |
| Links de entrada que já funcionam | `/contacts?contact=<id>`, `/inbox?c=<id>`, `/settings?tab=<aba>`, `/relatorios?period=` | Destinos do botão |
| Origem pública do site | `resolvePublicOrigin` em `src/lib/http/base-url.ts` | Montar os links |

### No Agency OS

| Peça | Onde | Uso aqui |
|---|---|---|
| Porta de autorização das functions | `netlify/functions/_gate.js` (+ `_verify-user.js`) | Só a equipe logada chama a function nova |
| Firebase pelo servidor | `netlify/functions/_fb-admin.js` | Guardar a chave do CRM em `agencyos/secure/**` |
| Chamada autenticada do front | `authedApi(fn, action, extra, ok, err)` | A tela chama a function nova |
| Tela de Integrações | `renderIntegracoes` + `INTG_PROV` | Onde se conecta o Harpium CRM |
| Navegação com subitens | `SUBNAV` + `goSub` (padrão do `CONTENT_VIEW`) | A página CRM ganha três visões |
| Ficha do cliente, aba Visão geral | `tabVisao(c)` | O card "CRM do cliente" |
| Avisos no canto | `ntfVarrer` / `#ntf-pilha` | "Lead novo no Harpium CRM" |
| Proteção contra URL interna | `netlify/functions/_url-guard.js` | Validar a URL do CRM ao conectar |

---

## 4. Como vai ficar para quem usa

### 4.1 AOS → CRM: o menu vira um grupo com três visões

```
CRM ▾
  • Comercial (Harpium CRM)   ← novo, padrão quando conectado
  • CRMs dos clientes         ← novo (Fase 6)
  • Funil interno             ← o renderCRM de hoje, intacto
```

**Comercial (Harpium CRM):** o CRM da agência ("Harpium Digital") visto
por cima.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Comercial · Harpium CRM            [7d] [30d] [90d]    ⟳ há 2 min         │
│ Harpium Digital · saúde 82 ●                     [Abrir no Harpium CRM ↗] │
├─────────────────────────────────────────────────────────────────────────┤
│ Leads 42 (+40%) │ Esperando resposta 4 │ No funil R$ 48 mil (25)          │
│ Ganhos R$ 14 mil (6) │ Conversão 60% │ 1ª resposta 12 min                │
├─────────────────────────────────────────────────────────────────────────┤
│ FUNIL  [Vendas ▾]                                                        │
│ Novo (8) R$ 9k │ Qualificado (5) │ Proposta (4) │ Negociação (2) │ ...   │
│  cards só de leitura; tocar abre o negócio no CRM ↗                      │
├────────────────────────────────┬────────────────────────────────────────┤
│ LEADS RECENTES                 │ ESPERANDO ATENDENTE                      │
│ Ana · quiz-planejados · A ↗    │ João · há 35 min · sem responsável ↗     │
├────────────────────────────────┼────────────────────────────────────────┤
│ TAREFAS ATRASADAS              │ PRÓXIMOS COMPROMISSOS                    │
├────────────────────────────────┴────────────────────────────────────────┤
│ CANAIS  WhatsApp oficial ● · WhatsApp QR ● · Instagram ●                 │
│ CONFIGURAR NO CRM  [Automações ↗] [Agentes ↗] [Canais ↗] [Relatórios ↗]  │
│ VER TUDO  [Leads] [Contatos] [Negócios] [Conversas] [Tarefas] [Agenda]   │
└─────────────────────────────────────────────────────────────────────────┘
```

- "Ver tudo" abre as **listas completas** (Fase 5): tabelas paginadas, com
  busca e filtros, cada linha com "Abrir no CRM ↗".
- Todo "↗" abre o Harpium CRM numa aba nova, já no CRM certo e no item
  certo.

**CRMs dos clientes** (Fase 6): a carteira, como o painel da agência do
CRM. Nome, status, nota de saúde, nível de acesso liberado, último acesso,
usuários ativos, mensagens na semana, ganhos em 30 dias, canais, alertas.
Cada linha leva à ficha do cliente no AOS (se vinculado) e ao CRM.

**Funil interno:** o CRM simples de hoje, sem mudança nenhuma. O fluxo
"Fechou → contrato", o Comercial lendo o WhatsApp e a fila `leadInbox`
continuam funcionando.

### 4.2 Ficha do cliente → Visão geral → card "CRM do cliente"

- Sem vínculo: botão **Vincular ao Harpium CRM** (admin), que lista os CRMs
  e sugere o de nome parecido.
- Com vínculo: status, saúde, nível de acesso, último acesso, usuários
  ativos, alertas, e os botões **Abrir no CRM ↗**, **Ver resumo** (o mesmo
  painel da visão Comercial, para aquele CRM) e **Ver no painel da agência ↗**.
- Se o cliente liberou só **Métricas**: só números agregados e o botão
  **Pedir acesso de leitura ↗** (leva à ficha do CRM no painel da agência,
  onde o pedido já existe).

### 4.3 Integrações → Harpium CRM (admin)

Endereço do CRM + chave da plataforma → **Conectar** (testa na hora) →
escolher **qual CRM é o da agência** → **Ligar avisos de lead novo**
(Fase 7).

### 4.4 Avisos

Lead novo no CRM da agência vira um cartão no canto do AOS ("Lead novo ·
Ana · quiz-planejados ↗") em segundos. Opcional: o mesmo aviso no WhatsApp
de quem cuida do comercial, pelo gerente que já existe no AOS.

---

## 5. Desenho técnico

### 5.1 O caminho de uma consulta

```
AOS (navegador)                       AOS (Netlify)                              CRM (Netlify)
───────────────                       ─────────────                              ─────────────
authedApi('crm-harpium','resumo') ─►  crm-harpium.js
  (manda o ID token do Google)          1. _gate: é da Equipe? está ativo?
                                        2. papel: admin, ou chip CRM
                                           (freela nunca)
                                        3. lê a chave em
                                           agencyos/secure/crmHarpium
                                        4. GET /api/plataforma/v1/crms/{id}/resumo ─►  requirePlatformKey()
                                           Authorization: Bearer hpk_live_…            1. chave existe e não foi revogada?
                                           X-Harpium-Pessoa: <e-mail verificado>       2. o e-mail tem login no CRM?
                                                                                       3. o que ESTA pessoa pode ver
                                                                                          DESTE CRM? (membro, ou
                                                                                          agência × consentimento)
                                                                                       4. consultas com service role,
                                                                                          TODAS filtrando account_id
                                                                                       5. registra em agencia_auditoria
                                                                                          (origem 'agency_os')
  ◄──────────────── JSON (cada item já com o `link` pronto) ◄─────────────────────
```

### 5.2 Quem vê o quê

**Duas travas, uma depois da outra:**

1. **No AOS** (a do sistema interno): estar logado e ativo em Ajustes →
   Equipe & acessos; freela nunca; o comercial da agência exige admin ou o
   chip **CRM**; os CRMs dos clientes exigem admin ou o chip **Clientes**.
2. **No CRM** (a que manda): o CRM recebe o **e-mail da pessoa** (o que o
   Google confirmou no AOS, nunca um e-mail digitado) e aplica **as mesmas
   regras de quando ela entra no CRM**:

| A pessoa, no Harpium CRM, é... | Ela vê pelo AOS |
|---|---|
| membro daquele CRM (dono, admin, atendente, visualizador) | tudo, só leitura |
| da equipe da agência, e o dono liberou **Leitura** ou **Total** | tudo, só leitura |
| da equipe da agência, e o dono liberou só **Métricas** | só números agregados (sem nome, telefone, e-mail ou texto de conversa) |
| nada disso | nada ("seu e-mail não tem acesso a este CRM") |
| sem login no CRM | nada ("seu e-mail não tem login no Harpium CRM; peça um convite") |

Por que pelo e-mail da pessoa, e não só pela chave: (1) o consentimento do
dono continua valendo de verdade; (2) a auditoria registra **quem** leu, e
o dono vê isso em Configurações › Acesso da agência; (3) quem vai clicar em
"Abrir no CRM" precisa mesmo de um login lá.

Detalhe técnico: o CRM resolve "o que essa pessoa pode" com uma função SQL
nova, `platform_effective_role(p_user_id, p_account_id)`, **cópia fiel** de
`effective_role_in` (049) usando o `agency_role_in` da 050 (gestor só tem
Total nos CRMs da carteira dele), trocando `auth.uid()` pelo parâmetro. Um
teste no PGlite garante que as duas dão o mesmo resultado em todas as
combinações. Resultado não nulo → pode ver linhas; nulo e a pessoa é da
agência → só métricas; nulo e não é da agência → sem acesso.

### 5.3 A chave da plataforma

- Formato `hpk_live_` + 40 caracteres: mesmo gerador e mesmo hash SHA-256
  de `src/lib/api-keys/keys.ts`, com outro prefixo. O CRM guarda só o hash
  e mostra a chave uma vez.
- Gerada em **`/agencia/integracoes`** (tela nova, só super_admin).
  Escopos: `crms:read` (carteira, resumo, funil), `dados:read` (as listas
  com dado pessoal), `webhooks:manage` (ligar o aviso de lead). **Nenhum
  escopo de escrita de dados.**
- No AOS fica em `agencyos/secure/crmHarpium/config` =
  `{url, chave, conectadoAt, por, contaAgencia:{id,nome}}`, nó que só o
  servidor lê, como os tokens da Meta em `secure/integrations`. **Não** vai
  em variável de ambiente: o AOS está perto do teto de 4 KB de variáveis
  da Lambda (§4 do `CLAUDE.md` do AOS).
- Revogar = um clique no CRM; o AOS passa a mostrar "reconecte em
  Integrações".
- Limite: 300 consultas por minuto por chave (o mesmo limitador em memória
  da v1, com o balde `plat:<id da chave>`).

### 5.4 O contrato da API (`/api/plataforma/v1`)

Cabeçalhos em toda chamada:

```
Authorization: Bearer hpk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
X-Harpium-Pessoa: pessoa@exemplo.com
```

Envelope igual ao da v1 (`{ data, meta }` / `{ error: { code, reason?, message } }`).

| HTTP | `code` | `reason` | Quando | O AOS mostra |
|---|---|---|---|---|
| 401 | `unauthorized` | | chave ausente, errada ou revogada | "A conexão com o Harpium CRM caiu. Um administrador precisa reconectar em Integrações." |
| 400 | `bad_request` | | sem `X-Harpium-Pessoa`, e-mail inválido, parâmetro ruim | erro genérico + detalhe |
| 403 | `forbidden` | `no_crm_login` | o e-mail não tem login no CRM | "Seu e-mail (x) não tem login no Harpium CRM. Peça um convite ao dono do CRM." |
| 403 | `forbidden` | `no_access` | tem login, mas não tem acesso àquele CRM | "Você não tem acesso a este CRM no Harpium CRM." |
| 403 | `forbidden` | `metrics_only` | pediu lista com dado pessoal e o nível é Métricas | os números + "Pedir acesso de leitura ↗" |
| 403 | `forbidden` | `missing_scope` | a chave não tem o escopo | "A chave não permite isso; gere outra com o escopo X." |
| 404 | `not_found` | | CRM ou item não existe, ou é de outro CRM | "Não encontrado" |
| 429 | `rate_limited` | | passou do limite | "Muitas consultas seguidas; tente em 1 minuto." |
| 5xx | `internal` | | erro no CRM | "O Harpium CRM não respondeu. Mostrando os dados de HH:MM." |

**Endpoints:**

| Método e caminho | Escopo | Nível mínimo | Fase |
|---|---|---|---|
| `GET /eu` | qualquer | | 1 |
| `GET /crms` | `crms:read` | agência vê a carteira toda; membro vê os CRMs dele | 2 |
| `GET /crms/{id}/resumo?dias=7\|30\|90` | `crms:read` | Métricas (as listas vêm `null`) | 2 |
| `GET /crms/{id}/funil?pipeline=` | `crms:read` | Métricas (cards só com Leitura) | 2 |
| `GET /crms/{id}/leads?desde=&origem=&busca=&limit=&cursor=` | `dados:read` | Leitura | 5 |
| `GET /crms/{id}/contatos?busca=&etiqueta=&limit=&cursor=` | `dados:read` | Leitura | 5 |
| `GET /crms/{id}/negocios?pipeline=&etapa=&status=&limit=&cursor=` | `dados:read` | Leitura | 5 |
| `GET /crms/{id}/conversas?status=&esperando=1&limit=&cursor=` | `dados:read` | Leitura | 5 |
| `GET /crms/{id}/conversas/{conversaId}/mensagens?limit=&cursor=` | `dados:read` | Leitura | 5 |
| `GET /crms/{id}/tarefas?situacao=aberta\|atrasada\|feita&limit=&cursor=` | `dados:read` | Leitura | 5 |
| `GET /crms/{id}/agenda?de=AAAA-MM-DD&ate=AAAA-MM-DD` (até 31 dias) | `dados:read` | Leitura | 5 |
| `GET /crms/{id}/novidades?desde=<ISO>` (até 7 dias atrás) | `crms:read` | Métricas (itens sem nome) / Leitura (com nome) | 7 |
| `POST /crms/{id}/aviso-agency-os` | `webhooks:manage` | Leitura **e** pessoa super_admin | 7 |

`GET /eu`, o teste da conexão:

```json
{ "data": {
  "person": { "id": "…", "email": "pessoa@harpium.com.br", "name": "Marcelo", "agencyRole": "super_admin" },
  "key": { "id": "…", "name": "Agency OS", "scopes": ["crms:read", "dados:read", "webhooks:manage"] }
} }
```

`GET /crms`, uma linha por CRM (para a agência, o mesmo `PanelRow` do
painel, serializado):

```json
{ "data": [ {
  "id": "…", "name": "Harpium Digital", "niche": "servicos", "status": "active",
  "access": "full", "memberCount": 4, "contactCount": 1210,
  "health": { "score": 82, "band": "healthy" },
  "usage": { "activeUsers7d": 3, "lastActivityAt": "…", "messages7d": 640, "wonValue30d": 14000 },
  "channels": { "whatsapp": "connected", "instagram": "none" },
  "alerts": [ { "kind": "no_access", "text": "Ninguém entrou há 9 dias" } ],
  "manager": { "email": "…" }, "ownerLabel": "dono@cliente.com",
  "links": { "abrir": "https://<crm>/abrir?crm=…&ir=%2Fdashboard", "painel": "https://<crm>/agencia/…" }
} ] }
```

Os nomes exatos de `usage`, `health` e `alerts` seguem os tipos `CrmUsage`,
`Health` e `CrmAlert` de `src/lib/agencia/health.ts`. Não inventar campos:
serializar o que o painel já calcula.

`GET /crms/{id}/resumo?dias=30`, a visão da operação:

```json
{ "data": {
  "crm": { "id": "…", "name": "Harpium Digital", "status": "active", "access": "full", "currency": "BRL",
           "health": { "score": 82, "band": "healthy" } },
  "window": { "days": 30, "since": "…", "until": "…" },
  "leads": { "total": 42, "previous": 30,
             "byOrigin": [ { "origin": "quiz-planejados", "count": 20 } ],
             "byDay": [ { "day": "2026-11-01", "count": 3 } ] },
  "contacts": { "total": 1210, "new": 80 },
  "conversations": { "open": 15, "pending": 3, "waitingHuman": 4, "unassigned": 6, "new": 70 },
  "messages": { "incoming": 900, "outgoing": 1100 },
  "firstResponse": { "medianMinutes": 12, "samples": 300 },
  "deals": { "openCount": 25, "openValue": 48000, "wonCount": 6, "wonValue": 14000,
             "lostCount": 4, "lostValue": 3000, "conversion": 0.6 },
  "tasks": { "open": 30, "overdue": 5, "dueToday": 3 },
  "agenda": { "today": 2, "next7Days": 9 },
  "automations": { "active": 4, "total": 7 },
  "agents": { "active": 2 },
  "channels": { "whatsapp": "connected", "instagram": "connected" },
  "team": { "members": 4, "activeUsers7d": 3, "lastActivityAt": "…" },
  "alerts": [],
  "lists": {
    "recentLeads":          [ { "id": "…", "name": "Ana", "origin": "quiz-planejados", "campaign": "planejados-nov", "route": "A", "createdAt": "…", "link": "…" } ],
    "waitingConversations": [ { "id": "…", "contactName": "João", "waitingSince": "…", "assignee": null, "link": "…" } ],
    "hotDeals":             [ { "id": "…", "title": "Plano anual", "value": 4800, "stage": "Proposta", "pipeline": "Vendas", "contactName": "Maria", "updatedAt": "…", "link": "…" } ],
    "overdueTasks":         [ { "id": "…", "title": "Ligar", "dueAt": "…", "assignee": "…", "contactName": "…", "link": "…" } ],
    "upcomingEvents":       [ { "id": "…", "title": "Reunião", "startsAt": "…", "calendar": "Comercial", "contactName": "…", "link": "…" } ]
  },
  "links": { "abrir": "…", "relatorios": "…", "automacoes": "…", "agentes": "…", "canais": "…",
             "configuracoes": "…", "leads": "…", "painelAgencia": "…" },
  "generatedAt": "…"
} }
```

- `lists` é `null` quando o nível é Métricas. Cada lista tem no máximo 10
  itens.
- `firstResponse` é `null` se a 048 faltar; `agents` e `automations` são
  `null` se a tabela não existir (a mesma tolerância de
  `detectCapabilities` dos relatórios).

`GET /crms/{id}/funil`: funis com etapas, contagem e valor por etapa; com
Leitura, os 20 negócios mais recentes de cada etapa
(`id, title, value, contactName, updatedAt, link`).

As listas da Fase 5 devolvem os objetos dos **serializadores da v1** (os
mesmos nomes de campo de `docs/public-api.md`) + `link`, paginados por
cursor como a v1 (`limit` até 100, `meta.next_cursor`).

### 5.5 O botão "Abrir no CRM" (rota `/abrir` do CRM)

Todo `link` que a API devolve tem esta forma:

```
https://<crm>/abrir?crm=<accountId>&ir=<caminho codificado>
```

| Item | Caminho (`ir`) | Já funciona? |
|---|---|---|
| Painel do CRM | `/dashboard` | sim |
| Lead | `/leads?lead=<id>` | **não**: a tela de leads precisa abrir o lead pelo parâmetro |
| Contato (e as tarefas dele) | `/contacts?contact=<id>` | sim |
| Negócio | `/pipelines?pipeline=<pid>&deal=<id>` | **não**: a tela do funil precisa abrir o negócio pelo parâmetro |
| Conversa | `/inbox?c=<id>` | sim |
| Compromisso | `/agenda?data=AAAA-MM-DD&evento=<id>` | **não**: a agenda precisa abrir no dia e no evento |
| Configurar | `/automations`, `/agents`, `/flows`, `/broadcasts`, `/canais`, `/settings?tab=<aba>`, `/relatorios`, `/ferramentas` | sim |
| Ficha do CRM no painel da agência | `/agencia/<id>` | sim |

O que `/abrir` faz (route handler GET):

1. **Valida `ir`**: começa com `/`, não com `//`, e está na lista de
   prefixos acima. Fora disso, vai para `/dashboard` (proteção contra
   redirecionamento aberto).
2. **Sem login** → `/login?next=<o próprio /abrir?…>`. Depois do login,
   volta para cá.
3. **Logado** → chama `set_active_account(crm)` com a sessão da pessoa
   (membro, ou agência com Leitura/Total; a função já audita a entrada da
   agência).
   - Deu certo → redireciona para `ir`.
   - Recusou e a pessoa é da agência → `/agencia/<crm>` (lá ela vê os
     números e o botão "Pedir acesso").
   - Recusou e não é da agência → página "Você não tem acesso a este CRM",
     com o e-mail logado e o botão "Sair e entrar com outra conta".
4. Se o CRM pedido **já é o ativo**, não troca nada: só redireciona.

Ajustes de login (hoje o CRM não volta para onde a pessoa queria ir):

- `src/proxy.ts`: no redirecionamento das páginas protegidas para
  `/login`, levar `next=<caminho+busca>`; incluir `/abrir` nas páginas
  protegidas; quem **já está logado** e abre `/login?next=…` vai para
  `next` em vez de `/dashboard`.
- `src/app/(auth)/login/page.tsx`: depois do login, se houver `next`
  seguro, ir para ele. O convite continua com prioridade; a agência sem
  `next` continua indo para `/agencia`.
- Uma função só, `safeNextPath(valor)` em `src/lib/http/next-path.ts`,
  usada pelo proxy, pelo login e pelo `/abrir`. Aceita `/x`; recusa `//x`,
  `https://…`, `/\x`, `javascript:` e caminhos fora da lista.

⚠️ **Efeito colateral que a tela precisa dizer:** o "CRM ativo" é da
**pessoa** (fica em `profiles.account_id`), não da aba. Abrir o CRM de um
cliente pelo AOS troca o CRM que essa pessoa vê em todas as abas do CRM
depois de recarregar. O botão leva a dica "Abre no Harpium CRM e troca o
CRM aberto na sua conta".

**Login sem senha (SSO) fica de fora de propósito.** Daria para o AOS
pedir ao CRM um "link mágico" de login. Só que aí a chave da plataforma
conseguiria **entrar como qualquer pessoa da agência, inclusive os
super_admin**: uma chave vazada viraria dona da plataforma inteira. O
login do CRM dura semanas em cada aparelho, então entrar uma vez custa
pouco. Reavaliar só se incomodar no uso (Decisão 6).

### 5.6 Avisos (Fase 7)

- **Lead novo, na hora:** o CRM já tem o evento `lead.received` assinado
  por HMAC. O AOS pede ao CRM, pela API da plataforma, que registre um
  webhook **no CRM da agência** apontando para a function nova
  `webhook-crm-harpium`. **O endereço não vem no pedido:** o CRM usa o que
  está na variável `AGENCY_OS_WEBHOOK_URL` dele. Assim, quem tivesse a
  chave não conseguiria desviar os leads para outro endereço.
- A function confere a assinatura (`t=…,v1=…`, janela de 5 min), descarta
  repetidos pelo `id` da entrega (`agencyos/secure/crmHarpium/vistos/{id}`,
  podado em 7 dias) e grava o aviso em **`agencyos/crmHarpium/avisos/{pushId}`**
  = `{tipo:'lead', titulo, origem, link, at}`. É uma fila, como o
  `leadInbox`: o backend **nunca** escreve em `S`. O front escuta
  `child_added` e mostra o cartão no canto (`#ntf-pilha`), só para quem
  pode ver o comercial.
- **Negócio ganho ou perdido, conversa esperando:** o webhook do CRM não
  tem esses eventos, e criá-los exigiria gatilho no banco + fila de
  entrega. Em vez disso, **enquanto o AOS estiver aberto**, o front pergunta
  `novidades?desde=` a cada 5 minutos (só com a aba visível, e só para
  quem vê o comercial) e mostra os cartões. Nenhum cron novo e nenhum
  custo quando ninguém está usando.

### 5.7 O que o AOS guarda (quase nada)

| O quê | Onde | Por quê |
|---|---|---|
| URL do CRM, chave, CRM da agência | `agencyos/secure/crmHarpium/config` | segredo: só o servidor lê |
| Segredo do webhook | `agencyos/secure/crmHarpium/webhook` | idem |
| Entregas já vistas | `agencyos/secure/crmHarpium/vistos/{id}` | não repetir aviso |
| Fila de avisos | `agencyos/crmHarpium/avisos/{pushId}` | o front lê; só primeiro nome e origem, sem telefone ou e-mail |
| Vínculo cliente ↔ CRM | `c.crm = {accountId, nome, vinculadoAt, por}` no próprio cliente | mesmo padrão de `c.tele`: nenhuma chave nova em `S`/`DKEYS` |
| E-mail no CRM, se diferente do Google | `m.crmEmail` no membro da Equipe | opcional |
| Visão escolhida (Comercial / Clientes / Interno) | localStorage `aos_crm_visao_<CUR_USER>` | preferência pessoal, como `aos_atalhos_<CUR_USER>` |
| Último resumo carregado | variável de tela `CRMH`, fora de `S` | mostrar na hora e atualizar por trás |

Nenhum lead, contato, conversa ou negócio do CRM é gravado no Firebase.

---

## 6. Fases, detalhe por detalhe

Cada fase fecha com tudo verde e um commit por fase.

- **CRM:** `npm run typecheck && npm run lint && npm test && npm run build`.
- **AOS:** `node tests/<arquivo>.test.js` dos testes novos da fase + os
  que já existem e tocam no que mudou (no mínimo
  `tests/gate-permissao.test.js`).

O CRM publica pelo merge no `main` (PR no GitHub, Netlify). O AOS publica
pelo CLI do Netlify (§7).

### Fase 0: conferências (sem código)

| # | O quê | Quem |
|---|---|---|
| 0.1 | Ler este plano e responder ao §8 (Decisões) | você |
| 0.2 | Confirmar qual CRM é o da agência (hoje "Harpium Digital") e anotar o id (está na URL da ficha em `/agencia`) | Claude, com você |
| 0.3 | Conferir se o e-mail Google de cada pessoa do AOS que vai usar isto é o mesmo do login dela no CRM. Quem não tiver login no CRM: convidar para o CRM da agência (visualizador ou atendente) ou para a equipe da agência | você |
| 0.4 | Conferir o próximo número livre de migration no `main` **e nos PRs abertos**. Hoje seria **075**, mas o plano de Reuniões com IA também mira o 075 e a 073 está no PR #46 | Claude |
| 0.5 | Conferir os créditos do Netlify do CRM (cada deploy de produção custa ~15) e juntar as fases do CRM em poucos merges | Claude, com você |
| 0.6 | Anotar o endereço publicado do AOS (vai em `AGENCY_OS_WEBHOOK_URL`, Fase 7) | você |

### Fase 1: CRM, a porta da plataforma (chave, pessoa, auditoria) · tamanho M

**Migration `0NN_integracao_agency_os.sql`** (idempotente, como as outras):

```sql
-- 1. Chaves da plataforma. Sem policies: só o service role lê e grava
--    (a tela do console lê pelo admin client, como o resto de /agencia).
CREATE TABLE IF NOT EXISTS platform_api_keys (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  key_prefix   TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  scopes       TEXT[] NOT NULL DEFAULT '{}',
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
ALTER TABLE platform_api_keys ENABLE ROW LEVEL SECURITY;

-- 2. E-mail → usuário (para o cabeçalho X-Harpium-Pessoa)
CREATE OR REPLACE FUNCTION public.platform_user_id_by_email(p_email TEXT)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(trim(p_email)) LIMIT 1;
$$;
-- OWNER postgres; REVOKE de PUBLIC, anon e authenticated; GRANT só a service_role.

-- 3. Papel efetivo de UMA pessoa num CRM: cópia fiel de effective_role_in (049)
--    com o agency_role_in da 050, trocando auth.uid() por p_user_id.
CREATE OR REPLACE FUNCTION public.platform_effective_role(p_user_id UUID, p_account_id UUID)
RETURNS account_role_enum ...;   -- mesmas permissões da função 2

-- 4. Auditoria: de onde veio o acesso
ALTER TABLE agencia_auditoria ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'crm'
  CHECK (origem IN ('crm', 'agency_os'));
ALTER TABLE agencia_auditoria ADD COLUMN IF NOT EXISTS detalhe TEXT;
```

Arquivos novos:

| Arquivo | Conteúdo |
|---|---|
| `src/lib/plataforma/keys.ts` | `PLATFORM_KEY_PREFIX = 'hpk_live_'`, `generatePlatformKey()`, `looksLikePlatformKey()`; reaproveita `hashApiKey` e `timingSafeHexEqual` de `src/lib/api-keys/keys.ts` |
| `src/lib/plataforma/scopes.ts` | `PLATFORM_SCOPES = ['crms:read', 'dados:read', 'webhooks:manage']`, `hasPlatformScope()` |
| `src/lib/plataforma/store.ts` | `findActivePlatformKeyByHash()`, `touchPlatformKey()` (sem esperar), `listPlatformKeys()`, `createPlatformKey()`, `revokePlatformKey()` |
| `src/lib/plataforma/auth.ts` | `requirePlatformKey(request, scope?)` → `{ admin, keyId, scopes, person: { userId, email, name, agencyRole } }`. Ordem: chave (401) → limite (429) → escopo (403 `missing_scope`) → e-mail do cabeçalho (400) → `platform_user_id_by_email` (403 `no_crm_login`) → `agencia_membros.role` da pessoa (pode ser nulo) |
| `src/lib/plataforma/access.ts` | `resolveCrmAccess(admin, person, accountId)` → `{ level: 'rows' \| 'metrics', via: 'member' \| 'agency', role }`, ou lança 403 `no_access` / 404. Regra no fim do §5.2 |
| `src/lib/plataforma/audit.ts` | `logPlatformAccess(admin, { person, accountId, action, detalhe })`: grava em `agencia_auditoria` com `origem = 'agency_os'`, **só quando o acesso vem pela agência** (membro lendo o próprio CRM não é auditado, igual ao console) e **no máximo 1 linha por pessoa + CRM + ação a cada 30 min** (consulta a última antes de gravar), para o resumo não lotar o log |
| `src/lib/plataforma/respond.ts` | reexporta `ok`, `okList`, `fail`, `toApiErrorResponse` da v1 e acrescenta o `reason` no erro |
| `src/app/api/plataforma/v1/eu/route.ts` | `GET /eu` |
| `src/app/agencia/integracoes/page.tsx` (+ componente cliente) | Lista de chaves (nome, prefixo, escopos, quem criou, último uso, revogada), **Gerar chave** (nome + escopos; mostra uma vez, com botão copiar), **Revogar**. Só super_admin: `requireAgencia('super_admin')` |
| `src/app/api/agencia/integracoes/route.ts` e `[id]/route.ts` | POST cria, DELETE revoga; só super_admin |

Alterações:

- Link "Integrações" no menu do console da agência (junto de Marca,
  Membros, Modelos, Auditoria).
- Rótulos das ações novas no mapa de `src/lib/agencia/crm.ts` (onde está
  `view_account: 'Abriu a conta'`), com "pelo sistema da agência" quando
  `origem = 'agency_os'`, nas duas telas que leem a auditoria
  (Configurações › Acesso da agência e `/agencia/auditoria`).
- `docs/api-plataforma.md` com o §5.4 deste plano. **Não** entra no
  `docs/public-api.md`: esta API é interna da plataforma.

Testes:

- `src/lib/plataforma/*.test.ts`: chave (gera, reconhece, recusa prefixo
  errado e revogada); auth (cada linha da tabela de erros do §5.4, com o
  `code` e o `reason` certos); access (membro de cada papel → `rows`;
  agência × Métricas/Leitura/Total × super_admin / gestor da carteira /
  gestor de fora / suporte → `rows` ou `metrics`; ninguém → `no_access`);
  audit (só agência; não repete em 30 min).
- `supabase/tests/plataforma.test.ts` (harness PGlite de
  `supabase/tests/harness.ts`): a migration roda duas vezes sem erro;
  `platform_user_id_by_email` ignora maiúsculas; `anon` e `authenticated`
  **não** executam as funções novas; **`platform_effective_role(u, a)` dá o
  mesmo que `effective_role_in(a)` executado como `u`** para toda a matriz
  do §5.2.

Pronto quando: `GET /eu` com uma chave criada na tela devolve a pessoa e os
escopos; com a chave revogada, 401.

### Fase 2: CRM, a leitura da operação (carteira, resumo, funil) · tamanho M

Arquivos novos:

| Arquivo | Conteúdo |
|---|---|
| `src/lib/plataforma/links.ts` | `crmLink(origin, accountId, alvo)` → `/abrir?crm=…&ir=…` para cada tipo do §5.5; `pageLinks(origin, accountId)` para o bloco `links` |
| `src/lib/plataforma/carteira.ts` | `loadCarteira(admin, person, origin)`. Pessoa da agência → o mesmo carregamento de `src/app/agencia/page.tsx` (`listAccountsOverview`, `loadPlatformUsage`, `loadConsentLevels`, `loadWhatsAppStatuses`, `buildPanelRows`), sem arquivados, a não ser com `?status=archived`. Pessoa sem papel na agência → só os CRMs em que é membro (`account_members`), com `{id, name, status, role, links}` |
| `src/lib/plataforma/resumo.ts` | `loadResumo(admin, accountId, dias, { withLists, origin })`, com as consultas da tabela abaixo |
| `src/lib/plataforma/funil.ts` | `loadFunil(admin, accountId, { pipelineId, withDeals, origin })` a partir de `getAccountBoard`: contagem e soma por etapa sempre; cards só com `withDeals`, 20 por etapa |
| `src/app/api/plataforma/v1/crms/route.ts` | `GET /crms` |
| `src/app/api/plataforma/v1/crms/[id]/resumo/route.ts` | `GET /resumo`, com `withLists = level === 'rows'` |
| `src/app/api/plataforma/v1/crms/[id]/funil/route.ts` | `GET /funil` |

As consultas do resumo, **todas** com `.eq('account_id', accountId)` e em
`Promise.all`:

| Bloco | De onde |
|---|---|
| leads (total, janela anterior, por origem, por dia) | tabela `leads`; origem, rota e etiquetas pela mesma regra da tela `/leads` (`normalizeLead` e `leadTags` de `src/lib/leads/parse.ts`) |
| contatos | `contacts`: total e novos na janela, contagem com `head: true` |
| conversas | `conversations`: `status` open/pending, `needs_human_since` não nulo (058), sem responsável (conferir a coluna), novas na janela |
| mensagens | `loadMessageStats(admin, since, { accountId })` de `src/lib/agencia/totals.ts` (função SQL da 056, que já filtra o CRM) |
| 1ª resposta | RPC `report_first_response(p_account_id, p_from, p_to, p_timezone)` (048), com o `account_id` explícito |
| negócios | abertos (contagem e soma); ganhos e perdidos na janela por `closed_at` (046) |
| tarefas | tabela da 060: abertas, atrasadas, vencendo hoje |
| agenda | `calendar_events` (067): hoje e próximos 7 dias, sem cancelados |
| automações e agentes | ativos/total (tabela ausente → `null`) |
| canais | `loadWhatsAppStatuses(admin)` filtrado pelo CRM + a config do Instagram (047) |
| equipe, saúde, alertas | `account_members` + `loadPlatformUsage(admin)` filtrado → `computeHealth` e `computeAlerts` (como em `buildPanelRows`) |
| listas (só com Leitura) | 10 leads recentes, 10 conversas esperando há mais tempo, 10 negócios abertos mais recentes, 10 tarefas atrasadas, 10 próximos compromissos |

⚠️ **Não usar** `loadMetrics` e `loadPipelineDonut` de
`src/lib/dashboard/queries.ts`, nem `loadReportBundle` de
`src/lib/reports/queries.ts`, com o cliente service role. Elas contam com o
RLS para separar os CRMs (o próprio comentário do arquivo diz isso, e
`loadMessagesByDay` lê `messages` sem filtro de CRM). Com service role,
**somariam todos os clientes**. Conferir cada coluna nas migrations antes
de escrever a consulta (060 tarefas, 067 agenda, 058 espera).

Se o resumo passar de ~2 s com dados reais, mover as contagens para uma
função SQL `plataforma_resumo_crm(p_account_id, p_desde)` numa migration
nova (só service role, filtro explícito).

Testes: um por rota, com um cliente admin falso (padrão de
`src/lib/leads/fake-db.test-helper.ts`) que registra os filtros de cada
consulta. Métricas → `lists: null` e **nenhum nome, telefone ou e-mail no
JSON inteiro** (varrer a resposta serializada); Leitura → listas com
`link`; CRM inexistente → 404; nenhuma consulta do resumo sai sem o filtro
de `account_id` (ou sem passar pela conversa, no caso de `messages`).

Pronto quando: um `curl` com a chave + o e-mail de um super_admin devolve
a carteira e o resumo do CRM da agência; com o e-mail de alguém que só tem
Métricas num cliente, o resumo daquele cliente vem sem listas.

### Fase 3: CRM, o botão "Abrir no CRM" · tamanho P

| Arquivo | Mudança |
|---|---|
| `src/lib/http/next-path.ts` (+ teste) | `safeNextPath()` e a lista de prefixos do §5.5 |
| `src/app/abrir/route.ts` (+ teste) | o fluxo do §5.5 |
| `src/app/abrir/sem-acesso/page.tsx` | "Você não tem acesso a este CRM" |
| `src/proxy.ts` (+ `src/proxy.test.ts`) | `next` no redirecionamento para `/login`; `/abrir` protegido; `/login?next=` de quem já está logado vai para `next` |
| `src/app/(auth)/login/page.tsx` | seguir `next` depois do login |
| tela do funil (`src/app/(dashboard)/pipelines/page.tsx` e componentes) | `?pipeline=<id>&deal=<id>`: seleciona o funil e abre o negócio |
| tela de leads (`src/app/(dashboard)/leads/page.tsx`) | `?lead=<id>`: rola até o lead e abre o detalhe (ou destaca a linha, se não houver detalhe) |
| agenda (`src/app/(dashboard)/agenda/page.tsx`) | `?data=AAAA-MM-DD&evento=<id>`: abre a semana do dia e o evento |

Ler antes, por causa do Next 16 (`AGENTS.md`): `node_modules/next/dist/docs/`
nas partes de Route Handlers, `redirect`, `useSearchParams` e `proxy.ts`
(o antigo middleware).

Testes: `next` com `//evil.com`, `https://evil.com`, `/\evil` e
`javascript:` cai no padrão; sem login → `/login?next=…`; membro → troca o
CRM e redireciona; agência com Métricas → `/agencia/<id>`; CRM já ativo →
não chama a troca.

Pronto quando: um link `…/abrir?crm=<id>&ir=%2Fpipelines%3Fdeal%3D…`,
aberto numa janela anônima, pede login e depois abre o negócio no CRM
certo.

**Publicar o CRM (fim da Fase 3):** aplicar a migration da Fase 1 em
produção (o procedimento de sempre: SQL editor, cópia em UTF-8, conferência
do hash) → conferir por REST que os objetos existem → merge → conferir que
o deploy do Netlify publicou → gerar a chave "Agency OS" em
`/agencia/integracoes`. Pedir o OK antes de cada passo de produção.

### Fase 4: AOS, conexão + visão Comercial · tamanho G

**Antes de mexer no `agency-os.html`:** carregar a skill `ui-harpium`
(tokens, componentes, modo escuro, celular) e seguir o protocolo do §0 do
`CLAUDE.md` do AOS: nunca ler o arquivo inteiro; achar a função com
`grep -n "function <nome>"`; ES5 (`var`, `function`, sem arrow, `const` ou
`let`); expor no `return {…}` do `APP` o que o HTML chama.

**Backend: `netlify/functions/crm-harpium.js`** (zero dependências, o mesmo
padrão das outras functions):

```
POST /.netlify/functions/crm-harpium      body: { idToken, action, ...params }
```

| `action` | Quem | Faz |
|---|---|---|
| `status` | equipe | `{conectado, url, contaAgencia, eu}`; o `eu` vem de `GET /eu` com o e-mail de quem pediu (a tela mostra se a pessoa tem login no CRM) |
| `conectar` | admin | `{url, chave}` → URL `https://` e não interna (`_url-guard.js`) → testa `GET /eu` → grava `secure/crmHarpium/config` |
| `contaAgencia` | admin | `{accountId}`, escolhido da lista de `/crms` → grava em `config.contaAgencia` |
| `desconectar` | admin | apaga `config` e lembra de revogar a chave no CRM |
| `crms` | admin ou chip Clientes | repassa `GET /crms` |
| `resumo` | ver a regra abaixo | `{accountId?, dias}`; sem `accountId` = o CRM da agência |
| `funil` | ver a regra abaixo | `{accountId?, pipeline?}` |
| `lista`, `mensagens` | ver a regra abaixo | Fase 5 |
| `novidades` | ver a regra abaixo | Fase 7 |
| `ligarAvisos` | admin | Fase 7 |

- **Quem pode, na function (não só na tela):** o `_gate` aceitou; papel
  `freela` → recusa; CRM da agência → `admin` ou `perms.crm`; outro CRM →
  `admin` ou `perms.clients`. Para isso, acrescentar ao `_gate.js` uma
  função `quem(p)` que devolve `{motivo, email, membro}`, e fazer o
  `porQueNaoPode` usá-la por dentro **sem mudar o que ele devolve**.
  Atualizar `tests/gate-permissao.test.js`.
- **O e-mail de `X-Harpium-Pessoa`** é `membro.crmEmail || o e-mail do
  token verificado`. **Nunca** um e-mail que veio no corpo do pedido.
- **Só repassa caminhos e parâmetros de uma lista fechada.** A function
  monta a URL; o front não manda caminho.
- Tempo máximo de 8 s por chamada ao CRM (`AbortController`): a function
  do Netlify morre em ~10 s.
- Cache em memória da function: 45 s para `crms`, `resumo` e `funil`, com
  chave = e-mail + ação + parâmetros (cada pessoa vê o que pode).
- Traduz os erros do §5.4 para as frases em português da tabela.
- Confere que todo `link` devolvido começa com a `url` configurada antes de
  repassar.

**Front: `agency-os.html`**

| Onde | Mudança |
|---|---|
| `INTG_PROV` + `renderIntegracoes` | provedor novo `crmharpium` ("Harpium CRM: o CRM completo visto daqui"), com detalhe próprio: URL (padrão `https://harpium-crm.netlify.app`), chave (campo de senha), **Conectar**, status ("Conectado · testado há 2 min"), escolha do CRM da agência (lista de `crms`), **Desconectar** |
| `SUBNAV` | `crm: [['harpium','Comercial (Harpium CRM)', …], ['carteira','CRMs dos clientes', …], ['interno','Funil interno','funnel']]` com uma variável `CRM_VIEW` (padrão do `CONTENT_VIEW`); `carteira` só aparece a partir da Fase 6 |
| `renderCRM` | decide a visão no topo: `interno` → o código de hoje, **sem mudança**; `harpium` → `renderCrmHarpium()`; sem conexão → card "Conecte o Harpium CRM em Integrações" (admin) ou "Peça a um administrador" (membro), mais a visão interna |
| `renderCrmHarpium(accountId)` (nova) | o painel do §4.1: período 7/30/90, KPIs com `kpi()`, funil só leitura (classes `.kan-board .crm-board`, **sem** `bindCrmDrag`), as 4 listas, canais, atalhos "Configurar no CRM" e "Ver tudo" (Fase 5). Estados: carregando, erro (com o último resumo e a hora), só Métricas, sem login no CRM |
| `crmhAbrir(link)` (nova) | `window.open(link, '_blank', 'noopener')` depois de conferir o prefixo |
| `return {…}` do `APP` | expor os handlers novos |

- **Tudo que vem do CRM passa por `esc()`.** Nome de lead vem de formulário
  público; testar com `<img src=x onerror=alert(1)>`.
- Valores com `fR()` (não `fRp()`, que é do financeiro).
- Cache de tela `CRMH = {resumo:{}, funil:{}, at:{}}`, fora de `S`: ao
  abrir mostra o que tem e atualiza por trás, com "atualizado há X min" e o
  botão ⟳.
- Celular: o CRM não está no conjunto do modo celular; basta a tela não
  quebrar na largura do iPhone.

Testes:

- `tests/crm-harpium-function.test.js` (Node puro, injetando
  `_verify-user` e `_fb-admin` no `require.cache` e trocando o `fetch`):
  sem token → 403; freela → 403; membro sem o chip → 403; o e-mail mandado
  ao CRM é o do token, mesmo com um `email` no corpo; `crmEmail` vale; chave
  errada ao conectar → mensagem; tempo esgotado → mensagem; parâmetro fora
  da lista não passa; link de outro domínio é descartado.
- `tests/crm-harpium-tela.test.js` (jsdom): com `authedApi` simulado, a
  visão Comercial mostra os KPIs; o nome malicioso aparece escapado;
  Métricas mostra o aviso e nenhuma lista; a visão interna continua igual
  (arrastar o card ainda move o lead).

Pronto quando: um admin conecta, escolhe "Harpium Digital", abre CRM →
Comercial e vê os números batendo com o painel do CRM; o botão abre o
negócio certo no CRM.

### Fase 5: as listas completas ("puxar todos os dados") · tamanho G · CRM e AOS

**CRM:** rotas novas em `src/app/api/plataforma/v1/crms/[id]/…`. Todas com
`requirePlatformKey(request, 'dados:read')`, `resolveCrmAccess` exigindo
`rows`, `logPlatformAccess` (uma linha por chamada, não por item),
`.eq('account_id', id)` em toda consulta e a paginação da v1
(`parseListParams`, `keysetFilter`, `buildPage`).

| Rota | Serializa com | Filtros |
|---|---|---|
| `leads` | objeto próprio: `id, origin, route, tags, campaign, formName, name, email, phone, contactId, createdAt, link` (origem, rota e etiquetas por `normalizeLead`/`leadTags`) | `desde`, `origem`, `busca` (nome, e-mail, telefone; mesma limpeza do `sanitizeOrTerm` de `src/lib/agencia/queries.ts`, exportando a função) |
| `contatos` | `serializeContact` + `link` | `busca`, `etiqueta` |
| `negocios` | `serializeDeal` + `link` | `pipeline`, `etapa`, `status` |
| `conversas` | `serializeConversation` + `waitingSince` + `link` | `status`, `esperando=1` |
| `conversas/{cid}/mensagens` | `serializeMessage`; confere que a conversa é do CRM (senão 404); auditoria `view_conversation` | |
| `tarefas` | `serializeTask` + `link` (para o contato) | `situacao` |
| `agenda` | `id, title, startsAt, endsAt, status, calendar, contactName, link` | `de`, `ate` (até 31 dias) |

**AOS:** na visão Comercial, "Ver tudo" abre a lista escolhida numa sheet
larga (o padrão `sheet-xl` da central do briefing): tabela com busca,
filtros, "Carregar mais" pelo cursor e "Abrir no CRM ↗" em cada linha. Uma
conversa abre a thread só de leitura, com os balões no estilo do Inbox
interno (`inboxThreadView`). A function ganha `lista`
(`{recurso, filtros, cursor}`, com recurso e filtros de lista fechada) e
`mensagens`.

Testes: no CRM, cada rota recusa Métricas, filtra o CRM, pagina e audita;
no AOS, a tabela pagina, escapa e trata erro.

Pronto quando: dá para achar qualquer lead, contato, negócio ou conversa do
CRM da agência pelo AOS e abrir no CRM com um toque.

### Fase 6: os CRMs dos clientes no AOS · tamanho M · AOS (CRM só se faltar algo)

| Onde (AOS) | Mudança |
|---|---|
| Ficha do cliente → `tabVisao(c)` | o card "CRM do cliente" do §4.2 |
| sheet "Vincular ao Harpium CRM" | lista de `crms` por nome, com sugestão (nome normalizado igual, ou e-mail do dono igual a `c.email`); grava `c.crm = {accountId, nome, vinculadoAt, por}` com `save()`; **Desvincular** (admin) |
| "Ver resumo" | o mesmo `renderCrmHarpium(accountId)` dentro de uma sheet |
| `SUBNAV.crm` → `carteira` | a tabela da carteira (como o painel da agência), com filtros de status, risco e sem acesso; cada linha → a ficha do cliente vinculado (ou "Vincular a um cliente") e "Abrir no CRM ↗"; só admin ou chip Clientes |
| lista de Clientes (opcional) | bolinha de saúde ao lado do nome de quem tem CRM vinculado |

Testes (jsdom): vincular grava `c.crm` e sobrevive a recarregar; cliente em
Métricas não mostra nenhum dado pessoal; desvincular; a carteira esconde
os arquivados.

Pronto quando: a ficha de um cliente vinculado mostra a saúde do CRM dele,
e o botão abre o CRM certo (ou o painel da agência, se o nível não deixar
entrar).

### Fase 7: avisos · tamanho M · CRM e AOS

**CRM:**

- Variável `AGENCY_OS_WEBHOOK_URL` no Netlify do CRM (o endereço da
  `webhook-crm-harpium` do AOS).
- `POST /api/plataforma/v1/crms/{id}/aviso-agency-os` (escopo
  `webhooks:manage`, nível `rows`, pessoa super_admin): cria ou reativa,
  **naquele CRM**, um `webhook_endpoints` para `lead.received` com a URL da
  variável (o pedido não traz URL), pela mesma lógica de
  `POST /api/v1/webhooks` (`src/lib/webhooks/endpoints.ts`). Devolve o
  `secret` uma vez. Chamar de novo gira o segredo.
- `GET /crms/{id}/novidades?desde=`: leads novos (`created_at`), negócios
  ganhos e perdidos (`closed_at`), conversas que passaram a esperar
  (`needs_human_since`); no máximo 50, com `until` para a próxima chamada.
  Com Métricas: só tipo e contagem, sem nome.

**AOS:**

- `netlify/functions/webhook-crm-harpium.js`: lê o corpo cru; confere
  `X-Wacrm-Signature` (HMAC-SHA256 de `"${t}.${corpo}"`, comparação em
  tempo constante, recusa `t` com mais de 5 min); deduplica em
  `secure/crmHarpium/vistos/{id}`; grava `agencyos/crmHarpium/avisos/{pushId}`
  = `{tipo:'lead', titulo:'Lead novo · ' + primeiro nome, origem, link, at}`,
  sem telefone e sem e-mail; apaga os avisos com mais de 7 dias ao gravar.
- Regras do Firebase (`docs/database.rules.json` do AOS):
  `crmHarpium/avisos` legível pela equipe logada e gravável só pelo
  servidor. **Colar a regra nova no console do Firebase** faz parte da
  publicação.
- Front: escutar `agencyos/crmHarpium/avisos` (`child_added`, depois do
  login, como o `startLeadInbox`) e mostrar o cartão do canto, só para quem
  vê o comercial; "visto" por pessoa no localStorage.
- Front: com a visão Comercial disponível para a pessoa, a cada 5 min (só
  com `document.visibilityState === 'visible'`) chamar `novidades` e
  mostrar "Negócio ganho · Plano anual · R$ 4.800 ↗" e "Conversa esperando
  há 30 min ↗".
- Integrações → Harpium CRM: botão **Ligar avisos de lead novo** →
  `ligarAvisos` → grava o segredo em `secure/crmHarpium/webhook`.
- Opcional (Decisão 5): mandar o aviso de lead também pelo WhatsApp de
  quem cuida do comercial (`notify-send` / `_notify-channel`).

Testes: assinatura válida, inválida e velha; entrega repetida não duplica;
o aviso não leva telefone nem e-mail; o CRM não aceita URL no pedido.

### Fase 8 (opcional): o Harpi do AOS consultando o CRM · tamanho P · AOS

Duas ferramentas só de leitura no Harpi do AOS (`HARPI_FERR` +
`_harpi-prompt.js` + `harpi.js`/`harpi-stream.mjs`): `crm_resumo({dias,
cliente?})` e `crm_buscar({recurso, busca})`, chamando a API da plataforma
**com o e-mail de quem pergunta**. Assim "quantos leads entraram essa
semana no CRM?" funciona também no AOS. Seguir o `docs/plano-harpi.md` do
AOS para registrar ferramenta.

### Fase 9 (decisão futura): aposentar o funil interno · tamanho G · AOS e CRM

Só depois de usar as Fases 4 a 7 por algumas semanas. Seria preciso:

- Os webhooks de Meta e Google Lead Forms do AOS passarem a mandar para o
  recebimento universal do CRM (`/api/leads/ingest/<token>`), em vez da
  fila `leadInbox`.
- Importar os leads abertos de `S.leads` (`crmOwner` nulo) para o CRM da
  agência (CSV pela tela do CRM, ou a API v1 com `contacts:write` e
  `deals:write`).
- **"Ganhou no CRM → contrato no AOS":** quando `novidades` trouxer um
  negócio ganho, o cartão oferece "Gerar contrato", que abre o gerador
  (`ctNovo`) já preenchido com nome, contato e valor vindos do CRM. Mantém o
  fluxo comercial de hoje (`leadWinFlow`) sem depender do funil interno.
- O Comercial (o agente que lê o WhatsApp e grava `l.zap`) e a Assistente
  de Agenda leem `S.leads` hoje; passariam a ler da API.

---

## 7. Ordem de entrega e publicação

```
CRM:      Fase 1 ─► Fase 2 ─► Fase 3 ──(migration em produção + merge + chave)──┐
                                                                                 ▼
AOS:                                                  Fase 4 ─► (deploy + conectar)
CRM+AOS:                                              Fase 5 ─► Fase 6 ─► Fase 7 ─► [8] ─► [9]
```

- **CRM:** um PR com as Fases 1 a 3 (uma migration, um deploy). Antes do
  merge, aplicar a migration em produção e conferir por REST que os objetos
  novos existem (código que sai antes da migration quebra o CRM). Depois do
  merge, conferir no Netlify que o deploy publicou (os créditos já
  acabaram uma vez).
- **AOS:** publicar como manda o §4 do `CLAUDE.md` dele (deploy de uma
  cópia limpa do commit com `--skip-functions-cache`; o CLI andou falhando
  com erro 422, e o caminho alternativo é `docs/deploy-pela-api.cjs`).
  Conferir no ar: a `crm-harpium` recusa sem login; `/netlify/*` e
  `/docs/*` seguem em 404.
- As Fases 5 e 7 tocam os dois: **CRM primeiro**, AOS depois. O AOS trata
  "rota ainda não existe" (404 na rota) como "atualize o CRM".
- **Nada vai para produção sem o seu OK explícito:** migration, merge,
  deploy do AOS e regra do Firebase. Dá para pedir tudo de uma vez ("posso
  pôr no ar?").

---

## 8. Decisões que precisam ser suas

Cada uma com a recomendação marcada.

**Decididas em 20/11/2026: todas seguem a recomendação** ("Aprovo
assim"). Valem, portanto: CRM da agência primeiro e clientes na Fase 6;
admin + chip CRM com login no CRM; quem não tem login é convidado como
membro do CRM da agência; funil interno fica intacto; aviso de lead por
cartão no canto; sem SSO; só leitura; URL do CRM na configuração do AOS.

1. **Por onde começar:** o CRM da agência primeiro (Fases 1 a 5) e os CRMs
   dos clientes depois (Fase 6) (**recomendado**: entrega valor mais cedo,
   e a Fase 6 reaproveita tudo) · os dois juntos · só os clientes.
2. **Quem do AOS vê o comercial do Harpium CRM:** admin + quem tem o chip
   CRM, desde que tenha login no CRM (**recomendado**: as duas travas do
   §5.2) · só admin.
3. **Quem não tem login no CRM:** convidar como membro do CRM da agência,
   como visualizador ou atendente (**recomendado**: vai precisar do login
   para o "Abrir no CRM" de qualquer jeito) · deixar a chave ler sem pessoa
   (não recomendado: perde a auditoria e o consentimento).
4. **O funil interno do AOS:** fica como terceira visão, intacto, e a Fase
   9 se decide depois (**recomendado**) · esconder já.
5. **Aviso de lead novo:** cartão no canto do AOS (**recomendado**) ·
   cartão + WhatsApp de quem cuida do comercial · nenhum (o CRM já avisa lá
   dentro).
6. **Login sem senha entre os dois (SSO):** não fazer agora
   (**recomendado**, pelo risco explicado no §5.5) · fazer com link mágico e
   travas extras.
7. **Só leitura:** sim, configurar e operar é no CRM (**recomendado**, é o
   que você pediu) · permitir mover negócio e criar tarefa pelo AOS (exige
   escopos e auditoria de escrita).
8. **Endereço do CRM:** a URL fica na configuração do AOS; quando o CRM
   mudar para `crm.harpium.com.br`, basta trocar lá. Este item entra no
   checklist da troca de domínio.

---

## 9. Riscos e cuidados

| Risco | Cuidado |
|---|---|
| **Vazamento entre clientes** pelo service role | Toda consulta da API da plataforma filtra `account_id`. Proibido reaproveitar `src/lib/dashboard/queries.ts` e `loadReportBundle` (dependem do RLS). `messages` não tem `account_id`: sempre pela conversa ou pela função da 056. Teste que confere os filtros. |
| **Dado pessoal no nível Métricas** | Listas `null`; varredura do JSON nos testes; `novidades` sem nome. |
| **Chave vazada** | Só leitura; só no `secure/` do Firebase; revogação em um clique; tudo auditado; limite por minuto; o webhook só vai para o endereço fixo do CRM; sem SSO. |
| **E-mail forjado** | A function do AOS usa só o e-mail do token Google verificado (ou o `crmEmail` que o admin gravou na Equipe). Teste específico. |
| **Redirecionamento aberto** no `/abrir` e no `next` | `safeNextPath` com lista de prefixos, num lugar só, com teste. |
| **CRM ativo é da pessoa, não da aba** | Dica no botão; o CRM já mostra a faixa do modo suporte quando a agência entra no CRM de um cliente. |
| **XSS** com nome de lead | `esc()` em tudo no AOS; teste com HTML malicioso. |
| **Netlify** (CRM: créditos; AOS: ~10 s por function) | Juntar merges; resumo rápido (consultas em paralelo, contagens com `head: true`); cache de 45 s; timeout de 8 s. |
| **Variáveis do AOS** (teto de 4 KB) | Chave no `secure/` do Firebase; nenhuma variável nova no AOS. |
| **Número de migration** | Conferir o livre na hora (Reuniões com IA também quer o 075). |
| **Auditoria lotada** pelo resumo | No máximo 1 linha por pessoa + CRM + ação a cada 30 min. |
| **`_gate.js` é usado pelo AOS inteiro** | `quem(p)` novo sem mudar o retorno de `porQueNaoPode`; `require` no topo; `tests/gate-permissao.test.js`. |
| **Regras do Firebase** | A regra de `crmHarpium/avisos` precisa ser colada no console (fica em `docs/database.rules.json` do AOS). |

---

## 10. Para quem for executar (outra sessão, outro modelo)

1. Ler este arquivo inteiro e o §8 já respondido.
2. **CRM:** ler o `AGENTS.md` (o Next 16 tem mudanças; documentação em
   `node_modules/next/dist/docs/`). Trabalhar num worktree a partir do
   `main` atualizado: a pasta principal está num ramo antigo
   (`feat/leads-universal`). Conferir o número da migration (Fase 0.4).
3. **AOS:** ler o §0 do `CLAUDE.md` dele (é um índice; não ler o
   `agency-os.html` inteiro), carregar a skill `ui-harpium` antes de mexer
   em qualquer tela, manter ES5 e português. Atualizar o `CLAUDE.md` do AOS
   (§7A, §8 e §11) na mesma leva, como ele pede.
4. Um commit por fase. Rodar os testes dos dois repositórios no fim de
   cada fase.
5. Pedir OK antes de: aplicar migration em produção, fazer merge, publicar
   o AOS, colar regra no Firebase.
6. Ao fechar cada fase, acrescentar uma linha em "Andamento", no topo deste
   arquivo.

---

## 11. Tamanho

| Fase | Repositório | Tamanho |
|---|---|---|
| 1. Porta da plataforma | CRM | M |
| 2. Leitura da operação | CRM | M |
| 3. Abrir no CRM | CRM | P |
| 4. Conexão + visão Comercial | AOS | G |
| 5. Listas completas | CRM + AOS | G |
| 6. CRMs dos clientes | AOS | M |
| 7. Avisos | CRM + AOS | M |
| 8. Harpi (opcional) | AOS | P |
| 9. Aposentar o funil interno (decisão) | AOS + CRM | G |

O mínimo que já resolve o pedido são as **Fases 1 a 4**: o painel do
comercial dentro do AOS, com o botão que leva ao CRM. Com a 5 vêm "todos os
dados"; com a 6, os clientes; com a 7, os avisos.

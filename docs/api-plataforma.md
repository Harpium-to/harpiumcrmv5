# API da plataforma (`/api/plataforma/v1`)

A API que o sistema interno da agência (Agency OS) usa para **ler** os
CRMs. É interna da plataforma: não confundir com a API pública
(`docs/public-api.md`), cuja chave vale para um CRM só. Plano completo:
`docs/plano-integracao-agency-os.md`.

## Autenticação

```
Authorization: Bearer hpk_live_…            a chave da plataforma
X-Harpium-Pessoa: pessoa@exemplo.com         quem está olhando
```

- A chave é gerada em **/agencia/integracoes** (só super admin), aparece
  uma vez e só o hash fica guardado. Revogar vale na próxima chamada.
- O e-mail é o da pessoa que o Agency OS confirmou pelo login Google, e
  **só a equipe da agência** (`/agencia/membros`) passa. Assim, quem tem
  a chave não consegue se passar pelo dono do CRM de um cliente: o
  máximo é agir como alguém da agência, e cada CRM continua valendo no
  nível que o dono liberou (Leitura/Total: tudo, só leitura; Métricas:
  só números). Se a pessoa também for membro de um CRM, vale o papel
  dela ali.
- Leituras da agência ficam em `agencia_auditoria` com
  `origem = 'agency_os'` (o resumo, o funil e as novidades no máximo uma
  vez a cada 30 min por pessoa e CRM).
- Limite: 300 chamadas por minuto por chave.

| Escopo | Permite |
|---|---|
| `crms:read` | carteira, resumo, funil, novidades |
| `dados:read` | listas com dado pessoal |
| `webhooks:manage` | ligar o aviso de lead novo |

## Respostas

Mesmo envelope da v1: `{ data }`, `{ data: [...], meta: { next_cursor } }`
ou `{ error: { code, reason?, message } }`.

| HTTP | `code` | `reason` | Quando |
|---|---|---|---|
| 401 | `unauthorized` | | chave ausente, errada ou revogada |
| 400 | `bad_request` | | sem `X-Harpium-Pessoa` ou parâmetro inválido |
| 403 | `forbidden` | `missing_scope` | a chave não tem o escopo |
| 403 | `forbidden` | `no_crm_login` | o e-mail não tem login no CRM |
| 403 | `forbidden` | `not_agency` | o e-mail não é da equipe da agência (/agencia/membros) |
| 403 | `forbidden` | `no_access` | sem acesso àquele CRM |
| 403 | `forbidden` | `metrics_only` | lista pedida, mas o dono liberou só Métricas |
| 404 | `not_found` | | CRM ou item inexistente (ou de outro CRM) |
| 429 | `rate_limited` | | limite por minuto |
| 503 | `unavailable` | | falta a migration 075, ou `AGENCY_OS_WEBHOOK_URL` |

## Rotas

Todo item traz `link`: `https://<crm>/abrir?crm=<id>&ir=<caminho>`, que
troca o CRM ativo da pessoa e abre o item (lead, contato, negócio,
conversa, compromisso ou tela).

| Rota | Escopo | Nível |
|---|---|---|
| `GET /eu` | qualquer | |
| `GET /crms[?status=archived]` | `crms:read` | todos os CRMs (agregados) |
| `GET /crms/{id}/resumo?dias=7\|30\|90` | `crms:read` | Métricas (`lists: null`) |
| `GET /crms/{id}/funil[?pipeline=]` | `crms:read` | Métricas (`deals: null` por etapa) |
| `GET /crms/{id}/leads?desde=&origem=&busca=&limit=&cursor=` | `dados:read` | Leitura |
| `GET /crms/{id}/contatos?busca=&etiqueta=&limit=&cursor=` | `dados:read` | Leitura |
| `GET /crms/{id}/negocios?pipeline=&etapa=&status=&limit=&cursor=` | `dados:read` | Leitura |
| `GET /crms/{id}/conversas?status=&esperando=1&limit=&cursor=` | `dados:read` | Leitura |
| `GET /crms/{id}/conversas/{conversaId}/mensagens?limit=&cursor=` | `dados:read` | Leitura |
| `GET /crms/{id}/tarefas?situacao=aberta\|atrasada\|feita` | `dados:read` | Leitura |
| `GET /crms/{id}/agenda?de=&ate=` (até 31 dias) | `dados:read` | Leitura |
| `GET /crms/{id}/novidades?desde=<ISO>` (até 7 dias) | `crms:read` | Métricas (sem nomes) |
| `POST /crms/{id}/aviso-agency-os` | `webhooks:manage` | Leitura + super admin |

Contatos, negócios, conversas, mensagens e tarefas usam os mesmos objetos
da v1. O formato do resumo está em `src/lib/plataforma/resumo.ts`
(`CrmSummary`), o do funil em `funil.ts`, o das novidades em
`novidades.ts`.

O resumo traz `teams`, um item por setor do CRM (migrations 077/078):
`{ name, members, queued, waiting, overdue }`. São só contagens:
- `queued`: na fila do setor, sem ninguém;
- `waiting`: esperando uma pessoa;
- `overdue`: passou do prazo do setor.

A lista vem vazia quando o CRM não tem setores. `alerts` ganha três tipos:
- `overdue`: conversas que passaram do prazo do setor;
- `team_queue`: 5 ou mais conversas na fila dos setores sem ninguém;
- `radar`: o alerta mais grave do Radar do cliente na semana (079/080),
  por exemplo "Radar: Leads do Instagram caíram 60% (+1)".

## Aviso de lead novo

`POST /crms/{id}/aviso-agency-os` cria (ou reativa, com segredo novo) um
webhook `lead.received` **naquele CRM**, para o endereço da variável
`AGENCY_OS_WEBHOOK_URL` do servidor do CRM. O pedido não escolhe a URL.
O segredo volta uma vez; as entregas são assinadas como as da v1
(`X-Wacrm-Signature: t=…,v1=…`).

## Cuidados para quem mexer aqui

- Tudo roda com **service role**: cada consulta filtra `account_id`. Não
  reaproveite `src/lib/dashboard/queries.ts` nem `loadReportBundle`, que
  dependem do RLS e somariam todos os clientes. `messages` não tem
  `account_id`: passe pela conversa ou por `agencia_message_stats`.
- Os testes `src/lib/plataforma/leitura.test.ts` gravam os filtros de
  cada consulta e reprovam a que não nomear o CRM, e varrem o JSON do
  nível Métricas atrás de nome, telefone e e-mail.

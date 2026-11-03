# Continuação — estado e próximos passos

Para quem assume o trabalho daqui. Escrito em novembro de 2026, depois
dos commits `a2b3c3d` e `7fc745c` na branch `feat/agencia-supervisao-ptbr`.

---

## 0. O passo bloqueante: aplicar as migrations

**Nada do que foi construído funciona até isso acontecer.** Quatro
migrations estão no repo e não foram aplicadas:

| Migration | O que entrega | Sem ela |
|---|---|---|
| `044_agent_team.sql` | agentes e histórico de execução | `/agents` mostra estado vazio; auto-resposta cai no assistente único antigo |
| `045_agent_operation.sql` | cargo, autonomia, fila, aprovações, memória, qualificação de lead | a operação de agentes inteira some |
| `046_deal_close_timestamp.sql` | data real de fechamento de negócio | relatórios usam `updated_at` e se marcam como aproximados |
| `047_instagram_channel.sql` | canal Instagram, `conversations.channel` | Instagram não aparece; inbox inalterado |

Elas são idempotentes e foram escritas para rodar em ordem. Cada
superfície degrada sozinha enquanto isso — nada quebra, só não existe.

Aplicar: pelo SQL editor do Supabase, ou `supabase db push` se o
projeto estiver linkado.

**Depois de aplicar, confira nesta ordem:** `/agents` lista agentes →
criar um pela biblioteca → `/relatorios` para de mostrar o aviso de
aproximação → `/canais/instagram` aceita credenciais.

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
  tem o seletor Frio / Morno / Quente. Mudar etapa é outra coisa: é um
  `deal`, e não existe `/api/v1/deals` ainda.

### 2.5 Relatórios: tempo de primeira resposta

Ficou de fora porque exige varredura pareada de mensagens e ficaria
caro numa janela de 90 dias. O dashboard já tem uma versão em
`loadResponseTime` (`src/lib/dashboard/queries.ts`), limitada a duas
semanas. Se for fazer, faça em SQL (uma RPC com `LATERAL`), não em
TypeScript.

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

### 3.3 Avatares órfãos no storage

Trocar a foto de um agente (ou de um perfil) sobe um arquivo novo e
deixa o antigo no bucket. Comportamento já existente em
`profile-form.tsx`; o avatar de agente seguiu o mesmo padrão.

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

---

## 5. Como verificar

```bash
npx tsc --noEmit                 # precisa sair limpo
npx eslint .                     # 0 erros (43 warnings pré-existentes)
npx vitest run                   # 882 passando
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

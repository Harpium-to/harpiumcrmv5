# Plataforma Harpium — CRMs por cliente e Visão da Agência

Documento de planejamento. Escrito em 04/11/2026 sobre a branch
`feat/agencia-supervisao-ptbr`.

**Andamento:** Fase 1 implementada em 04/11/2026 (migration
`049_plataforma_acesso.sql`, ainda **não aplicada** no Supabase). As
demais fases não começaram. Detalhes do que a 049 muda em
`HANDOFF.md` §1A.

---

## 1. Prompt refinado

> O Harpium CRM não é um CRM de uso próprio: é uma **plataforma** que a
> Harpium (agência) entrega aos seus clientes. Cada cliente recebe o
> **seu próprio CRM**, isolado dos demais. A Harpium administra a
> plataforma por cima.
>
> **Dois níveis de acesso, bem separados:**
>
> 1. **Plataforma (agência)** — só a equipe da Harpium. Ao entrar, cai
>    no **Painel da Plataforma**: quais CRMs existem, quais estão
>    ativos, quem usa mais e quem usa menos, quem está em risco de
>    abandonar, quem precisa de ajuda. Daqui a agência cria CRMs novos,
>    convida o dono, aplica modelos por nicho, suspende ou arquiva.
> 2. **CRM (cliente)** — dono, administradores, atendentes e
>    visualizadores de um CRM. Enxergam **somente** o CRM em que foram
>    colocados. Nunca veem o Painel da Plataforma.
>
> **Acesso da agência a cada CRM é configurável e consentido.** O dono
> de cada CRM escolhe o quanto a agência enxerga: só métricas de uso,
> leitura dos dados, ou acesso total para operar junto. A agência pode
> pedir mais acesso; o cliente aprova. Todo acesso da agência fica
> registrado e o cliente vê esse registro.
>
> **Criação de CRM, dois caminhos:**
> - a agência cria o CRM, escolhe o nicho e convida o dono por e-mail;
> - o cliente cria a conta e a agência libera/vincula o CRM dele.
>
> **Modelos por nicho.** Ao criar um CRM, a agência escolhe um modelo
> (clínica médica, odontologia/estética, academia, imobiliária, etc.)
> que já vem com funil, etapas, etiquetas, campos, respostas rápidas,
> automações e agentes de IA adequados ao ramo.
>
> **Caso real que precisa funcionar:**
> - `harpiumdigital@gmail.com` → administrador da plataforma. Vê o
>   Painel da Plataforma e todos os CRMs (no nível que cada um liberou).
> - O CRM **Harpium** (da própria agência) é criado como qualquer outro
>   cliente.
> - `marcelarruda2013@gmail.com` → dono do CRM Harpium. Vê e opera
>   **só** esse CRM. Não vê o Painel da Plataforma.

---

## 2. O que já existe e o que falta

Já existe (migrations 037/038, rotas `/agencia/*`):

| Já existe | Onde |
|---|---|
| Lista de "membros da agência" e a checagem `is_agencia()` | `agencia_membros`, migration 037 |
| Login manda a agência para `/agencia`, o resto para `/dashboard` | `src/app/(auth)/login/page.tsx:73` |
| Visão somada: contas, contatos, conversas, negócios, volume de mensagens, ranking dos 5 mais ativos, lista de quem "precisa de atenção" (14 dias parado, fila sem atendente, WhatsApp desconectado) | `src/app/agencia/page.tsx`, `getAgencyOverview` |
| Ficha de cada conta com contatos, inbox, funil (somente leitura) e export de contatos | `src/app/agencia/[accountId]/*` |
| Log de auditoria dos acessos da agência | `agencia_auditoria`, migration 038 |
| Marca global (white-label) | `/agencia/marca` |
| Papéis dentro do CRM: owner, admin, agent, viewer; convite por link | migration 017 |

O que falta para o que você descreveu:

1. **A agência hoje vê tudo de todos, sem consentimento.** O console lê
   pelo service role, ignorando o RLS. Não há nível de acesso por CRM.
2. **Um usuário = uma conta, criada automaticamente no cadastro.**
   Qualquer pessoa que se cadastra ganha um CRM próprio, e ninguém
   consegue participar de dois CRMs. Por isso `harpiumdigital@gmail.com`
   tem hoje um "CRM pessoal" ("Meu painel") que não deveria existir.
3. **A agência não cria CRM pelo console.** Não existe "Novo CRM",
   nem convite de dono, nem status (ativo/suspenso/arquivado).
4. **Métricas de uso são rasas.** Só volume de mensagens. Falta último
   acesso, usuários ativos, adoção de módulos, tendência e nota de
   saúde.
5. **Não existem modelos por nicho.**
6. **Equipe da agência tem um papel só.** Não dá para ter alguém que só
   acompanha métricas, ou um gestor responsável por alguns clientes.

---

## 3. Modelo de acesso proposto

```
PLATAFORMA (Harpium)
│  papéis: super_admin · gestor · suporte
│
├── CRM "Harpium"            acesso da agência: Total
│     owner: marcelarruda2013@gmail.com
│
├── CRM "Clínica Dr. Fulano" acesso da agência: Métricas
│     owner: dono da clínica · admin · 3 atendentes
│
└── CRM "Academia X"         acesso da agência: Leitura
      owner: dono · 2 atendentes
```

### 3.1 Papéis na plataforma (equipe da Harpium)

No banco: `super_admin`, `manager` (gestor), `support` (suporte).

| Papel | Pode |
|---|---|
| **super_admin** | Tudo: criar/suspender/arquivar CRMs, gerenciar equipe da agência, marca, modelos, ver todos os CRMs no nível que cada um liberou |
| **gestor** | Criar CRMs e operar os CRMs da **sua carteira** (clientes atribuídos a ele), no nível liberado |
| **suporte** | Ver o painel e as métricas; entrar em CRMs só quando o nível liberado permitir |

Nenhum papel da plataforma passa por cima do nível que o cliente
liberou. O super_admin não é exceção. É isso que torna o consentimento
real.

### 3.2 Papéis dentro do CRM (já existem)

owner > admin > agent (atendente) > viewer (visualizador). Mantidos
como estão.

---

## 4. Níveis de acesso da agência (por CRM)

| Nível | A agência vê | A agência faz |
|---|---|---|
| **Métricas** (padrão mínimo) | Números agregados: usuários ativos, último acesso, volume de mensagens, nº de contatos/negócios, canais conectados, nota de saúde. **Nenhum nome, telefone ou conteúdo de conversa.** | Nada dentro do CRM |
| **Leitura** | Tudo de Métricas + contatos, funil, conversas, relatórios (somente leitura) | Exportar (registrado na auditoria) |
| **Total** | Tudo | Entrar no CRM como administrador ("modo suporte", com faixa visível no topo): configurar canais, automações, agentes, responder conversas |

Regras:

- **Quem decide é o dono do CRM**, em *Configurações → Acesso da
  agência*. A agência pode **solicitar** um nível maior; o dono aprova
  ou recusa.
- **Acesso temporário:** o dono pode liberar "Total por 24 horas" para
  suporte pontual. Volta sozinho ao nível anterior.
- **Transparência:** o dono vê o log de acessos da agência ao CRM dele
  (quem, quando, o quê).
- **Metadados operacionais sempre visíveis** à plataforma, em qualquer
  nível: nome do CRM, status, nº de usuários, último acesso, canais
  conectados. Sem isso a agência não consegue nem saber se o CRM está
  ativo. Isso deve constar nos termos de uso.
- **Saúde (clínicas, consultórios):** dados de paciente são dado
  sensível na LGPD. Modelo "Saúde" nasce em **Métricas**, e subir de
  nível exige aceite explícito do dono, com data e versão do termo
  gravadas.

---

## 5. Ciclo de vida de um CRM

### 5.1 Criar (caminho A, a agência cria)

1. Painel da Plataforma → **Novo CRM**.
2. Nome, nicho (modelo), e-mail do dono, gestor responsável, nível de
   acesso proposto, observações do contrato.
3. O sistema cria o CRM, aplica o modelo e envia ao dono um **convite
   de dono** (link único, expira em 7 dias).
4. O dono cria a senha ou entra com a conta que já tem, aceita o nível
   de acesso proposto (ou muda), e cai no CRM dele.
5. O CRM aparece no painel como **Em implantação** até o checklist de
   implantação fechar (WhatsApp conectado, 1º usuário convidado,
   1ª conversa, funil revisado).

### 5.2 Criar (caminho B, o cliente se cadastra)

Recomendação: **cadastro público desligado por padrão** (`/signup` só
funciona com convite). Se quiserem cadastro aberto:

1. Pessoa se cadastra → conta de usuário sem CRM.
2. Vê a tela "Aguardando liberação" (ou cria um CRM em **Teste**, se o
   modo teste estiver ligado).
3. O pedido aparece no painel da agência → a agência aprova, escolhe o
   modelo e vincula.

### 5.3 Status

`em_implantacao` → `ativo` → (`suspenso` ↔ `ativo`) → `arquivado`.

- **Suspenso:** CRM fica somente leitura para o cliente (ex.:
  inadimplência). Webhooks continuam recebendo para não perder
  mensagens.
- **Arquivado:** sai do painel, dados preservados. Exclusão definitiva é
  uma ação separada, só super_admin, com confirmação dupla.

### 5.4 Entrada no sistema (depois do login)

| Quem | Vai para |
|---|---|
| Equipe da plataforma | Painel da Plataforma |
| Usuário com 1 CRM | Dashboard desse CRM |
| Usuário com 2+ CRMs | Seletor de CRM (e um trocador no topo depois) |
| Usuário sem CRM | "Aguardando liberação" |

---

## 6. Painel da Plataforma (a tela inicial da agência)

### 6.1 Topo: números da carteira

CRMs ativos · em implantação · em risco · inativos · suspensos ·
usuários ativos (7 dias) · mensagens no período · negócios ganhos.

### 6.2 Tabela de CRMs (o centro da tela)

Uma linha por CRM, ordenável e filtrável:

| Coluna | Fonte |
|---|---|
| CRM, nicho, gestor responsável | `accounts` |
| Status e nível de acesso liberado | `accounts`, `account_agency_access` |
| **Nota de saúde** (0–100) com seta de tendência | cálculo diário |
| Último acesso de qualquer usuário | presença / sessões |
| Usuários ativos / total (7 dias) | presença |
| Mensagens 7d e variação vs. semana anterior | rollup diário |
| Tempo de 1ª resposta | RPC da migration 048 |
| Canais: WhatsApp / Instagram (ok, desconectado) | configs |
| Módulos usados: funil, automações, agentes, disparos, relatórios | rollup diário |

Filtros: status, nicho, gestor, "em risco", "sem acesso há 7+ dias".

### 6.3 Nota de saúde (proposta inicial, ajustável)

| Peso | Sinal |
|---|---|
| 30 | Usuários ativos nos últimos 7 dias / usuários totais |
| 25 | Mensagens nos últimos 7 dias vs. média das 4 semanas anteriores |
| 15 | Canal principal conectado |
| 15 | Tempo de 1ª resposta dentro da meta |
| 15 | Módulos em uso (funil movimentado, automação ou agente ativo) |

Faixas: 70+ saudável · 40–69 atenção · <40 em risco.

### 6.4 Alertas ("precisa de atenção", evolui o que já existe)

- Ninguém entrou há 7+ dias.
- Queda de 50%+ de mensagens semana a semana.
- WhatsApp/Instagram desconectado ou token perto de vencer.
- Fila de conversas sem atendente acima de X.
- Implantação parada há 14+ dias.
- Pedido de acesso pendente / cadastro aguardando liberação.

### 6.5 Privacidade do painel

Tudo da seção 6 é **agregado** e por isso visível em qualquer nível.
Nome de contato, telefone e conteúdo só aparecem ao abrir um CRM com
nível Leitura ou Total.

---

## 7. Modelos por nicho

Um modelo é um pacote copiado para o CRM no momento da criação (cópia,
não vínculo: mudar o modelo depois não altera CRMs existentes). Também
dá para **aplicar um modelo a um CRM existente**, somando, sem apagar
nada, e **salvar um CRM como modelo**.

Conteúdo de um modelo:

- Funis e etapas
- Etiquetas
- Campos personalizados
- Respostas rápidas
- Automações (desligadas por padrão, o cliente liga)
- Agentes de IA com prompt do ramo (desligados por padrão)
- Vocabulário: "paciente" / "aluno" / "cliente"
- Metas sugeridas para relatórios
- Checklist de implantação
- Nível de acesso da agência sugerido

Primeiros modelos (sugestão, em ordem):

| Modelo | Funil | Campos típicos | Automações |
|---|---|---|---|
| **Clínica médica** | Novo contato → Agendamento → Consulta realizada → Retorno/Tratamento → Fidelizado · Perdido | Convênio, especialidade, data de nascimento, origem | Confirmação de consulta, lembrete 24h, pós-consulta, retorno em X dias |
| **Odontologia / Estética** | Contato → Avaliação agendada → Orçamento → Em tratamento → Concluído · Perdido | Procedimento de interesse, valor do orçamento | Lembrete de avaliação, follow-up de orçamento, retorno de manutenção |
| **Academia / Studio** | Interessado → Aula experimental → Matrícula → Ativo · Cancelado | Plano, modalidade, objetivo, vencimento | Lembrete de aula experimental, reativação de aluno sumido, aniversário |
| **Imobiliária** | Lead → Qualificado → Visita → Proposta → Fechado · Perdido | Tipo de imóvel, faixa de preço, bairro, compra/aluguel | Follow-up pós-visita |
| **Genérico / Serviços** | Novo → Qualificado → Proposta → Negociação → Ganho · Perdido | Empresa, cargo, segmento | Follow-up de proposta |

---

## 7A. Extensão do Chrome visível no CRM

A extensão (`extension/`, "CRM Connector") mostra o contato do CRM ao
lado da conversa no WhatsApp Web, cria o lead, marca a temperatura e
move o negócio no funil. Hoje ela é invisível para o cliente.

### Situação atual

- **Ninguém no CRM sabe que ela existe.** Não há menção em nenhuma tela.
- **Não está empacotada.** A instalação é "Modo do desenvolvedor →
  Carregar sem compactação" apontando para uma pasta do repositório.
  Um cliente não tem essa pasta.
- **A conexão exige uma chave de API** colada nas opções da extensão, e
  só **admin** pode criar chave (`requireRole('admin')`). O atendente,
  que é quem vive no WhatsApp Web, não consegue configurar sozinho.
- **A chave vale para a conta inteira** e não é da pessoa. Se o dono
  gera uma e distribui para a equipe, todos usam a mesma identidade, e
  remover um membro da equipe **não revoga** a chave que ele usava.

### Onde aparece

1. **Menu do perfil (canto superior direito)**: item "Extensão do
   Chrome", entre "Seu perfil" e "Configurações"
   (`src/components/layout/topbar.tsx`).
2. **Configurações**: nova seção "Extensão do Chrome" no grupo
   **Conta** (é pessoal: cada pessoa instala no próprio navegador),
   `?tab=extensao` (`src/components/settings/settings-sections.ts`).
3. **Convite discreto**, que pode ser dispensado, no Inbox e no Dashboard
   para quem ainda não conectou: "Atenda pelo WhatsApp Web com o CRM ao
   lado".

### A tela "Extensão do Chrome"

1. **O que ela faz**: imagem do painel ao lado do WhatsApp Web e três
   linhas. Inclui a garantia de privacidade que já está no README:
   não lê nem envia o texto das conversas.
2. **Passo 1: Instalar.**
   - Enquanto não estiver na Chrome Web Store: botão **Baixar extensão
     (.zip)** + 4 passos ilustrados (descompactar, `chrome://extensions`,
     modo do desenvolvedor, carregar a pasta).
   - Quando estiver na loja: botão único **Adicionar ao Chrome**. A
     tela escolhe sozinha pelo endereço da loja configurado
     (variável de ambiente).
3. **Passo 2: Conectar.** Botão **Gerar minha chave da extensão**:
   cria uma chave **pessoal**, só com os escopos que a extensão usa
   (`contacts:read/write`, `deals:read/write`), e mostra o endereço do
   CRM e a chave com botões de copiar. **Qualquer membro de nível
   atendente ou acima** pode gerar a dele, porque esses escopos não dão
   nada além do que ele já faz pela tela.
4. **Status**: "Conectada · último uso há 3 min" (lido de
   `api_keys.last_used_at`) ou "Ainda não conectada". Botão para
   desconectar (revoga a chave).
5. **Dúvidas comuns**: funciona em Chrome, Edge e Brave no computador;
   não funciona em grupos; como atualizar.

### Mudanças técnicas

| Item | Mudança |
|---|---|
| `api_keys` | + `user_id` (dono pessoal) e `tipo` (`api` / `extensao`). Chave de extensão: 1 ativa por pessoa por CRM; gerar de novo revoga a anterior. |
| Rota nova | `POST /api/account/extension-key`: exige papel atendente+, escopos fixos no servidor (o cliente não escolhe). |
| Remover membro | Revoga as chaves pessoais dele naquele CRM. |
| Pacote `.zip` | Script de build gera `public/downloads/crm-connector-<versão>.zip` a partir de `extension/` (sem os testes). Não há biblioteca de zip no projeto; adicionar `fflate` (pequena, sem dependências) ou usar o `zip` do ambiente de build. |
| Nome da extensão | Hoje "CRM Connector". Para entregar a clientes, usar o nome da marca da plataforma (Harpium). |
| Painel da Plataforma | Nova coluna: pessoas com a extensão conectada / total de usuários, como sinal de adoção. |

### Depois (opcional)

- **Publicar na Chrome Web Store como "não listada"**: instalação com 1
  clique e atualização automática. Exige conta de desenvolvedor Google
  (taxa única de US$ 5) e revisão de alguns dias. **Só o dono da conta
  Google pode fazer.**
- **Conectar sem copiar e colar**: botão "Conectar com o CRM" nas
  opções da extensão abre o CRM, que devolve a chave direto para a
  extensão (`externally_connectable`). Funciona porque a Harpium
  hospeda um único endereço para todos os clientes.

### Dependências

**Nenhuma das fases 1–6.** Funciona com o modelo de contas atual e pode
ser feito antes de tudo. Se a fase 1 vier primeiro, a chave pessoal
passa a ser por pessoa **e por CRM**, o que já está previsto acima.

---

## 8. Arquitetura técnica

### 8.1 Decisão central: aplicar o nível de acesso no banco, não só na tela

Hoje o console usa o service role e passa por cima de todo o RLS. A
regra de nível ficaria só no código da aplicação, e um esquecimento numa
rota vaza dados de um cliente que não autorizou.

Proposta: **a equipe da agência passa a ler com a própria sessão**, e o
RLS decide. Isso é viável com pouca mudança porque **as policies das
tabelas de dados já chamam uma única função**, `is_account_member(account_id,
min_role)` (migration 017 e seguintes). As exceções são poucas e
conhecidas: as policies de storage (`chat-media`, `flow-media`,
migrations 020/023) comparam a pasta com o CRM do perfil, e
`notifications` é por usuário. Basta reescrever o corpo da função e
revisar essas exceções:

```
is_account_member(alvo, papel_minimo) =
  alvo é o CRM ATIVO do usuário
  E (
       usuário é membro de alvo com papel >= papel_minimo
    OU usuário é da agência E alvo liberou nível que equivale a papel_minimo
         (Leitura ≈ viewer · Total ≈ admin · Métricas ≈ nada)
  )
```

- Métricas agregadas continuam vindo por funções `SECURITY DEFINER`
  que só devolvem números, nunca linhas.
- O service role fica restrito a tarefas da plataforma: criar CRM,
  aplicar modelo, calcular o rollup.
- A condição "alvo é o CRM ativo" impede que alguém em dois CRMs veja
  dados misturados numa consulta que não filtre por `account_id`.

### 8.2 Mudanças de banco (migrations novas, a partir da 049)

| Tabela / função | Mudança |
|---|---|
| `account_members` (nova) | `account_id`, `user_id`, `role`. Vários CRMs por usuário. Backfill a partir de `profiles`. |
| `profiles.account_id` | Passa a significar **CRM ativo**. Trocar de CRM = atualizar esse campo depois de validar a participação. Mantém funcionando as ~29 rotas que usam `getCurrentAccount()`. |
| `idx_accounts_one_per_owner` | Removido (um dono pode ter vários CRMs). |
| `is_account_member()` | Reescrita como na 8.1. |
| `accounts` | + `status`, `nicho`, `template_id`, `criado_por`, `gestor_user_id`, `implantacao_concluida_em`, `notas`. |
| `agencia_membros` | + `papel` (`super_admin` / `gestor` / `suporte`). |
| `account_agency_access` (nova) | `account_id`, `nivel`, `concedido_por`, `concedido_em`, `expira_em`, `termo_versao`. |
| `account_agency_access_requests` (nova) | Pedidos de mudança de nível (pendente/aprovado/recusado). |
| `account_invitations` | Permitir convite de **dono** (hoje há `CHECK (role <> 'owner')`). |
| `account_usage_daily` (nova) | Uma linha por CRM por dia: usuários ativos, mensagens in/out, conversas, contatos novos, negócios, uso de módulos, nota de saúde. Preenchida por cron. |
| `crm_templates` (nova) | Modelo em JSON versionado + metadados (nicho, nome, ativo). |
| `handle_new_user()` | Para de criar CRM automaticamente; só cria o perfil. Cadastro aberto vira opção. |
| `platform_settings` (nova) | Cadastro aberto sim/não, modo teste, termos vigentes. |

### 8.3 Aplicação

- `getCurrentAccount()` (`src/lib/auth/account.ts`) valida o CRM ativo
  contra `account_members` e contra o acesso da agência.
- Trocador de CRM no topo para quem tem 2+ CRMs e para a agência.
- Faixa fixa "Você está no CRM de X como Harpium · nível Total" quando
  a agência está dentro de um CRM.
- `/agencia` vira o Painel da Plataforma; a ficha `/agencia/[id]`
  esconde abas conforme o nível, e o servidor recusa também.
- Nova tela do cliente: *Configurações → Acesso da agência* (nível,
  pedidos, log de acessos).
- Nova tela da agência: *Modelos* (lista, editar, criar a partir de um
  CRM).
- Login direciona conforme a tabela da seção 5.4.

---

## 9. Plano de implementação em fases

Cada fase fecha com `tsc`, `eslint`, `vitest`, `next build` limpos e
testes novos para as regras de acesso.

| Fase | Entrega | Depende de |
|---|---|---|
| **0. Pré-requisito** | Aplicar as migrations 044–048 pendentes (ver `HANDOFF.md` §0). Backup do banco. | — |
| **0B. Extensão visível** (seção 7A) | Menu do perfil + seção em Configurações, `.zip` para baixar, chave pessoal da extensão gerada por qualquer atendente, status de conexão, revogação ao remover membro. | — (independente) |
| **1. Fundação de acesso** ✅ | `account_members`, CRM ativo, nova `is_account_member`, papéis da agência, `account_agency_access`, convite de dono, cadastro sem CRM automático. **Sem mudança visível** para clientes atuais. Testes de RLS no PGlite cobrindo cada combinação papel × nível. | 0 |
| **2. Ciclo de vida do CRM** | "Novo CRM" no console, convite de dono, status, tela "Aguardando liberação", seletor/trocador de CRM, login direcionando por papel. Montar o caso real: CRM Harpium com `marcelarruda2013@gmail.com` como dono. | 1 |
| **3. Consentimento** | Tela "Acesso da agência" do cliente, pedidos de nível, acesso temporário, log de acessos visível ao cliente, console respeitando nível (tela + servidor + RLS). | 1 |
| **4. Painel da Plataforma** | `account_usage_daily` + cron, nota de saúde, tabela de CRMs com filtros, alertas novos, último acesso. | 1 (dados), 2 (status) |
| **5. Modelos por nicho** | `crm_templates`, aplicar na criação e em CRM existente, 3 modelos iniciais (Clínica médica, Academia, Genérico), editor no console, "salvar CRM como modelo". | 2 |
| **6. Modo suporte** | "Entrar no CRM" para nível Total, com faixa no topo e auditoria de cada ação. | 1, 3 |
| **7. Depois** | Planos e limites por CRM (usuários, números, agentes), cobrança, marca por CRM, carteira por gestor. | — |

Fases 3, 4 e 5 podem andar em paralelo depois da 2.

---

## 10. Decisões que precisam ser suas

Cada uma tem a recomendação marcada. **A Fase 1 seguiu as
recomendações das decisões 2, 3 e 7**: três níveis fixos; quem decide é
o dono do CRM; CRMs existentes começam em Leitura. Também: membros
atuais da agência viraram Super admin e novos começam como Suporte.
Tudo isso é dado no banco e muda sem nova migration. A decisão 1
(cadastro só por convite) ficou atrás de uma flag, ainda ligada no
comportamento antigo, para a Fase 2.

1. **Cadastro público:** só por convite (**recomendado**) · aberto com
   aprovação da agência · aberto com CRM em teste.
2. **Granularidade do acesso:** 3 níveis fixos — Métricas / Leitura /
   Total (**recomendado agora**) · liberação por módulo (contatos,
   conversas, funil, relatórios, configurações) desde já.
3. **Quem define o nível:** o dono do CRM, a agência solicita
   (**recomendado**) · a agência define por contrato e o cliente só vê.
4. **Equipe da agência:** só super_admin por enquanto · 3 papéis com
   carteira por gestor (**recomendado se houver mais de 2 pessoas na
   equipe**).
5. **Primeiros nichos:** quais 3 entram na fase 5?
6. **Planos e cobrança:** fora desta etapa (**recomendado**) · já
   prever limites por plano.
7. **CRMs que já existem hoje no banco:** quais são clientes reais,
   quais são testes a arquivar, e qual nível de acesso cada um começa.
   A migração inicial precisa de um valor; sugestão: **Leitura** para
   os atuais (é o que a agência já vê hoje), com aviso ao dono para
   revisar.

---

## 11. Riscos

- **A fase 1 mexe na função de que todas as policies dependem.** Um erro
  nela abre ou fecha o sistema inteiro. Mitigação: testes de RLS no
  PGlite antes de aplicar, migration idempotente, backup e aplicar fora
  do horário de pico.
- **Webhooks e crons** (WhatsApp, Instagram, automações, agentes)
  rodam com service role e localizam a conta pelo número/página, não
  pelo usuário. Não são afetados pelo "CRM ativo", mas precisam ser
  conferidos um a um.
- **Rotas que leem `profiles` direto** (18 arquivos) precisam ser
  revisadas para não assumir "o CRM do usuário" quando ele tem vários.
- **LGPD:** o painel agregado não pode vazar dado pessoal por acidente
  (ex.: nome de contato num alerta). Testes de saída para o nível
  Métricas.

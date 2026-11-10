# Plano: melhorar a extensão do Chrome

A extensão (`extension/`, hoje "CRM Connector" v0.3.0) mostra o contato
do CRM ao lado da conversa no WhatsApp Web, cria o lead, marca a
temperatura e move o negócio no funil.

Frentes escolhidas: **corrigir o que falha**, **mais ações no painel**
e **visual e marca Harpium**. Conexão em um clique e Chrome Web Store
ficam para depois.

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

## Fase 1 — Corrigir o que falha ✅ (código pronto, falta testar no WhatsApp real)

Só extensão + um ajuste na API pública. **Sem migration.** Branch
`feat/extensao-fase1-correcoes`, extensão 0.4.0.

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

## Fase 2 — Visual e marca Harpium

Antes das novas ações, porque define onde elas vão morar.

1. **Painel lateral encaixado**: uma coluna à direita que estreita o
   WhatsApp em vez de ficar por cima dele. Recolhido, vira uma aba fina
   na borda com o ícone da Harpium.
2. **Seções**: Contato · Negócios · Conversa · Anotações (as duas
   últimas aparecem na Fase 3).
3. **Marca**: nome "Harpium CRM" na extensão, ícones gerados a partir
   de `docs/analise-do-app/harpium-crm-icon-1024.png`, cores escuras da
   Harpium com tema claro e escuro. O cabeçalho mostra o nome do CRM
   conectado (vem de `/api/v1/me`), porque cada cliente usa o seu.
4. Opções da extensão com o mesmo visual.
5. Atualizar o texto da tela Configurações › Extensão do Chrome e o
   `.zip` de download.

## Fase 3 — Mais ações no painel

### 3A. Sem migration

1. **Anotações**: ver as últimas e escrever uma nova. Novo
   `GET/POST /api/v1/contacts/{id}/notes`; o autor é a pessoa dona da
   chave (a chave da extensão já é pessoal).
2. **Editar contato**: nome, e-mail, empresa, etiquetas (escolhendo
   das existentes ou criando). Novo `GET /api/v1/tags`.
3. **Criar negócio**: título, valor, funil e etapa. Novo
   `POST /api/v1/deals`. Também **ganhar / perder** negócio (o `PATCH`
   já aceita `status`).

### 3B. Com migration 059

4. **Conversa no CRM**: mostra se a IA está respondendo, se está
   **aguardando atendente** e há quanto tempo, com botões **Assumir**
   (pausa a IA e atribui a você) e **Abrir no Inbox**.
   - Precisa de `conversations:read` e de um escopo novo
     `conversations:write` na chave da extensão: a migration 059
     atualiza `extension_key_scopes()` e as chaves de extensão que já
     existem.
   - Depende da migration 058 (aguardando atendente), que está no
     branch `feat/inbox-negocio-e-atendimento`, ainda não no `main`.

---

## Ordem e branches

| Fase | Mexe em | Migration | Depende de |
| --- | --- | --- | --- |
| 1. Corrigir | extensão, `GET/POST /api/v1/contacts` | — | — |
| 2. Visual e marca | extensão, tela de Configurações | — | 1 |
| 3A. Ações | extensão, API (notas, etiquetas, criar negócio) | — | 2 |
| 3B. Conversa | extensão, API de conversas | 059 | 2, e 058 no `main` |

Cada fase em um branch próprio saindo do `main`, com versão nova da
extensão (0.4, 0.5, 0.6).

## Decisões que precisam ser suas

1. **Vínculo das conversas `@lid`**: guardar só no navegador de quem
   vinculou (**recomendado agora**, sem migration) · guardar no CRM
   para a equipe inteira (precisa de migration e de rodar no Supabase).
2. **Nome da extensão**: "Harpium CRM" (**recomendado**) · manter
   "CRM Connector" · outro.
3. **Painel**: coluna encaixada que estreita o WhatsApp
   (**recomendado**) · janela flutuante melhorada, que pode ser
   arrastada.

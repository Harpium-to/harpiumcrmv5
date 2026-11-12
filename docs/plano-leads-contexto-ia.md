# Leads com contexto completo: campos, funil e agente de IA

Plano aprovado fase por fase. Decisões: as cinco recomendações abaixo foram
aprovadas em 12/11/2026, junto com a Fase 1.

## O que existe hoje (lido no código)

- **Lead recebido** (`src/lib/leads/ingest.ts`): nome, telefone, e-mail,
  empresa, cidade e Instagram já vão para os **detalhes** do contato.
  Os `campos` do formato Harpium só vão para um campo personalizado se
  já existir um com o mesmo nome. **As respostas do formulário** (quiz,
  perguntas do Meta, colunas extras do Google), a campanha, a rota e a
  pontuação vão **só para a nota**.
- **Não existe** como apagar um lead: a tabela `leads` não deixa ninguém
  apagar pela tela.
- **Agente de IA respondendo** (`src/lib/ai/auto-reply.ts`): lê as
  últimas 20 mensagens de texto e as instruções. **Não recebe nenhum
  dado do contato** (nem nome, nem empresa, nem campos).
- **Agente abrindo a conversa** (passo "Passar para agente de IA",
  `src/lib/agents/runner.ts`): recebe as respostas do lead como briefing,
  mas **não lê o histórico da conversa**. Se uma automação mandou "Oi,
  Ana!" antes, o agente não sabe e cumprimenta de novo.
- Mensagens de **modelo** (template da API oficial) e de **botões**
  ficam fora do histórico que a IA lê. Uma saudação mandada por modelo é
  invisível para ela.
- **Automações**: as mensagens só usam `{{ vars.nome }}`,
  `{{ vars.primeiro_nome }}`, `{{ vars.empresa }}`, `{{ vars.origem }}`
  e `{{ vars.rota }}`, e só no gatilho "Lead recebido". Campos
  personalizados não entram no texto.

## Fases

Cada fase vira um PR para `main`, com testes, `tsc`, `eslint` e
`next build` limpos. Merge só com o seu OK.

### Fase 1. Apagar lead (sem migration) · feita

- Na lista de Leads, um ícone de lixeira em cada linha e uma caixa de
  seleção para **apagar vários de uma vez** (útil para limpar testes).
- Confirmação: "Apagar este lead? O registro e os dados recebidos somem
  da lista."
- Opção marcável **"Apagar também o contato de teste"**. Só aparece
  quando o contato nasceu desse lead e ainda não tem outra coisa (outro
  lead ou mensagem do cliente). Apaga junto o negócio aberto por esse
  lead no funil, a conversa vazia, as notas e as etiquetas.
- Só administradores, como o "Reprocessar".
- Junto vai o documento de implementações futuras (Fase 5), que é só
  texto.

### Fase 2. "Dados recebidos" em campos de verdade (migration 070)

- Cada **resposta do formulário** vira um **campo personalizado**. O
  nome do campo é a pergunta (até 60 caracteres). Se já existe um
  campo com esse nome (sem diferença de acento ou maiúscula), usa o que
  existe; se não, **cria**.
- O mesmo vale para os `campos` extras, a UF, a **campanha**, o
  **conjunto**, o **anúncio**, a **rota** e a **pontuação**. UTMs e
  códigos de clique (fbclid, gclid) continuam só na nota, porque são
  técnicos.
- Nome, cidade, empresa, e-mail, telefone e Instagram continuam nos
  **detalhes** do contato, como hoje.
- **Lead novo troca o valor** do campo (é o dado mais recente). O
  "Reprocessar" só preenche campo vazio, nunca troca.
- A **nota continua** como histórico: o campo guarda o último valor e a
  nota guarda o que veio em cada lead.
- O **de/para** da tela Leads passa a listar também as perguntas, para
  mandar uma pergunta para um campo que já existe, para a nota ou
  ignorar.
- Os campos aparecem no **contato** (aba Campos, já existe), no
  **painel do contato dentro da conversa** e na **janela do negócio no
  funil** (novo bloco "Dados do contato").
- "Reprocessar" passa os leads antigos pela regra nova e preenche os
  campos deles.
- Limite de segurança: no máximo 40 campos novos por lead e 200 campos
  criados automaticamente por conta. O que passar disso vai para a nota.

**Migration 070** (`070_campos_do_lead.sql`), aplicada por você no SQL
Editor:
- `custom_fields.field_key`: o nome normalizado, com índice único por
  conta. Evita que dois leads chegando juntos criem o mesmo campo duas
  vezes.
- `custom_fields.created_from`: marca os campos criados por lead, para a
  tela de campos mostrar "criado por lead".

### Fase 3. Agente de IA e automações com o contexto inteiro do cliente

- Um "perfil do cliente" montado do CRM: nome, empresa, cidade,
  e-mail, Instagram, origem, etiquetas, **todos os campos
  personalizados preenchidos** e a etapa do funil.
- Entra no agente que **responde** (equipe de agentes e assistente
  único), no agente que **abre a conversa** e no "Sugerir resposta" da
  conversa.
- Vai marcado como **dado de referência, não instrução**. Resposta de
  formulário é texto de fora e não pode mandar no agente.
- **Automações**: novas variáveis em **todos os gatilhos**, não só no
  "Lead recebido":
  - `{{ contato.nome }}`, `{{ contato.primeiro_nome }}`,
    `{{ contato.empresa }}`, `{{ contato.cidade }}`
  - `{{ campo.faturamento_mensal }}`: qualquer campo personalizado, pelo
    nome
  - No editor, um seletor lista essas variáveis e os campos da conta.
  - Variável vazia some sem deixar buraco: "Olá
    {{ contato.primeiro_nome }}, tudo bem?" vira "Olá, tudo bem?", como
    nas respostas rápidas.
  - `{{ vars.* }}` continua funcionando.

### Fase 4. Não cumprimentar de novo

- Mensagens de **modelo** e de **botões/lista** entram no histórico que
  a IA lê, com o texto que o cliente viu.
- O agente que **abre a conversa** passa a ler o histórico (hoje não
  lê).
- Regra nova nas instruções: se a empresa já cumprimentou o cliente
  nesta conversa, **não cumprimentar nem se apresentar de novo**; seguir
  a partir da última mensagem.
- Detector simples: quando há uma saudação recente da empresa ("oi",
  "olá", "bom dia" + nome), a instrução fica explícita e cita a
  mensagem já enviada.
- Testes com os casos: automação mandou "Oi, Ana" e passou para o
  agente; cliente respondeu "oi" depois da saudação; conversa sem
  saudação nenhuma (aí o agente cumprimenta normalmente).

### Fase 5. Plano futuro: Ferramentas e Quiz (só documento) · feita

Novo arquivo `docs/implementacoes-futuras.md`, o lugar único do que fica
para depois, com o primeiro item:

- Aba **Ferramentas** no menu do CRM.
- Ferramenta **Quiz**, parecida com o Typeform: cada cliente monta o
  próprio formulário (perguntas, opções, pontuação, rota A/B/C), publica
  num link e as respostas caem direto como **lead**, já nos campos da
  Fase 2.
- Estrutura: você manda a que já tem pronta; o plano detalhado sai
  dela.

## Decisões (aprovadas: a recomendação marcada)

1. **Apagar lead de teste:** apagar só o lead, com a opção marcável de
   apagar também o contato de teste (**recomendado**) · sempre apagar o
   contato junto · nunca apagar o contato.
2. **Nome do campo criado:** a própria pergunta, cortada em 60
   caracteres (**recomendado**, dá para renomear depois) · um nome curto
   escolhido pela IA (gasta crédito e pode variar).
3. **Lead novo com valor diferente:** troca o valor do campo
   (**recomendado**) · só preenche campo vazio.
4. **Nota do lead:** continua como histórico (**recomendado**) · deixa
   de existir quando tudo vira campo.
5. **Campanha, conjunto, anúncio, rota e pontuação:** viram campos
   (**recomendado**) · ficam só na nota.

## Fora deste plano

- Google Agenda (outra sessão cuida).
- A ferramenta Quiz em si (Fase 5 só registra).

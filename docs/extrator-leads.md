# Extrator de leads

Ferramenta em **Ferramentas › Extrator de leads** (migration 073). Plano e decisões: `docs/plano-extrator-leads.md`.

Ela monta listas de **empresas** para prospectar, a partir de duas fontes, e leva essas listas para o CRM sem misturar com os leads que chegam sozinhos. Daqui saem três caminhos: a lista de ligação, a planilha e a prospecção pelo WhatsApp do QR code, no ritmo de contato frio.

## Como fica para quem usa

1. **Nova extração:** escolhe a fonte, preenche os filtros, clica em **Ver quantas existem** (CNPJ) ou **Ver o custo** (Google Maps) e em **Extrair**. Nada é enviado a ninguém nesta etapa.
2. **Resultado:** a tabela enche enquanto a extração anda. Cada linha diz o que ela é para o CRM:
   - **Novo**;
   - **Já é contato**, com o link para o contato;
   - **Já extraído antes**, pelo mesmo CNPJ, pelo mesmo local do Google ou pelo mesmo número;
   - **Pediu para não receber**;
   - **Sem telefone**.
3. **Antes de levar para o CRM**, se quiser:
   - **Conferir WhatsApp:** pergunta ao número do QR code quais números existem no WhatsApp;
   - **Ler os sites:** só no Google Maps. Lê o site da empresa atrás do link de WhatsApp, do e-mail e do Instagram.
4. **Enviar para o CRM:** os marcados viram contatos com:
   - a etiqueta da lista e a etiqueta `extrator`;
   - a origem "Extrator · CNPJ" ou "Extrator · Google Maps";
   - os dados extras em campos personalizados;
   - uma nota com a busca e a data.
   
   Eles **não** abrem cartão no funil e **não** acionam automações.
5. **Prospectar**, por um destes caminhos:
   - **Lista de ligação:** uma tarefa "Ligar para …" por lead, para quem clicou;
   - **Baixar planilha:** CSV, que o Excel abre;
   - **Prospectar esta lista:** abre o disparo pelo QR code já no **modo prospecção** e com a etiqueta da lista escolhida.
6. **Quando o lead responde:**
   - o cartão abre no funil e ele ganha a etiqueta `respondeu`;
   - o evento "lead recebido" dispara com a origem do Extrator. Uma automação com o filtro de origem "Extrator · CNPJ" pode passar a conversa para o Agent SDR.
   - Quem responde **SAIR** (ou "pare", "não quero", "me tira da lista") é marcado como "pediu para não receber" na hora e entra na lista de bloqueio do CRM.

**Primeira vez:** um administrador do CRM lê e aceita o termo de uso da ferramenta, uma vez por CRM.

## As fontes

### CNPJ (Receita Federal)

A base pública de empresas da Receita, numa **cópia nossa, num banco separado**. São dezenas de milhões de estabelecimentos, e o banco do CRM não pode pesar com isso.

| Filtro | O que faz |
|---|---|
| Atividade (CNAE) | Busca por palavra ou código. Dá para escolher várias |
| Estado e cidade | Várias cidades de uma vez |
| Bairro, CEP | O começo do nome do bairro ou do CEP |
| Tipo | Empresas (sem MEI), MEI e autônomos, ou todos |
| Porte, data de abertura, capital social, matriz ou filial | Como no cadastro da Receita |
| Contato | Só com telefone, só celular, só com e-mail |

- **O que guarda:** só os estabelecimentos **ativos**.
- **Do sócio:** só o nome do administrador. O CPF, mesmo o mascarado, nunca é guardado. Da razão social do MEI sai o CPF que a Receita põe no fim do nome.
- **MEI e empresário individual** aparecem com o selo **contém dado pessoal**.

### Google Maps

Os perfis de empresa do Maps, por um serviço de coleta (Outscraper), numa conta separada das contas Google da Harpium.

- **Busca:** o que procurar, a cidade e o estado.
- **Bairros:** cada um vira uma busca. É assim que se passa do teto de uma busca só.
- **Filtros:** nota mínima e máxima, número de avaliações, com ou sem site, só com telefone, só celular. São aplicados **depois** da busca, então o custo é pelo que o Maps trouxe.
- **Ritmo:** a busca leva de 1 a 3 minutos. A tela mostra o andamento, e dá para sair dela.

## Limites

| O quê | Limite |
|---|---|
| Uma extração pelo CNPJ | até 2.000 leads |
| Uma extração pelo Google Maps | até 500 leads |
| Por CRM, por mês | 2.000 leads (padrão). A agência muda em **Agência › CRM › Extrator de leads** |
| Resultado que não foi para o CRM | apagado depois de 90 dias |
| Apagar uma extração | apaga os resultados; o que ela trouxe continua contando no mês |

### Modo prospecção (disparo pelo QR code)

| Regra | Valor |
|---|---|
| Limite por dia | 20 na 1ª semana, 40 na 2ª, 60 na 3ª e 80 da 4ª em diante, contando da primeira prospecção do CRM |
| Total do dia | prospecção mais disparo comum não passam de 200 |
| Intervalo | de 1 a 3 minutos, sorteado |
| Horário | de segunda a sexta, das 9h às 18h (Brasília), sem feriado nacional, Carnaval e Corpus Christi |
| Textos | no mínimo 3, sorteados por contato, cada um com "SAIR" e sem link nem arquivo |
| Quem recebe | só quem tem WhatsApp (conferido antes) e nunca recebeu outra prospecção |
| Freio automático | para sozinho se as 3 últimas falharem, se mais de 10% falharem ou se 30 saírem sem resposta |
| Até | 500 contatos por prospecção |

Na API oficial do WhatsApp não há prospecção: ela exige o aceite de quem recebe. Nesses CRMs, o Extrator oferece a lista de ligação e a planilha.

## Instalar (o que só o dono pode fazer)

### 1. Migration 073

No SQL Editor do Supabase do CRM, rode `supabase/migrations/073_extrator_leads.sql`. Ela pode rodar antes ou depois do código.

### 2. A base de CNPJ

1. Crie um **segundo projeto** no Supabase, por exemplo `harpium-cnpj`. A base do Brasil inteiro ocupa, numa estimativa, de 15 a 30 GB com os índices: o plano grátis não comporta. Para testar, carregue um estado só (passo 4).
2. No SQL Editor **desse** projeto, rode `supabase/cnpj-base/schema.sql`.
3. No Netlify do CRM, crie as variáveis:
   - `CNPJ_BASE_URL`: o Project URL desse projeto;
   - `CNPJ_BASE_KEY`: a chave `service_role` desse projeto.
4. No seu computador, na pasta do CRM:

   ```bash
   CNPJ_BASE_URL=https://xxxx.supabase.co CNPJ_BASE_KEY=chave-service-role node scripts/cnpj-base/importar.mjs --uf GO,TO
   ```

   - Sem `--uf`, carrega o Brasil inteiro.
   - O script baixa perto de 8 GB da Receita para a pasta `.cnpj-cache`. O servidor da Receita é lento: pode levar horas.
   - Pode parar e rodar de novo. Ele continua os downloads e grava cada linha por cima da anterior.
   - No fim, apaga da base o que não veio no mês, ou seja, as empresas que fecharam.
5. **Todo mês**, rode o mesmo comando. A Receita publica um mês novo; o script pega o mais recente.

### 3. O Google Maps

1. Crie uma conta no Outscraper com um e-mail da Harpium que **não** seja de nenhum projeto do Google.
2. Copie a chave da API (Profile › API key).
3. No Netlify do CRM, crie `OUTSCRAPER_API_KEY`. Se o preço do Outscraper mudar, ajuste `OUTSCRAPER_USD_PER_1000`: ele só muda o custo mostrado na tela.

### 4. O agendador

Nada a fazer: o mesmo agendador das automações (`/api/automations/cron`) toca as extrações que ninguém está olhando, aplica o freio da prospecção e apaga os resultados antigos.

## Onde está no código

| Parte | Arquivo |
|---|---|
| Tabelas | `supabase/migrations/073_extrator_leads.sql` |
| Base de CNPJ (banco separado) | `supabase/cnpj-base/schema.sql`, `scripts/cnpj-base/` |
| Filtros, fontes, duplicados, execução em fatias | `src/lib/extractor/` |
| Entrada no CRM (entrada silenciosa do recebimento universal) | `src/lib/extractor/import.ts`, `src/lib/leads/ingest.ts` (`skipDeal`, `patchMode`) |
| Modo prospecção, freio e resposta | `src/lib/bulk/prospect.ts`, `prospect-brake.ts`, `prospect-reply.ts` |
| Telas | `src/components/extractor/`, `src/components/broadcasts/qr-bulk-sends.tsx` |
| Painel da agência | `src/app/agencia/[accountId]/extrator/` |

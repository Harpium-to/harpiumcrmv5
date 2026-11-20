# Plano: Radar — monitoramento preditivo do CRM (anomalias, previsões e o que fazer)

Documento de planejamento. Escrito em 20/11/2026 a partir do `main` do CRM
(`af88875`) e do ramo `feat/distribuicao-atendimento` (PR #50, ainda não
publicado).

**Andamento:**

- 20/11/2026: plano escrito, **aguardando aprovação** (decisões no §7).

---

## 1. O pedido

> Ter no CRM algo como o cartão "Monitoramento preditivo" que o dono viu
> em outro produto: um sistema que antecipa problemas e oportunidades antes
> que aconteçam, com análise preditiva, alertas inteligentes, detecção de
> anomalias e insights acionáveis. E isso para o cliente (a clínica), não
> só para a agência.

## 2. A resposta curta

- **O CRM já tem as peças, espalhadas:**
  - números por dia nos Relatórios;
  - nota de saúde e alertas, mas só para a agência;
  - analista com IA;
  - agente Gerente;
  - rotinas da Harpi;
  - notificações;
  - o agendador.
- **Proposta:** juntar tudo numa tela e num cartão do Painel chamados
  **Radar**, com três coisas:
  1. **Anomalias.** O sistema compara cada número do CRM com o normal
     *daquele* CRM no mesmo dia da semana, nas últimas semanas, e avisa
     quando algo foge. Exemplo: "leads do Instagram caíram 55%".
  2. **Previsões:**
     - a chance de cada negócio fechar;
     - quanto deve entrar no mês;
     - quem está esfriando (lead quente sem resposta, negócio parado).
  3. **Resumo da semana com o que fazer.** A IA escreve a partir dos
     números, sem inventar nenhum, e ele chega no sino toda segunda.
- **Os cálculos não usam IA.** É estatística simples: barata, rápida e fácil
  de explicar ("8 leads, quando o normal das terças é 18"). A IA só escreve
  o texto do resumo, uma vez por semana, com a chave do próprio CRM.
- **São 5 fases.** A primeira só começa a registrar os números de cada dia,
  e é dela que todo o resto depende.

## 3. O que já existe (conferido no código)

| Peça | Onde | Serve para |
|---|---|---|
| Números do período (leads por origem, mensagens, 1ª resposta, ganhos/perdidos, funil, previsão por data) | `src/lib/reports/queries.ts` (`loadReportBundle`) | base das métricas |
| Analista com IA que **não pode inventar número** | `src/lib/reports/analyst.ts` | modelo do resumo semanal |
| Nota de saúde e alertas por CRM (só agência) | `src/lib/agencia/health.ts` | ideia dos alertas; a agência passa a ver os do Radar |
| Agente "Gerente" (revisa o funil 1x/dia) | `src/lib/agents/roles.ts` | quem usa agentes já tem "o que está parado" |
| Rotinas da Harpi (agendadas, mandam relatório no sino) | `assistant_routines` (074), `src/lib/assistente/routines.ts` | entrega do resumo |
| Agenda com status `no_show` | `calendar_events` (067) | taxa de faltas |
| Temperatura do lead | `contacts.temperature` (045) | "esfriando" e chance de fechar |
| Fechamento com data real | `deals.closed_at` (046) | calibrar a chance de fechar |
| Prazo, filas e histórico de passagens | 076–078 (PR #50) | alertas de atendimento |
| Agendador externo | `/api/automations/cron` (cron-job.org) | onde tudo roda |

**O que falta:**
1. O histórico diário dos números, guardado e comparável.
2. A comparação com o normal de cada CRM.
3. As previsões.
4. Avisos e resumo para o cliente.
5. Uma tela.

## 4. Como vai ficar para quem usa

### 4.1 O Radar

- **No Painel:** um cartão no topo, "Radar: 2 alertas, 1 oportunidade", que
  abre a tela.
- **Tela Radar** (menu lateral), em quatro blocos:
  - **Agora:** os alertas de hoje e da semana. Cada um diz o que mudou, o
    número contra o normal, por que importa e o que fazer, com um botão
    que abre a lista certa (ex.: "ver os 12 leads").
  - **Previsão do mês:** receita prevista (faixa provável), negócios com
    chance alta parados e negócios em risco.
  - **Esfriando:** leads e pacientes quentes ou mornos sem resposta, e
    negócios parados acima do normal da etapa.
  - **Resumo da semana:** o texto da última segunda.

### 4.2 Exemplos de alerta numa clínica

- "Leads do Instagram caíram 55%: 8 nesta terça, normal das terças é 18."
- "A primeira resposta demorou o dobro hoje: 42 min (normal: 15 min)."
- "Faltas na agenda subiram: 5 de 20 consultas (25%); o normal é 8%."
- "Orçamentos estão fechando menos: 1 de 12 este mês; o normal é 4 de 12."
- "Pico de mensagens: 3x o normal de quinta. Vale reforçar a equipe."
- Oportunidade: "12 leads quentes sem resposta há mais de 2 horas."
- Oportunidade: "3 negócios com chance alta parados há 7 dias."

### 4.3 Previsões

- **Chance de fechar (0 a 100%)** em cada negócio, no cartão e na lista.
  - Calculada com o histórico do próprio CRM: etapa, tempo parado na
    etapa, temperatura, origem e valor.
  - Com pouco histórico, aparece "estimativa fraca" e a porcentagem fica
    escondida.
- **Receita prevista do mês:** valor × chance dos negócios abertos com data
  prevista no mês, numa faixa (mínimo provável – esperado).
- **Esfriando:** quente ou morno sem resposta há X horas ou dias, ou negócio
  parado mais tempo que o normal daquela etapa.

### 4.4 Resumo da semana

- Toda segunda às 8h (ajustável), com três partes:
  - o que mudou;
  - de 3 a 5 pontos de atenção, cada um com seu número;
  - o que fazer.
- Chega no sino e fica numa conversa da Harpi, que já guarda os relatórios
  das rotinas.
- A IA recebe só os números, como o analista dos Relatórios, e é proibida de
  inventar. Sem chave de IA, o resumo sai só com os números, montado pelo
  próprio sistema.

### 4.5 Configurações › Radar

- Ligar e desligar cada tipo de alerta.
- Sensibilidade: baixa, normal ou alta.
- Quem recebe: dono e administradores, ou pessoas escolhidas.
- Dia e hora do resumo.
- "Ignorar este alerta até…", para semanas atípicas como feriados e
  campanhas.

### 4.6 Para a agência

- O painel da agência mostra os alertas do Radar de cada cliente ao lado da
  nota de saúde.
- O Agency OS recebe esses alertas pela lista `alerts` da API da
  plataforma, como os alertas de prazo que acabaram de entrar.

## 5. Desenho técnico

### 5.1 O livro-caixa diário (base de tudo)

- Tabela `metric_daily (account_id, day, metric, dimension, value)`: um
  número por métrica, por dia e por recorte (ex.: a origem do lead), no fuso
  do CRM.
- **Métricas da v1:**
  - leads (por origem);
  - conversas novas;
  - mensagens recebidas;
  - mediana da 1ª resposta;
  - conversas sem resposta há 24h;
  - negócios criados, ganhos e perdidos (quantidade e valor);
  - consultas marcadas, realizadas e faltas;
  - passagens por prazo estourado (078).
- **Por que guardar em vez de calcular na hora:** comparar com 6 a 8 semanas
  na tela custaria caro a cada visita. Assim o cálculo pesado roda uma vez
  por dia.
- **Atualização:** o agendador atualiza o dia corrente a cada tick (leve) e
  fecha o dia anterior de madrugada.
- **Histórico inicial:** na primeira vez, calcula as últimas 12 semanas a
  partir das tabelas que já existem.

### 5.2 Anomalias (sem IA)

- **Comparação:** cada métrica é comparada com o mesmo dia da semana nas
  últimas 6 semanas, por mediana e desvio robusto (MAD). Esse método não se
  deixa enganar por um dia fora da curva.
- **Vira alerta só quando passa nos três testes:**
  - a distância passa de *k* desvios (k vem da sensibilidade);
  - a variação passa de um mínimo em % (ex.: 30%);
  - há volume suficiente (de 1 para 2 leads não é "+100%").
- **Sem repetição:** um alerta por métrica e recorte por dia, que se resolve
  sozinho quando o número volta ao normal.
- **Também vale para a semana:** a semana inteira contra as 6 anteriores, o
  que pega quedas lentas.
- **CRM aprendendo:** com menos de 4 semanas de dados, o CRM não recebe
  alertas de anomalia. A tela mostra "aprendendo o normal deste CRM".
- **Onde fica:** tabela `radar_alerts`, com tipo, métrica, recorte,
  período, valor, esperado, direção, gravidade, situação
  (aberto/visto/resolvido/ignorado) e datas.

### 5.3 Previsões (sem IA)

- **Chance de fechar:**
  - parte da taxa de ganho de cada etapa de cada funil, medida nos
    negócios fechados dos últimos 12 meses;
  - é ajustada por fatores de tempo parado, temperatura e origem, todos
    calibrados no mesmo histórico;
  - com pouco dado, a taxa puxa para a média geral, para não oscilar à toa.
- **Onde fica a chance:** colunas `deals.win_probability` e
  `deals.win_probability_at`, recalculadas pelo agendador de madrugada e
  quando o negócio muda de etapa.
- **Receita prevista:** soma de valor × chance, com uma faixa (somatório das
  incertezas). Nada de número único "exato".
- **Esfriando:** regras com o normal do CRM, por exemplo "parado mais tempo
  que 80% dos negócios que fecharam nesta etapa".

### 5.4 O resumo semanal (IA)

- **Reaproveita o analista dos Relatórios**, com a regra de que a IA vê
  números e não pode inventar. O pacote de dados soma os números da semana,
  os alertas, as previsões e os que estão esfriando.
- **Custo:** uma chamada por CRM por semana, com a chave e o modelo do
  próprio CRM.
- **Entrega:** notificação tipo `radar` e uma conversa da Harpi chamada
  "Radar".

### 5.5 Onde roda e quanto custa

- Tudo roda no tick do agendador que já existe, sem servidor novo:
  - no tick, atualizar o dia corrente é leve;
  - de madrugada, fecham-se o dia, as anomalias e as chances;
  - na segunda, sai o resumo.
- No banco, são cerca de 15 métricas × poucos recortes × 365 dias. Isso dá
  dezenas de milhares de linhas por CRM por ano: cabe no plano grátis do
  Supabase por bastante tempo, e há um índice por CRM e por dia.

## 6. Fases

### Fase 1. O livro-caixa diário · tamanho M · migration 079

- A tabela `metric_daily`, a função que calcula um dia de um CRM, o
  histórico inicial de 12 semanas e a atualização no agendador.
- Os Relatórios passam a poder ler daqui (mais rápidos), sem mudar o que
  mostram.
- **Pronto quando:**
  - os números de um dia batem com os dos Relatórios, num CRM de teste e
    num real;
  - o histórico das 12 semanas é gerado em menos de um minuto por CRM;
  - os testes de banco cobrem o fuso e as métricas.

### Fase 2. Alertas de anomalia + o Radar · tamanho G · migration 080

- A detecção (§5.2), `radar_alerts`, o cartão no Painel, a tela Radar
  ("Agora") e o aviso no sino para quem recebe.
- O botão de cada alerta abre a lista filtrada.
- **Pronto quando:**
  - numa bateria de séries de teste, com quedas reais, feriados e números
    pequenos, os alertas certos disparam e os falsos não;
  - um alerta não se repete no mesmo dia;
  - um CRM novo mostra "aprendendo".

### Fase 3. Previsões · tamanho G · (colunas na 080)

- Chance de fechar (§5.3) no cartão e na lista de negócios, receita prevista
  do mês e o bloco "Esfriando".
- **Pronto quando:**
  - em teste retroativo, prevendo o mês passado com os dados de antes dele,
    a receita real cai dentro da faixa prevista na maioria dos meses de
    teste;
  - quem tem pouco histórico vê "estimativa fraca".

### Fase 4. Resumo da semana e Configurações › Radar · tamanho M

- O resumo com IA (§5.4), a versão sem IA e as opções do §4.5.
- **Pronto quando:**
  - o resumo de 5 CRMs de teste cita só números do pacote (há um teste
    automático que procura número inventado);
  - desligar um tipo de alerta para de avisar.

### Fase 5. Agência · tamanho P

- Os alertas do Radar no painel da agência e na API da plataforma.
- **Pronto quando:** um alerta de um cliente aparece no painel da agência
  e no resumo da API.

### Depois (fora deste plano)

- Aviso no WhatsApp ou e-mail do dono. Pelo WhatsApp do próprio CRM, fora
  da janela de 24h, precisa de modelo aprovado pela Meta.
- Prever falta por paciente, para confirmar com mais insistência quem tem
  risco alto.
- A IA sugerindo e criando a ação, como uma tarefa para a pessoa certa ou
  uma automação de reativação.

## 7. Decisões que precisam ser suas

1. **Nome:** Radar, Sentinela ou Pulso?
   *Recomendo **Radar**: é curto, todo mundo entende, e não copia o
   "Sense" de outro produto.*
2. **Quem recebe os alertas:** dono e administradores, ou todos?
   *Recomendo **dono e administradores**, com opção de escolher pessoas.
   Alerta para todo mundo vira ruído.*
3. **Resumo da semana:** segunda às 8h, no sino e na Harpi?
   *Recomendo **sim**. WhatsApp e e-mail ficam para depois.*
4. **Sensibilidade padrão:** baixa, normal ou alta?
   *Recomendo **normal**, ajustável por CRM.*
5. **Chance de fechar visível para atendentes?**
   *Recomendo **sim**: ajuda cada um a priorizar. Dá para esconder por CRM.*
6. **CRM novo:** quantas semanas de dados antes de alertar anomalias?
   *Recomendo **4**.*

## 8. Riscos e cuidados

- **Alarme falso** (números pequenos, feriados, campanhas): há volume
  mínimo, mediana robusta, o mesmo dia da semana como referência e
  "ignorar até…". Um alarme falso por semana já faz o dono parar de ler,
  por isso a régua é conservadora no começo.
- **Previsão mal calibrada:** só mostra a porcentagem com histórico
  suficiente, e há teste retroativo antes de ligar (Fase 3).
- **IA inventando número:** o resumo segue as regras do analista e passa por
  um teste automático. Sem chave de IA, sai só com os números.
- **Privacidade:** os números ficam no CRM. A agência continua vendo só
  contagens e alertas, como hoje.
- **Migrations:** 079 e 080 (076 a 078 estão no PR #50). Vão para o ar junto
  com as do atendimento, na ordem.
- **Netlify:** juntar o atendimento e o Radar numa publicação só economiza
  créditos.

## 9. Para quem for executar

- Trabalhar num ramo a partir de `feat/distribuicao-atendimento` (usa as
  colunas de prazo da 078), por exemplo `feat/radar`, em worktree próprio.
- Testes de banco no molde de `supabase/tests/distribuicao.test.ts`
  (PGlite).
- Os detectores e as previsões são funções puras em
  `src/lib/radar/`, testadas com séries prontas, incluindo feriado e queda
  lenta.
- O resumo reaproveita `src/lib/reports/analyst.ts`. As rotinas e
  notificações reaproveitam `src/lib/assistente/routines.ts` e a tabela
  `notifications`.

## 10. Tamanho

| Fase | Tamanho | Migration |
|---|---|---|
| 1. Livro-caixa diário | M | 079 |
| 2. Anomalias + Radar | G | 080 |
| 3. Previsões | G | (080) |
| 4. Resumo semanal + configurações | M | — |
| 5. Agência | P | — |

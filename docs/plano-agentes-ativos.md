# Plano: agentes de IA ativos — uma equipe que trabalha sozinha e conversa entre si

Data: 27 de novembro de 2026. Status: **Fases 0, 1 e 2 implementadas** no branch `feat/agentes-ativos`, à espera da migration 082 em produção e do merge. Veja [Andamento](#andamento) no fim.

## O pedido

- Fazer os Agentes de IA trabalharem "como o OpenBot / GrokBot".
  - Entendi como o **OpenClaw**, o agente de código aberto que antes se chamava Clawdbot e depois Moltbot.
  - Se você quis dizer outro, me avise. A proposta muda pouco.
- Agentes mais ativos. Hoje eles esperam alguém escrever.
- Vários agentes que conversam entre si para entender o caso.

## Minha opinião

- **Dá para fazer, e a base está mais pronta do que parece.**
  - O CRM já tem uma equipe com funções, níveis de autonomia, fila de tarefas, aprovações e memória (migrations 044 e 045).
  - Parte disso está desligada ou escondida. Ver [O que falta](#o-que-falta).
- **O que deixa o OpenClaw "vivo" são três coisas, e os nossos agentes não têm nenhuma:**
  1. Ele acorda sozinho de tempos em tempos para ver se há algo a fazer. Se não há, fica calado.
  2. Ele usa ferramentas de verdade, em vez de só escrever texto.
  3. Os agentes trocam mensagens e passam trabalho uns para os outros.
- **Uma diferença que eu manteria.**
  - O OpenClaw é um assistente pessoal com acesso amplo: computador, navegador, arquivos.
  - Aqui, os agentes falam com os clientes do seu cliente, em nome da empresa.
  - Então: lista fechada de ações. Tudo o que chega ao cliente passa pela autonomia e pelas aprovações, que já existem e ficam no código. Também valem os limites de mensagem por contato, o expediente e o opt-out.
  - Mais vivo, não mais solto.
- **Custo.**
  - Cada vez que um agente "acorda" e chama a IA, gasta da chave do cliente.
  - Por isso a ronda primeiro olha o banco, o que é barato, e só chama a IA quando acha algo para fazer.
  - O OpenClaw faz o mesmo: pula a execução quando não há nada.
- **Risco de bloqueio do WhatsApp.**
  - Mensagens que o agente manda por iniciativa própria, pela API não oficial (UAZAPI), aumentam o risco de banimento do número.
  - Recomendo: mensagem proativa só para quem já conversou com a empresa, espaçada e com teto por dia.
  - Prospecção fria, só pela API oficial e com modelo aprovado pela Meta.
- **Ordem.**
  - Primeiro, fazer funcionar o que já existe (Fase 0).
  - Depois, ferramentas e rondas (Fases 1 e 2). É aí que os agentes ficam ativos.
  - Por último, a conversa entre eles (Fase 3).

## Como o OpenClaw funciona (o que interessa para nós)

| Peça do OpenClaw | O que faz lá | Como fica no CRM |
|---|---|---|
| **Jobs de automação** (o antigo *heartbeat*) | O agente acorda num horário fixo ou a cada X minutos, dentro do horário ativo. Uma "checagem proativa" a cada 30 minutos já vem pronta (desligada). Se não há nada, responde `NO_REPLY` e ninguém é incomodado. Se há, age ou avisa o dono. O próprio agente cria lembretes, e um pedido que se repete pode virar job, depois de confirmado | **Rondas** de cada agente |
| **Vários agentes, cada um com seu espaço** | Cada um tem persona (`SOUL.md`), regras (`AGENTS.md`) e ferramentas liberadas ou bloqueadas. Regras de roteamento dizem quem atende cada canal ou contato | Já existe em parte: funções, ferramentas, palavras-chave, setores. Ganha personalidade e regras separadas |
| **Conversa entre agentes** | `sessions_send` manda mensagem para outro agente e espera a resposta. `sessions_spawn` cria um subagente para uma tarefa, e o resultado volta para quem pediu. Uma lista diz quem pode falar com quem | **Perguntar a um colega**, **Passar o caso** e a **Sala da equipe** |
| **Memória em camadas** | `MEMORY.md` guarda os fatos duradouros, há notas diárias e busca na memória. Uma revisão periódica (*dreaming*) promove o que importa para a memória longa | A memória que já existe na tabela, mais o **Diário** e a **Revisão da noite** |
| **Ordens permanentes** (*standing orders*) | Programas em texto: escopo, gatilho, quando pedir aprovação, quando chamar alguém | **Regras de trabalho** de cada agente |
| **Habilidades** (*skills*) e o catálogo ClawHub | Pacotes de instruções, instaláveis de um catálogo público | **Habilidades** publicadas pela agência para todos os CRMs |
| **Canal do dono** | A pessoa conversa com o agente pelo WhatsApp ou Telegram | O Harpi, mais o resumo e as aprovações pelo WhatsApp do dono (última fase) |

Fontes: [jobs de automação e heartbeat](https://docs.openclaw.ai/gateway/heartbeat), [como os jobs rodam](https://docs.openclaw.ai/automation/cron-jobs/how-it-works), [vários agentes](https://docs.openclaw.ai/concepts/multi-agent), [ferramentas de sessão](https://docs.openclaw.ai/concepts/session-tool), [memória](https://docs.openclaw.ai/concepts/memory), [habilidades](https://docs.openclaw.ai/tools/skills), [ordens permanentes](https://docs.openclaw.ai/automation/standing-orders). Consultadas em 27/11/2026.

## O que o CRM já tem

| Peça | Onde está | Situação |
|---|---|---|
| Equipe com 12 funções prontas: prospector, pesquisador, SDR, follow-up, executivo, closer, pós-venda, gerente, recepção, suporte, financeiro e agenda | `src/lib/agents/roles.ts` | Funciona |
| Autonomia de 1 a 4, decidida no código, e fila de aprovações | `autonomy.ts`, `approvals.ts`, aba Aprovações | Funciona, mas o que você aprova só é executado quando o motor da fila roda. Ver a Fase 0 |
| Fila de tarefas, com etapas visíveis, horário marcado e dependência entre tarefas | migration 045, `tasks.ts`, `runner.ts`, aba Trabalhando | Depende de alguém chamar `/api/agents/cron` a cada minuto |
| Repasse entre agentes | `HANDOFF_CHAIN` em `roles.ts`, aba Rede | Esteira fixa, de mão única: prospector → pesquisador → SDR → executivo → closer → pós-venda. Ninguém pergunta nada a ninguém |
| Memória dos agentes: do agente, da equipe e de cada contato, com busca por palavra e por significado | tabela `agent_memory` (045), `memory.ts` | Só a fila usa. O atendimento do WhatsApp não lê nem grava, e nenhuma tela mostra |
| Expediente e metas por agente | `schedule.ts`, `goals.ts` | Funciona |
| Resposta automática no WhatsApp | `src/lib/ai/auto-reply.ts` | Funciona. Escolhe o agente por palavra-chave e age por "marcadores" no texto (`[[HANDOFF …]]`, reserva na agenda), não por ferramentas |
| Harpi: IA que usa ferramentas, rotinas agendadas, memória da equipe e cartões de confirmação | `src/lib/assistente/` (074) | Funciona. É a peça mais parecida com o OpenClaw, mas só fala com a equipe humana, nunca com os agentes |
| Automação "passar para agente de IA" | `src/lib/automations/engine.ts` | Funciona: cria uma tarefa na fila |
| Radar: aponta o que saiu do normal | `src/lib/radar/` | Funciona. Pode alimentar as rondas |
| Correção dos botões Duplicar e Editar, que ficam em cima do liga/desliga no cartão do agente | commit `d4eb4a1`, só no branch antigo `feat/leads-universal` | **Nunca foi para o ar.** Entra na Fase 0 |

## O que falta

1. **Ninguém acorda sozinho.**
   - Hoje o agente só age em três casos: um cliente escreve; uma pessoa ou automação cria uma tarefa; o agente anterior da esteira passa o caso.
   - Não existe ronda. É por isso que eles parecem passivos.
2. **O motor da fila pode estar desligado.**
   - `/api/agents/cron` precisa ser chamado a cada minuto, como diz `docs/hospedagem.md`.
   - O Harpi e o Radar foram feitos para rodar dentro do `/api/automations/cron`, justamente para não depender de outro agendador.
   - Se o cron-job.org não chama `/api/agents/cron`, as tarefas ficam paradas e aprovar na aba Aprovações não executa nada.
   - Dá para conferir no cron-job.org, ou pelo SQL: tarefas antigas paradas em `queued`.
3. **Os agentes escrevem, mas não fazem.**
   - O que eles conseguem fazer está fixo no código, por tipo de tarefa.
   - O Harpi já sabe usar ferramentas. Os agentes, não.
4. **A "conversa" entre agentes é uma esteira de mão única.** Não há pergunta, nem resposta, nem escolha de quem chamar.
5. **A memória existe, mas está longe do atendimento e escondida.**
6. **Tudo é um texto só, as instruções.** Personalidade, regras e conhecimento ficam misturados.
7. **O prospector não prospecta.** Falta uma ferramenta de busca na web. A tarefa `prospect` falha de propósito, com `unsupported_kind`.

## Como fica para quem usa

### Um dia numa loja de planejados (exemplo)

- **08:00 — Ronda da Recepção.**
  - Acha 3 conversas de ontem à noite sem resposta.
  - Responde as 2 simples.
  - A terceira pede orçamento: passa para o Vendedor, com um resumo.
- **09:40 — Chega um lead do "Quiz planejados".**
  - O SDR qualifica o lead.
  - Antes de propor a medição, pergunta à Agenda: "tem horário quinta à tarde no bairro X?". A Agenda responde em segundos.
  - O SDR propõe dois horários ao cliente.
- **14:00 — Ronda do Follow-up.**
  - Acha 5 orçamentos parados há 3 dias ou mais.
  - Escreve uma retomada diferente para cada um.
  - Como a autonomia dele é 2, as 5 vão para Aprovações, e você aprova pelo celular.
- **17:30 — Reunião do fim do dia.** O Harpi junta o relato de cada agente e manda para você: "Hoje: 14 conversas, 3 medições marcadas, 2 aprovações esperando. O Follow-up recuperou a Dona Ana."
- **23:00 — Revisão da noite.** Cada agente relê o próprio diário e guarda o que aprendeu. Por exemplo: "quem vem do bairro X sempre pergunta do prazo de entrega".

### O que muda na tela de Agentes de IA

- Cada agente ganha abas: Personalidade, Regras de trabalho, Rondas, Habilidades, Memória e Diário.
- Uma aba nova, a **Sala da equipe**.
  - Mostra as mensagens entre agentes, agrupadas por caso (contato ou negócio), como um grupo de WhatsApp.
  - Você lê tudo e pode entrar na conversa: "@SDR, segura esse lead até segunda".
- A aba Rede deixa de desenhar uma esteira fixa. Passa a mostrar quem conversou com quem na semana.
- O menu lateral mostra o número de aprovações esperando (ver `docs/plano-menu-lateral.md`).

## Fases

### Fase 0 — Ligar o que já existe (pequena)

- O motor da fila passa a rodar dentro do `/api/automations/cron`, com tempo limitado por chamada, como o Harpi e o Radar.
  - `/api/agents/cron` continua funcionando para quem já chama.
- Um aviso na tela de Agentes quando o motor não roda há mais de 10 minutos.
- O atendimento do WhatsApp passa a usar a memória.
  - Antes de responder, lê o que a equipe sabe sobre o contato.
  - Depois, guarda o que aprendeu.
- Aba Memória: ver, corrigir e apagar o que cada agente sabe.
- A correção dos botões Duplicar e Editar (`d4eb4a1`).
- O selo de aprovações no menu.
- Migration: provavelmente nenhuma, porque a tabela de memória já existe. No máximo um campo para a última volta do motor.

### Fase 1 — Ferramentas de verdade

- Os agentes passam a usar o mesmo cérebro do Harpi (`src/lib/assistente/loop.ts`).
  - Uma chamada da IA por passo, com o andamento salvo no banco.
  - Assim cabe no limite de tempo do Netlify.
- Ferramentas:
  - buscar no CRM e ler a conversa;
  - atualizar contato e negócio, mover de etapa;
  - criar tarefa e marcar na agenda;
  - enviar mensagem;
  - chamar uma pessoa ou um setor;
  - guardar na memória;
  - agendar o próprio retorno: "volto a falar com ela quinta às 10h".
- Toda ferramenta que altera algo passa pela regra de autonomia (`decide()`). O que precisa de OK vira cartão em Aprovações, exatamente como hoje.
- Os marcadores de hoje (`[[HANDOFF …]]`, reserva na agenda) continuam funcionando durante a troca.
- Migration: nenhuma, ou pequena.

### Fase 2 — Rondas: os agentes ficam ativos

- Cada agente ganha rondas. Uma ronda diz:
  - quando roda: a cada X minutos no expediente, em dias e horários fixos, ou uma vez só;
  - o que olhar;
  - o que fazer.
- Antes de chamar a IA, a ronda faz uma checagem barata no banco, por exemplo "há conversa sem resposta há mais de 2 horas?". Se não há nada, termina calada e sem custo.
- Rondas prontas por função:

| Função | Ronda pronta |
|---|---|
| Recepção | Conversas sem resposta |
| SDR | Lead novo sem primeiro contato em 15 minutos |
| Follow-up | Orçamento parado há 3 dias ou mais; cliente que sumiu |
| Agenda | Confirmar as reuniões de amanhã; avisar quando alguém falta |
| Pós-venda | Cliente que comprou há 30 dias; pedir avaliação |
| Gerente | Metas do dia e alertas do Radar |

- Limites que valem sempre:
  - o expediente do agente;
  - o opt-out do contato;
  - no máximo 1 mensagem proativa por contato por dia e 3 por semana (ajustável);
  - na API oficial, fora da janela de 24 horas, só modelo aprovado ou aviso para uma pessoa;
  - um teto de gasto por agente por dia.
- O Harpi oferece transformar um pedido repetido em ronda: "quer que eu faça isso toda segunda?". O OpenClaw faz o mesmo.
- Histórico de cada ronda: quando rodou, o que achou, o que fez e quanto custou.
- Migration 082: a tabela de rondas.

### Fase 3 — Agentes que conversam entre si

- Três ferramentas novas:
  - **Perguntar a um colega:** manda a pergunta e espera a resposta, como o `sessions_send`. Até 3 idas e voltas por pergunta.
  - **Passar o caso:** entrega a tarefa com um resumo e segue em frente. O resultado volta para quem pediu, como no `sessions_spawn`.
  - **Avisar:** só informa, sem esperar resposta.
- Quem fala com quem: por padrão, todos os agentes do mesmo CRM. Dá para restringir por agente.
- A esteira fixa vira sugestão. Cada agente escolhe a quem passar o caso, dentro do que tem permissão.
- A Sala da equipe e a Rede com as conversas reais.
- Freios contra loop:
  - o mesmo caso não passa de um número de mensagens por hora entre agentes;
  - um limite de níveis de repasse (o OpenClaw também tem);
  - um teto de custo.
- As pessoas entram na conversa com @ e o nome do agente. Isso vira uma instrução para aquele agente, naquele caso.
- Migration 083: a tabela de mensagens entre agentes, ligada ao contato, ao negócio e à tarefa.

### Fase 4 — Personalidade, regras, diário e reunião do fim do dia

- O formulário do agente se divide em três partes:
  - **Personalidade:** o tom e o jeito de falar.
  - **Regras de trabalho:** as "ordens permanentes". Quando acontecer X, faça Y; peça aprovação se Z; chame alguém se W.
  - **O que ele sabe da empresa:** vem do contexto do cliente, que já existe.
- **Diário:** um registro automático do que cada agente fez no dia.
- **Revisão da noite:** o agente relê o diário e guarda as lições na memória longa. É o *dreaming* do OpenClaw.
  - Tudo aparece na aba Memória, e dá para apagar.
- **Reunião do fim do dia:** o Harpi junta os relatos e manda o resumo para o dono, no sino e numa conversa do Harpi.
- O Harpi passa a falar com os agentes: "Harpi, pede para o Follow-up dar uma pausa na Dona Ana".
- Migration 084: campos novos em `agents` e a tabela do diário.

### Fase 5 — Habilidades da agência

- Uma habilidade é um pacote: instruções, as ferramentas de que precisa e rondas sugeridas.
  - Exemplos: "Confirmar medição", "Recuperar orçamento parado", "Pesquisa de satisfação", "Cobrança gentil", "Reativar cliente de 90 dias".
- A Harpium publica as habilidades no painel da agência, e cada CRM liga as que quiser, por agente.
  - É o catálogo do OpenClaw (ClawHub), mas com a curadoria da agência. Isso também é um diferencial comercial.
- Versões: quando a agência melhora uma habilidade, os CRMs recebem a versão nova. Dá para travar numa versão.
- Migration 085.

### Fase 6 — A equipe no WhatsApp do dono, e busca na web

- **O dono conversa com a equipe pelo WhatsApp.**
  - O dono cadastra o próprio celular.
  - O resumo do dia e os pedidos de aprovação chegam pelo WhatsApp do CRM.
  - Ele responde "1" para aprovar ou "2" para recusar, ou pergunta ao Harpi: "quantos leads hoje?".
  - Na API oficial, a primeira mensagem do dia precisa de um modelo aprovado pela Meta.
- **Busca na web** para o prospector e o pesquisador.
  - Usa a busca do próprio provedor de IA (OpenAI ou Anthropic), com a chave do cliente.
  - O Extrator de leads (base de CNPJ e Google Maps) vira ferramenta do prospector.
- Migration 086.

## Custos e limites

- Cada passo da IA usa a chave do cliente.
- A ronda só chama a IA quando a checagem no banco acha algo. Ronda vazia não custa nada.
- Teto de gasto por agente por dia, com aviso em 80% e pausa em 100%.
- A ronda pode usar um modelo mais barato que o das conversas.
- O gasto continua indo para o `ai_usage_log`, que hoje separa só por tipo de uso. Passa a separar também por agente e por ronda.

## Riscos

| Risco | O que fazer |
|---|---|
| Banimento do número na API não oficial por mensagens proativas | Os limites da Fase 2, e proativo só para quem já conversou com a empresa |
| Agentes em loop, um chamando o outro | Os freios da Fase 3 |
| IA inventando dado | Ferramentas que leem o dado real, a regra "nunca invente" que já está em todas as funções, e uma conferência de números como a do Radar |
| Ficar complicado demais para o cliente | Equipe pronta por nicho, com rondas e habilidades já ligadas. O cliente só ajusta |
| Tempo por requisição no Netlify | Um passo da IA por chamada, com o andamento salvo no banco. O Harpi já funciona assim |

## Decisões

| # | Pergunta | Recomendação |
|---|---|---|
| 1 | Nomes: "Rondas", "Sala da equipe", "Regras de trabalho", "Habilidades", "Diário" | Sim |
| 2 | Numa ronda nova, enviar mensagem ao cliente sempre pede OK, até você liberar aquela ronda? | Sim, mesmo em agente com autonomia 3 |
| 3 | Limite de mensagens proativas por contato | 1 por dia e 3 por semana. Nunca fora do expediente, nunca depois de opt-out |
| 4 | Mensagem proativa pela API não oficial | Só para contatos que já conversaram com a empresa |
| 5 | Quem fala com quem | Todos os agentes do mesmo CRM, com opção de restringir |
| 6 | Quem coordena a equipe e fala com o dono | O Harpi. A função "Gerente" continua para quem quiser um agente só de acompanhamento |
| 7 | Teto de gasto por agente por dia | Padrão de US$ 1, ajustável, com aviso em 80% |
| 8 | Ordem das fases | 0 → 1 → 2 → 3 → 4 → 5 → 6, aprovando fase a fase |
| 9 | Busca na web | A do provedor de IA do cliente, sem contratar outro serviço |

## Próximo passo

- Aprovar, ou ajustar, as decisões e a Fase 0.
- Conferir no cron-job.org se `/api/agents/cron` está cadastrado.

## Andamento

Em 27/11/2026 você pediu as Fases 0 a 2 de uma vez ("Fazer 0 a 2 direto"), com as decisões recomendadas. As Fases 3 a 6 continuam esperando.

### Fase 0 — Ligar o que já existe

- **O motor** (`src/lib/agents/motor.ts`) passou a rodar dentro do `/api/automations/cron`, que o cron-job.org já chama. Ele usa até 22 s de cada chamada.
  - Ordem: pulso, aprovações vencidas, rondas e fila.
  - `/api/agents/cron` continua funcionando e chama o mesmo motor.
  - Uma aprovação que vence agora encerra a tarefa. Antes, a tarefa ficava parada para sempre.
- **Aviso de motor parado** nas abas Trabalhando, Rondas e Aprovações, quando ele não roda há mais de 10 minutos.
- **Memória no WhatsApp** (`src/lib/ai/auto-reply.ts`):
  - antes de responder, o agente lê o que a equipe sabe do cliente;
  - para guardar algo, escreve `[[LEMBRAR: …]]` no fim da resposta (`src/lib/agents/memory-marker.ts`). A linha é cortada antes do envio, e o cliente nunca a vê.
- **Aba Memória:** ver, procurar, corrigir e apagar o que os agentes sabem, e "Ensinar a equipe", uma regra que vale para todos.
- **Correção dos botões** Duplicar e Editar no cartão do agente (`d4eb4a1`).
- O selo de aprovações no menu ficou no PR do menu (`feat/menu-lateral`).

### Fase 1 — Ferramentas de verdade

- `src/lib/agents/loop.ts`: o agente trabalha a tarefa com ferramentas.
  - Uma chamada da IA por passo, no máximo 6 passos.
  - O andamento fica na própria tarefa. Se o tempo da chamada acaba, a tarefa continua na próxima.
- As 11 ferramentas estão em `src/lib/agents/ferramentas.ts`:
  - sem trava: ver_cliente, ler_conversa, buscar_memoria, guardar_memoria, chamar_pessoa;
  - com trava, pela regra de autonomia `decide()`: enviar_mensagem, atualizar_cliente, anotar, mover_negocio, criar_tarefa, agendar_retorno.
- O que precisa de OK vira cartão em Aprovações, com o detalhe montado pelo código. Aprovar executa exatamente aquilo (ou o texto que você editou), uma vez só, e o agente continua.
- Regras no envio:
  - uma mensagem por tarefa;
  - nada para quem pediu para não receber;
  - na API oficial e no Instagram, nada de texto livre fora da janela de 24 horas.
- **Teto de uso por agente:** 300 mil tokens nas últimas 24 horas (coluna `agents.daily_token_cap`). Quando passa, o agente pausa e a tarefa espera.
  - Ficou em tokens, não em dólares, porque o CRM não sabe o preço de cada modelo. O valor ainda não aparece na tela para editar.
- As tarefas de mensagem que já existiam (abordagem, follow-up, negociação…) passaram para o laço. Uma mensagem aprovada antes da mudança sai do jeito antigo.
- Marcar horário na agenda continua só na resposta do WhatsApp. O laço ainda não marca.

### Fase 2 — Rondas

- **Aba Rondas:** criar, editar, ligar e desligar rondas, com o histórico das últimas voltas.
- Tipos prontos (`src/lib/agents/rondas-catalogo.ts`):
  - conversas sem resposta;
  - lead novo sem primeiro contato;
  - orçamento parado;
  - cliente que sumiu;
  - compromisso de amanhã sem confirmação;
  - falta na agenda;
  - pós-venda.
- A procura é feita no banco (`src/lib/agents/rondas-checks.ts`). Ronda vazia não chama a IA.
- Filtros antes de passar um caso ao agente (`src/lib/agents/rondas.ts`):
  - opt-out;
  - o caso já está com o agente;
  - limite de 1 mensagem proativa por dia e 3 por semana (`agent_proactive_sends`);
  - o mesmo cliente uma vez por período de descanso;
  - no WhatsApp não oficial, só quem já conversou com a empresa **ou chegou como lead**. Quem preencheu formulário pediu contato, então não conta como mensagem fria.
- Mensagens de ronda pedem OK por padrão. A liberação é feita por ronda, no cartão.
- **Não feito:** a ronda do Gerente (metas do dia e alertas do Radar) e o Harpi oferecendo transformar um pedido repetido em ronda.

### Para ir ao ar

1. Aplicar `supabase/migrations/082_agentes_ativos.sql` no SQL Editor do Supabase.
2. Fazer o merge. Sem a 082, o motor e as rondas ficam quietos e o resto do CRM segue normal.

O que foi conferido e o que não foi está no PR.

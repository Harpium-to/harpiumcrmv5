# Plano: WhatsApp em dois caminhos, o cliente escolhe

Data: 9 de novembro de 2026. Status: **D1 feita (aguarda revisão e a migration 059); D2 a D5 por fazer**.

## Andamento (9 de novembro de 2026)

As decisões pendentes 1 a 4 e 6 seguiram as recomendações: servidor Uazapi da Harpium, Evolution só para a agência, envio em massa no não oficial com limites, um caminho por CRM, D1 primeiro. A 5 (preço) segue aberta.

**D1 feita**, na branch `worktree-whatsapp-dois-caminhos-d1`:

- **Migration 059** (`059_whatsapp_caminho.sql`):
  - `accounts.whatsapp_path`;
  - o histórico `whatsapp_path_log`, com a versão do texto de risco aceito;
  - um gatilho que impede o cliente de trocar o caminho sem passar pela tela.
- **Camada de canal** (`src/lib/channels/`):
  - `whatsapp-route.ts` decide a porta;
  - `unofficial-send.ts` envia pela Uazapi texto, mídia, áudio gravado, botões, listas e resposta citada;
  - inbox, API pública, fluxos, automações, agentes e IA passam por ela.
- **Entrada pela Uazapi**:
  - guarda mídia (copiada para o nosso storage, porque o link da Uazapi vale 2 dias) e toques em botões;
  - aciona fluxos, automações e IA, nas mesmas regras do webhook da Meta;
  - acompanha os eventos de conexão do celular.
- **Servidor da Harpium**: `UAZAPI_BASE_URL` e `UAZAPI_ADMIN_TOKEN` no Netlify. O cliente só lê o QR code.
- **Configurações › WhatsApp**:
  - tela de escolha com os dois caminhos e o aceite;
  - painel do QR code com Desconectar;
  - "Trocar caminho".
- **Canais**: o cartão do WhatsApp leva a Configurações. Uazapi com servidor próprio e Evolution só aparecem para a agência ou para quem já usa.
- **Console da agência**: mostra o caminho de cada CRM e avisa quando o celular desconecta.

O que ficou de fora da D1, e por quê:

- **A coluna em `messages` com o caminho de cada mensagem.** Escrever uma coluna nova em todo envio quebraria os envios enquanto a 059 não estiver aplicada. O histórico das conversas fica de qualquer jeito, e `whatsapp_path_log` diz quando o caminho mudou.
- **Texto numerado no lugar dos botões.** Os botões saem pelo menu da Uazapi. Só vale fazer o texto numerado se o teste num celular real mostrar que eles não aparecem.
- **Conversa nova pela Uazapi não dispara o evento `conversation.created` da API pública.** A Meta dispara.
- **CRM com os dois números ligados:** uma mensagem que chega pela Meta num CRM que escolheu o não oficial é guardada, e as respostas automáticas saem pelo número do QR code.

Falta testar com um número real:

- parear pelo QR code;
- mandar e receber foto, áudio e documento;
- tocar num botão;
- desligar o celular e ver o aviso no console.

## A ideia

Cada CRM escolhe como liga o WhatsApp:

- **Oficial:** a API da Meta. É o que já existe, com o Cadastro incorporado e a coexistência (ver `docs/plano-whatsapp-conexao-simples.md`).
- **Não oficial:** QR code pela Uazapi, como o WhatsApp Web.

Os recursos são os mesmos nos dois. Cada recurso é construído uma vez e funciona nos dois caminhos. Quando um caminho não permite algo, a tela explica o motivo em vez de esconder o recurso.

Isto muda a decisão 3 do plano de conexão simples ("nada de uazapi"). Lá, a Uazapi era só uma ponte até a Meta liberar. Aqui, ela vira uma opção de produto que o cliente escolhe de forma consciente.

Origem: comparação com a Waseller, uma extensão de Chrome que organiza o WhatsApp Web. Os recursos que faltam vieram dessa comparação.

## O que o cliente vê na hora de escolher

Em **Configurações › WhatsApp**, antes de conectar, aparecem dois cartões lado a lado.

| | Oficial (API da Meta) | Não oficial (QR code) |
|---|---|---|
| Como conecta | Janela do Facebook, uns 3 minutos | Lê um QR code, como o WhatsApp Web |
| Risco para o número | Nenhum | **Pode ser bloqueado pelo WhatsApp**, principalmente com envio em massa |
| Custo por mensagem | A Meta cobra os modelos (mensagens que a empresa inicia). Responder o cliente em até 24 h não tem custo | Nenhum por mensagem. Há uma mensalidade da conexão |
| Falar com quem não escreveu nas últimas 24 h | Só com modelo aprovado pela Meta | Livre |
| Celular | Continua no app WhatsApp Business (coexistência) | Continua normal |
| WhatsApp Web e a extensão | O WhatsApp Web é desconectado ao ligar (ver ressalvas) | Continuam funcionando |
| Postar status | Não existe na API oficial | Sim |
| Envio em massa | Por modelos aprovados | Livre, com limites de proteção |
| Celular precisa ficar ligado | Não | Sim, conectado à internet com frequência |

Para escolher o não oficial, o cliente marca uma caixa: "Entendo que o número pode ser bloqueado pelo WhatsApp". O aceite fica registrado com data, pessoa e versão do texto, no mesmo padrão do consentimento da agência (`AGENCY_CONSENT_TERMS_VERSION`).

Trocar de caminho depois é possível. O histórico fica, e cada mensagem guarda por onde saiu.

## Onde estamos hoje

O caminho oficial está completo:

- inbox com texto, mídia, áudio gravado, botões, listas e modelos;
- automações, fluxos, agentes de IA e envio em massa.

O caminho não oficial é só um cano de texto:

- O inbox só envia texto. Mídia dá erro ([src/app/api/whatsapp/send/route.ts](../src/app/api/whatsapp/send/route.ts)).
- Mídia recebida é ignorada ([src/lib/uazapi/parse.ts](../src/lib/uazapi/parse.ts)).
- Mensagem recebida é só salva. Não aciona fluxos, automações nem a IA, ao contrário do webhook da Meta ([src/app/api/whatsapp/webhook/route.ts](../src/app/api/whatsapp/webhook/route.ts)).
- Fluxos, automações, agentes e envio em massa só sabem enviar pela Meta ([src/lib/flows/meta-send.ts](../src/lib/flows/meta-send.ts), [src/lib/automations/meta-send.ts](../src/lib/automations/meta-send.ts)). Num CRM só com Uazapi, eles falham.
- Para conectar, o cliente precisa colar o endereço e a chave de um servidor Uazapi.
- A escolha do caminho é implícita: se a Uazapi está ativa, o inbox envia por ela, mesmo com a Meta configurada.

A extensão de Chrome só lê: mostra o contato, cria o lead, marca a temperatura e move o negócio.

Por isso a primeira fase é a fundação. Sem ela, cada recurso novo teria de ser feito duas vezes.

O que a Uazapi oferece (conferido em docs.uazapi.com, versão 2.6.9):

- texto, mídia (imagem, vídeo, áudio, documento), contato e localização;
- menu com botões, lista ou enquete;
- status;
- envio em massa com fila própria, intervalo entre envios e agendamento;
- histórico e download de mídia;
- limite de 10 chamadas por segundo por número.

## Como fica por dentro

**Um caminho por CRM, explícito.** Uma coluna nova em `accounts` guarda o caminho escolhido: `oficial`, `nao_oficial` ou vazio. Ela substitui a regra implícita de hoje.

**Uma camada de canal.** Todo envio passa por uma função só, que decide pelo caminho do CRM:

- inbox, fluxos, automações, agentes, agendados, sequências e envio em massa;
- ela estende o que [src/lib/channels/send-text.ts](../src/lib/channels/send-text.ts) já faz para o Instagram.

A camada oferece:

- enviar texto, mídia, menu, modelo (só no oficial) e status (só no não oficial);
- uma lista do que o caminho permite, que as telas usam para mostrar ou explicar cada recurso.

**Menus no não oficial.** Botões e listas saem pelo menu da Uazapi. Se o teste mostrar que não aparecem em todos os celulares, viram texto numerado ("responda 1, 2 ou 3"), e o fluxo entende o número como a escolha.

**A regra das 24 h no oficial.** O inbox já mostra o tempo que falta na janela. Agendamentos, sequências e lembretes passam a checar a janela na hora de enviar. Se ela fechou, o envio usa o modelo escolhido ou pausa e avisa o atendente.

**Servidor Uazapi da Harpium.** A Harpium contrata um servidor uma vez e guarda a chave no Netlify. O cliente só lê o QR code, como no oficial, em que a Harpium já fez o app da Meta. A tela atual, em que se cola endereço e chave, fica em "Configuração manual", só para a agência.

## Fases

Cada fase é aprovada antes de começar, como nas anteriores. As migrations começam na 059, porque a 058 está na branch do inbox.

### Fase D1: escolha do caminho e fundação

- Tela de escolha em **Configurações › WhatsApp**, com os dois cartões e o aceite de risco.
- Migration 059:
  - caminho do CRM em `accounts`;
  - registro do aceite;
  - coluna em `messages` com o caminho por onde cada mensagem saiu.
- Uazapi pelo servidor da Harpium:
  - o cliente só lê o QR code;
  - o webhook é configurado sozinho, como já acontece hoje.
- Camada de canal com texto, mídia e menu nos dois caminhos.
- O inbox passa a enviar mídia e áudio também pela Uazapi.
- Mensagem recebida pela Uazapi:
  - salva a mídia;
  - aciona fluxos, automações e a IA, como no webhook da Meta.
- Fluxos, automações e agentes passam a enviar pela camada de canal.
- O console da agência (W2) mostra o caminho de cada CRM e avisa quando o celular desconecta, isto é, quando o QR code precisa ser lido de novo.
- Se a decisão 2 for mantida, o cartão da Evolution sai da tela de Canais do cliente e fica só para a agência.
- Testes do caminho do servidor nos dois caminhos, simulando a Meta e a Uazapi.

**Pronto quando:** um CRM não oficial atende com IA, fluxo e automação, e envia e recebe áudio e foto, sem nada da Meta configurado.

### Fase D2: atendimento no inbox (os dois caminhos)

- **Assinatura do atendente:** o nome dele, em negrito, no começo da mensagem. Cada pessoa liga ou desliga, e o dono pode tornar obrigatório.
- **Respostas rápidas com mídia:** áudio, imagem, vídeo e documento salvos, enviados com 1 clique. Hoje elas só guardam texto e botões.
- **Sequência com 1 clique:** botão "Rodar fluxo" no painel do contato, para os fluxos com gatilho manual (esse gatilho já existe e não tem botão).
- **Agendar mensagem:** no composer, "enviar depois", com data e hora. Usa o agendador que já roda para automações e fluxos. No oficial, aplica a regra das 24 h.
- **Tarefas e lembretes de retorno:** para o atendente, ligados ao contato ou ao negócio. Aparecem no inbox, no quadro e nas notificações. Hoje só os agentes de IA têm tarefas.
- **Exportar contatos** pelo CRM do cliente. Hoje só a agência exporta.
- Migrations 060 e 061: mensagens agendadas, tarefas e mídia nas respostas rápidas.

### Fase D3: envio em massa e status

- **Agendar o envio em massa de verdade.** O passo "agendar" hoje envia na hora, e `scheduled_at` não é usado. Vale para os dois caminhos.
- **Envio em massa no não oficial:** texto ou mídia livres, pela fila da Uazapi, com limites que o cliente não desliga:
  - intervalo entre os envios;
  - teto por dia;
  - lista só de contatos que já conversaram ou que pediram para receber;
  - quem responder "SAIR" deixa de receber;
  - pausa automática se muitos envios falharem.

  O objetivo é proteger o número e quem recebe.
- **Postar status** (só no não oficial): texto, imagem ou vídeo, na hora ou agendado para a semana. No oficial, a tela explica que a Meta não permite.

### Fase D4: extensão de Chrome

A extensão nunca envia digitando no WhatsApp Web. Quando precisa enviar, ela pede ao CRM, que envia pela camada de canal. Assim, ela não cria risco novo.

- **Respostas rápidas:** escolher uma escreve o texto na caixa do WhatsApp Web, e a pessoa aperta Enter.
- **Rodar sequência:** o CRM envia pelo caminho do cliente.
- **Notas, tarefas e lembretes** do contato no painel.
- A tela de download da extensão diz onde ela se encaixa: no não oficial, sempre; no oficial, só se o WhatsApp Web continuar ligado (ver ressalvas).

### Fase D5: Google Agenda

- Conectar a agenda Google do atendente.
- Tarefas e lembretes com hora viram eventos.
- Um agendamento combinado na conversa cria o evento.

Vale para os dois caminhos.

## Ressalvas

- **Bloqueio do número no não oficial.** Os limites da D3 reduzem o risco, mas não o eliminam. O aceite registrado deixa claro que o cliente escolheu.
- **Termos da Meta.** A Harpium é Provedor de Tecnologia, e a análise do app está em andamento. Antes de lançar, confirmar se oferecer um caminho não oficial no mesmo produto conflita com os termos de Provedor de Tecnologia.
- **Coexistência e WhatsApp Web.** Ao conectar pela coexistência, o WhatsApp Web do número é desconectado. Falta testar se dá para religar depois. Se não der, a extensão não serve para clientes no oficial.
- **Celular ligado.** No não oficial, o número é um aparelho conectado. Se o celular ficar muito tempo sem internet, a conexão cai e é preciso ler o QR code de novo. Por isso o alerta no console da agência entra já na D1.
- **Custo da Uazapi.** O servidor é cobrado por número conectado e tem um teto de números. O preço do caminho não oficial precisa cobrir isso.
- **LGPD.** O envio em massa no não oficial só vai para quem já conversou ou pediu para receber, e o "SAIR" é obrigatório.

## Decisões pendentes

1. **Servidor Uazapi:** a Harpium contrata e repassa o custo (recomendado), ou cada cliente traz o seu?
2. **Evolution:** fica só para a agência, sem evoluir (recomendado), ou sai do produto?
3. **Envio em massa no não oficial:** oferecer com os limites da D3 (recomendado), ou não oferecer?
4. **Dois números no mesmo CRM**, um em cada caminho: não, um caminho por CRM no começo (recomendado), ou sim?
5. **Preço:** o não oficial é um plano à parte, mais barato?
6. **Ordem:** D1 primeiro (recomendado, porque tudo depende dela). Ou adiantar os itens da D2 que não dependem do canal (assinatura, tarefas, exportar)?

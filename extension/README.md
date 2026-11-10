# Harpium CRM — extensão do Chrome

Mostra o contato do CRM ao lado da conversa aberta no WhatsApp Web, e
cria o lead sem sair dali. (Até a versão 0.4 chamava-se "CRM
Connector"; a pasta do `.zip` continua `crm-connector` para o Chrome
reconhecer a atualização como a mesma extensão.)

## Instalar (sem empacotar)

1. Abra `chrome://extensions`.
2. Ligue **Modo do desenvolvedor**.
3. **Carregar sem compactação** e escolha esta pasta (`extension/`).
4. Clique em **Detalhes › Opções da extensão**.
5. Cole o endereço do seu CRM e a sua chave.

Cada pessoa gera a própria chave no CRM, em **Configurações › Extensão
do Chrome**; ela já vem com os escopos certos. Também serve uma chave
de **Configurações › API** com `contacts:read` e `contacts:write`; para
ver e mover negócios, também `deals:read` e `deals:write`; para as
respostas rápidas, `quick_replies:read`; para tarefas, `tasks:read` e
`tasks:write`; para a faixa da conversa e o Assumir,
`conversations:read` e `conversations:write`. Sem um deles o painel
funciona e só avisa que não tem acesso àquela parte.

## O que ela faz

Com uma conversa individual aberta no WhatsApp Web, o painel procura o
contato pelo telefone e mostra a ficha dele, com um link para abrir o
registro completo no CRM.

**Como acha o contato.** A busca compara só os dígitos (a formatação
com que o número foi salvo não importa) e aceita o celular brasileiro
com ou sem o nono dígito, porque o WhatsApp ainda identifica muitos
números pela forma antiga. Se o CRM tiver o mesmo número duas vezes, o
painel mostra os dois e pede para escolher. Se não houver cadastro,
oferece criar — usando o nome que o WhatsApp exibe, quando ele não é só
o próprio número — ou vincular a um contato que está no CRM com outro
número. Se o CRM responder com um contato de número só parecido (mesmos
últimos dígitos, outro DDD), o painel pergunta em vez de mostrá-lo.

**A ficha.** No topo, o nome, o número e a **temperatura** do lead
(Frio / Morno / Quente): um clique grava no CRM. O controle só aparece
quando o CRM já tem a migration 045. Abaixo, três abas; a que estiver
aberta continua aberta na próxima conversa. (A aba Tarefas está
descrita mais abaixo.)

- **Negócios** — os negócios em aberto do contato. Cada um tem a etapa
  do funil num seletor (trocar ali é o mesmo que arrastar o card no
  quadro) e pode ser fechado como **ganho** ou **perdido**; o negócio
  sai da lista e fica uma linha para **desfazer**. "Novo negócio" abre
  um formulário com título, valor, funil e etapa.
- **Notas** — as anotações da equipe sobre o contato, da mais recente
  para a mais antiga, com quem escreveu e quando, e um campo para
  escrever outra. Não são enviadas ao cliente.
- **Dados** — empresa, e-mail, potencial e etiquetas. "Editar contato"
  troca nome, e-mail, empresa e etiquetas; as etiquetas do CRM aparecem
  como sugestão e um nome novo é criado ao salvar.

Cada parte da ficha é redesenhada sozinha: mudar a temperatura ou a
etapa de um negócio não apaga uma anotação pela metade.

**Tarefas.** Uma tarefa é um lembrete sobre o contato, para uma pessoa:
"ligar na quinta".

- A aba **Tarefas** da ficha lista as tarefas em aberto do contato, da
  mais próxima para a mais distante, e tem o campo para criar outra,
  com data e hora opcionais. Marcar o círculo conclui; fica uma linha
  para desfazer.
- O botão **Tarefas** do rodapé abre **Minhas tarefas**: as tarefas em
  aberto da pessoa, de todos os contatos, com atalho para abrir a
  conversa. O número ao lado é quantas estão atrasadas ou são para hoje.
  Ele se atualiza a cada 5 minutos enquanto o WhatsApp Web está aberto.
- Na hora marcada, o CRM também avisa no sino (rotina no servidor).
- As mesmas tarefas aparecem na tela do contato no CRM.
- Precisa da migration 060 (tabela de tarefas e os escopos
  `tasks:read` e `tasks:write` na chave da extensão).

**A conversa no CRM.** No alto da ficha, uma faixa diz como a conversa
está no CRM, quando há o que dizer: a IA respondendo, o cliente
esperando um atendente (com o resumo que a IA deixou), ou com quem a
conversa está. **Assumir** pausa a IA naquela conversa e a atribui a
quem clicou — o mesmo que o botão do inbox. Devolver para a IA é feito
no CRM. Usa os escopos `conversations:read` e `conversations:write`
(migration 060); sem eles, a faixa simplesmente não aparece.

**Respostas rápidas.** O botão no rodapé do painel abre os textos
prontos do CRM (Configurações › Respostas rápidas), com busca pelo
título ou pelo texto. Um clique **coloca o texto no campo de mensagem
do WhatsApp** — depois do que já estiver digitado — e a pessoa aperta
Enter para enviar. A extensão não envia.

- `{{nome}}`, `{{primeiro_nome}}` e `{{empresa}}` são preenchidos com
  os dados do contato no CRM; sem cadastro, com o nome que o WhatsApp
  mostra. A lista já mostra o texto como ele vai sair.
- Uma variável sem valor é retirada, e o painel avisa qual faltou.
  Um nome que é só o número de telefone conta como sem nome.
- A mesma regra vale no inbox do CRM
  (`src/lib/quick-replies/variables.ts`; a cópia da extensão fica em
  `format.js` e um teste mantém as duas iguais).
- Só as respostas de texto aparecem: as interativas (botões, lista)
  são da API oficial e não cabem num campo de mensagem.
- Se o campo de mensagem não aceitar o texto, ele é copiado e o painel
  pede para colar.
- Precisa da migration 059, que dá à chave da extensão o escopo
  `quick_replies:read`. Sem ela, o painel diz isso.

**Funil.** O outro botão do rodapé abre o quadro do funil por cima do
WhatsApp, até a coluna do painel: uma coluna por etapa, com a
quantidade e a soma dos negócios em aberto.

- Um card muda de etapa **arrastando** para outra coluna ou pelo
  seletor no próprio card. Ele muda na hora e volta se o CRM recusar.
- "Abrir conversa" vai para a conversa do contato pelo link do próprio
  WhatsApp (`web.whatsapp.com/send?phone=…`). **A página recarrega.**
- Busca por negócio ou contato, e troca de funil quando há mais de um.
- Mostra até 300 negócios em aberto por funil e avisa quando há mais.
- Um negócio cuja etapa foi apagada aparece numa coluna "Sem etapa",
  de onde pode ser movido.
- Fechar: botão, ou Esc. Se algo foi movido, a ficha ao lado recarrega
  os negócios do contato.
- O quadro é um filho do painel com `position: fixed`: herda as cores e
  o isolamento de estilos, e os eventos de arrastar não saem dele (o
  WhatsApp escuta arrastos na página inteira para oferecer o envio de
  arquivo).
- Precisa do CRM com o contato embutido nos negócios da API
  (`contact` em `GET /api/v1/deals`). Com um CRM mais antigo os cards
  aparecem sem nome e sem "Abrir conversa".

### Conversas com `@lid`

O WhatsApp hoje identifica quase todas as pessoas por um código
(`@lid`) que **não é o telefone**. O painel pede o número ao próprio
WhatsApp (veja "Como ela sabe qual conversa está aberta"), que quase
sempre o tem. Quando não tem, usa o número do cabeçalho se o WhatsApp o
mostra (contato fora da agenda do celular). Quando nem isso, pede para
buscar o contato no CRM por nome ou telefone; a escolha fica **lembrada
neste navegador**, por conversa, e pode ser desfeita no próprio painel.
O painel também lembra se foi recolhido.

## Onde o painel fica

Numa coluna à direita, que **estreita o WhatsApp** em vez de cobrir a
conversa. O cabeçalho mostra o nome do CRM conectado. Recolhido, o
painel vira uma aba com a águia na borda direita e o WhatsApp volta à
largura inteira.

Para abrir a coluna, a extensão reduz a largura de `#app`, a raiz do
WhatsApp Web, e **confere se ela reduziu mesmo**. Se não reduziu (o
WhatsApp mudou a estrutura) ou se a janela tem menos de 1180px, o
painel flutua sobre o canto superior direito, como nas versões
anteriores.

A coluna é ligada por um atributo no `<html>` (`data-crmc-docked`), não
por uma classe: no WhatsApp Web real, classes desconhecidas no `<html>`
são apagadas na hora. A conferência mede a largura, sem depender da
marca, e se repete enquanto o painel está aberto: se a página desfizer
o encaixe, o painel repõe a marca uma vez e, se não adiantar, flutua.

O visual é o do CRM, não o do WhatsApp. Claro ou escuro acompanha o que
o WhatsApp está mostrando: o painel lê a cor de fundo que a página
pintou, sem depender dos nomes de classe dela (`theme.js`).

## O que ela não faz, e por quê

- **Não lê suas conversas.** Ela pergunta ao WhatsApp qual conversa
  está aberta e recebe o identificador e o número do contato. Nenhum
  texto de mensagem é lido, guardado ou enviado para lugar nenhum.
- **Não funciona em grupos.** Um grupo não tem um contato único para
  mostrar, então o painel diz isso em vez de escolher um participante.
- **Não envia mensagens.** As respostas rápidas param no campo de
  mensagem; quem envia é a pessoa, depois de ler.

## Como ela sabe qual conversa está aberta

Antes, a própria página dizia: cada mensagem carregava o
identificador da conversa no atributo `data-id`
(`false_5511999999999@c.us_3EB0…`). O WhatsApp reduziu esse atributo
ao código da mensagem, e hoje (novembro de 2026) **nada na página diz
com quem é a conversa**. Só o código do próprio WhatsApp sabe.

Por isso a extensão tem um arquivo, `page-bridge.js`, que roda no mesmo
ambiente do código do WhatsApp (`"world": "MAIN"` no manifesto) e
responde a uma única pergunta do painel: qual conversa está aberta? A
resposta é o identificador dela e, quando é um `@lid`, o número que o
WhatsApp tem para aquele contato. Esse arquivo:

- não tem acesso à chave nem ao CRM (não existe `chrome.*` ali);
- não lê mensagens, nomes nem a lista de conversas;
- é tratado pelo painel como dado não confiável: cada campo é validado
  (`chatFromPage`, em `chat-id.js`) e o que não for claramente um
  número é descartado.

A leitura antiga pelo `data-id` continua como reserva, para versões do
WhatsApp que ainda o preencham.

## Onde fica a chave

Em `chrome.storage.local`, lida apenas pelo service worker. O script
que roda dentro do WhatsApp Web **nunca** recebe a chave: ele pede
dados por mensagem e recebe dados de volta. Por padrão o Chrome deixa
content scripts lerem `storage.local`; o service worker fecha esse
acesso ao iniciar (`setAccessLevel`), e o próprio painel guarda suas
preferências e vínculos também por mensagem.

Isso não é detalhe de arquitetura. Os scripts da extensão dividem a
página e o processo com tudo que o WhatsApp carrega; uma chave guardada ali —
numa variável, no DOM, no `localStorage` — fica ao alcance de quem
comprometer aquela página. E uma chave de API do CRM é acesso a todos
os clientes da empresa.

Pelo mesmo motivo a extensão não pede acesso a sites na instalação: ela
pede permissão para **um** endereço, o que você digitar nas opções.

## Quando o WhatsApp Web mudar

**O campo de mensagem.** As respostas rápidas entregam o texto ao
campo de mensagem como uma colagem, que é o que o editor do WhatsApp
escuta. Se ele deixar de aceitar, a extensão tenta o comando de inserir
texto do navegador e, por fim, copia o texto e pede para colar: a
função continua útil mesmo quebrada.

**Qual conversa está aberta.** `page-bridge.js` usa o registro interno de módulos do WhatsApp
(`require("WAWebChatCollection")`), que não é uma API pública. Se a
Meta mudar isso, o painel passa a dizer **"Não consegui identificar
esta conversa"** — com a conversa aberta — em vez de mostrar o contato
errado. É o sinal de que a extensão precisa ser atualizada; o conserto
fica em `page-bridge.js` (como perguntar) e `chat-id.js` (como validar
a resposta).

Essa escolha é deliberada. Mostrar o registro de um cliente ao lado da
conversa de outro é pior do que não mostrar nada — quem está lendo não
tem como perceber, e é assim que alguém é chamado pelo nome errado ou
recebe o preço errado.

## Ícones

A fonte é `docs/marca/harpium-crm-icon-1024.png`. Os de 128 e 48 são a
imagem inteira reduzida; os de 32 e 16 são recortados mais perto da
águia, para ela continuar legível na barra do Chrome:

```bash
sips -z 128 128 docs/marca/harpium-crm-icon-1024.png --out extension/icons/icon-128.png
sips -c 780 780 --cropOffset 110 122 docs/marca/harpium-crm-icon-1024.png --out /tmp/aguia.png
sips -z 32 32 /tmp/aguia.png --out extension/icons/icon-32.png
```

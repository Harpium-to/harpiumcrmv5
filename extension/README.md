# CRM Connector

Extensão de Chrome que mostra o contato do CRM ao lado da conversa
aberta no WhatsApp Web, e cria o lead sem sair dali.

## Instalar (sem empacotar)

1. Abra `chrome://extensions`.
2. Ligue **Modo do desenvolvedor**.
3. **Carregar sem compactação** e escolha esta pasta (`extension/`).
4. Clique em **Detalhes › Opções da extensão**.
5. Cole o endereço do seu CRM e uma chave de API.

A chave é gerada no CRM em **Configurações › API**, e precisa dos
escopos `contacts:read` e `contacts:write`. Para ver e mover negócios,
também `deals:read` e `deals:write` — sem eles o painel funciona e só
avisa que não tem acesso a negócios.

## O que ela faz

Com uma conversa individual aberta no WhatsApp Web, o painel procura o
contato pelo telefone e mostra nome, empresa, email e etiquetas, com um
link para abrir o registro completo. A busca compara só os dígitos (a
formatação com que o número foi salvo não importa) e aceita o celular
brasileiro com ou sem o nono dígito, porque o WhatsApp ainda identifica
muitos números pela forma antiga. Se o CRM tiver o mesmo número duas
vezes, o painel mostra os dois e pede para escolher. Abaixo dos dados fica a
**temperatura** do lead (Frio / Morno / Quente): um clique grava no
CRM. O controle só aparece quando o CRM já tem a migration 045 — antes
dela não existe onde gravar. Embaixo, os **negócios em aberto** do
contato, cada um com a etapa do funil num seletor: trocar a etapa ali
é o mesmo que arrastar o card no quadro. Se não houver cadastro, oferece
criar — usando o nome que o WhatsApp exibe, quando ele não é só o
próprio número — ou vincular a um contato que está no CRM com outro
número. Se o CRM responder com um contato de número só parecido (mesmos
últimos dígitos, outro DDD), o painel pergunta em vez de mostrá-lo.

### Conversas sem número (`@lid`)

O WhatsApp está passando a identificar parte das conversas por um código
(`@lid`) que não é o telefone. Nelas, o painel usa o número do
cabeçalho quando o WhatsApp o mostra (contato fora da agenda do
celular). Quando não mostra, o painel pede para buscar o contato no CRM
por nome ou telefone; a escolha fica **lembrada neste navegador**, por
conversa, e pode ser desfeita no próprio painel. O painel também lembra
se foi recolhido.

## O que ela não faz, e por quê

- **Não lê suas conversas.** Ela extrai um número de telefone do chat
  aberto. Nenhum texto de mensagem é lido, guardado ou enviado para
  lugar nenhum.
- **Não funciona em grupos.** Um grupo não tem um contato único para
  mostrar, então o painel diz isso em vez de escolher um participante.
- **Não envia mensagens.** Para isso já existe a caixa de texto do
  WhatsApp, logo ali.

## Onde fica a chave

Em `chrome.storage.local`, lida apenas pelo service worker. O script
que roda dentro do WhatsApp Web **nunca** recebe a chave: ele pede
dados por mensagem e recebe dados de volta. Por padrão o Chrome deixa
content scripts lerem `storage.local`; o service worker fecha esse
acesso ao iniciar (`setAccessLevel`), e o próprio painel guarda suas
preferências e vínculos também por mensagem.

Isso não é detalhe de arquitetura. O content script divide a página e
o processo com tudo que o WhatsApp carrega; uma chave guardada ali —
numa variável, no DOM, no `localStorage` — fica ao alcance de quem
comprometer aquela página. E uma chave de API do CRM é acesso a todos
os clientes da empresa.

Pelo mesmo motivo a extensão não pede acesso a sites na instalação: ela
pede permissão para **um** endereço, o que você digitar nas opções.

## Quando o WhatsApp Web mudar

O painel identifica a conversa pelo atributo `data-id` das mensagens,
que carrega o identificador interno do WhatsApp (`...@c.us`) em vez de
depender de nomes de classe gerados. É o sinal mais estável disponível,
mas não é um contrato: se a Meta mudar, o painel passa a dizer "abra
uma conversa individual" em vez de mostrar o contato errado. Um id
`@lid` nunca é tratado como telefone (veja acima).

Essa escolha é deliberada. Mostrar o registro de um cliente ao lado da
conversa de outro é pior do que não mostrar nada — quem está lendo não
tem como perceber, e é assim que alguém é chamado pelo nome errado ou
recebe o preço errado.

## Ícones

`icons/icon.svg` é a fonte; os PNGs (16, 32, 48, 128) são exportados
dele, porque o Chrome não aceita SVG como ícone de extensão.

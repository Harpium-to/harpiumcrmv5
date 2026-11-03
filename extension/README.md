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
escopos `contacts:read` e `contacts:write`.

## O que ela faz

Com uma conversa individual aberta no WhatsApp Web, o painel procura o
contato pelo telefone e mostra nome, empresa, email e etiquetas, com um
link para abrir o registro completo. Se não houver cadastro, oferece
criar — usando o nome que o WhatsApp exibe, quando ele não é só o
próprio número.

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
dados por mensagem e recebe dados de volta.

Isso não é detalhe de arquitetura. O content script divide o contexto
da página com todo script que o WhatsApp carrega; uma chave guardada
ali é legível por qualquer um deles — e uma chave de API do CRM é
acesso de leitura a todos os clientes da empresa.

Pelo mesmo motivo a extensão não pede acesso a sites na instalação: ela
pede permissão para **um** endereço, o que você digitar nas opções.

## Quando o WhatsApp Web mudar

O painel identifica a conversa pelo atributo `data-id` das mensagens,
que carrega o identificador interno do WhatsApp (`...@c.us`) em vez de
depender de nomes de classe gerados. É o sinal mais estável disponível,
mas não é um contrato: se a Meta mudar, o painel passa a dizer "abra
uma conversa individual" em vez de mostrar o contato errado.

Essa escolha é deliberada. Mostrar o registro de um cliente ao lado da
conversa de outro é pior do que não mostrar nada — quem está lendo não
tem como perceber, e é assim que alguém é chamado pelo nome errado ou
recebe o preço errado.

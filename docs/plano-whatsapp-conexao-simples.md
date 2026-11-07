# Plano: conectar o WhatsApp do cliente em 1 clique

Data: 6 de novembro de 2026. Status: **aprovado; W0 quase concluída, W1 em teste**.

## Andamento (7 de novembro de 2026)

- **W0.1 Verificação da empresa:** aprovada como LUMA PUBLICIDADE E MARKETING DIGITAL LTDA, com o site harpium.com.br.
- **W0.2 Provedor de Tecnologia:** feito, como Provedor de Tecnologia independente.
- **W0.3 Análise do app:** ainda não enviada. Faltam o ícone do app e dois vídeos:
  - o CRM enviando uma mensagem e ela chegando no WhatsApp;
  - a criação de um modelo de mensagem.
- **W0.4 Configuração do Cadastro incorporado:** "Harpium CRM ES" (`config_id` 29648413238084719, token que não expira). Domínio liberado no SDK: https://harpium-crm.netlify.app.
- **W1:** código pronto na branch `feat/whatsapp-cadastro-incorporado`. Para ligar no servidor:
  - `META_EMBEDDED_SIGNUP_CONFIG_ID`;
  - opcional, `META_WEBHOOK_VERIFY_TOKEN`.
- **Teste real:** até a análise do app ser aprovada, só pessoas com função no app conseguem usar o botão. O teste precisa de um número que receba SMS e não esteja em uso no WhatsApp.

## O problema

Para ligar o número de teste da Harpium, fizemos dez etapas:
- criar o app;
- gerar o token no usuário do sistema;
- copiar IDs;
- configurar as variáveis no Netlify;
- inventar o token de verificação;
- configurar o webhook;
- publicar;
- registrar com PIN;
- sincronizar modelos;
- mandar o primeiro modelo.

Nenhum cliente faz isso.

## A solução: o "Cadastro incorporado" da Meta (Embedded Signup)

É o caminho oficial que plataformas como a Wati usam. No CRM, o cliente vê um botão:

> **Conectar WhatsApp** → abre uma janela do Facebook → o cliente entra com a conta dele, digita o número, confirma o código que chega por SMS (ou no próprio app WhatsApp Business) → pronto.

São uns 3 minutos, sem ID, sem token, sem webhook e sem PIN.

### Quem faz o quê

| Etapa de hoje | Depois |
|---|---|
| Criar app, webhook, chave secreta, publicar | **Feito uma vez pela Harpium.** O app "Harpium CRM" já existe e serve a todos os clientes. |
| Token, ID do número, ID da conta | Automático: a Meta devolve ao CRM no fim da janela. |
| Token de verificação | Some para o cliente: passa a ser um só da Harpium, guardado no servidor. |
| Assinar o webhook na conta do cliente | Automático. |
| Registrar o número com PIN | Automático: o CRM gera e guarda o PIN. |
| Sincronizar modelos | Automático, logo após conectar. |
| Forma de pagamento das mensagens | O cliente cadastra o cartão dele na Meta. A própria janela orienta. |

O webhook do CRM já separa cada cliente pelo ID do número. Por isso **um app atende todos os CRMs**, sem nada novo por cliente.

## Fases

### Fase W0: liberar a Harpium na Meta (você, com a minha ajuda no Chrome)

Só a Meta pode liberar. O prazo varia de alguns dias a algumas semanas.

1. **Verificar a empresa** "BM - Harpium". Hoje ela aparece como "Empresa não verificada". É preciso o CNPJ, o site e um documento com o mesmo nome e endereço.
2. **Tornar-se Provedor de Tecnologia** no app Harpium CRM (menu *Torne-se um Provedor de Tecnologia*).
3. **Análise do app:** pedir acesso avançado a `whatsapp_business_management` e `whatsapp_business_messaging`. A Meta pede um vídeo curto mostrando o uso. Eu preparo o roteiro e as telas.
4. **Criar a configuração do "Login do Facebook para Empresas"** do tipo Cadastro incorporado (versão 4, a atual). Ela gera um `config_id` que vai para o Netlify.

Até concluir a verificação, a Meta limita a 10 clientes novos por semana. Depois, sobe para 200.

### Fase W1: o botão no CRM (código)

- Em **Configurações › WhatsApp**, um cartão "Conectar com o Facebook" no lugar do formulário. O formulário atual fica escondido em "Configuração manual", só para a agência.
- Ao terminar a janela, o servidor faz sozinho:
  1. troca o código pelo token da empresa;
  2. salva o ID do número e o da conta;
  3. assina o app na conta do cliente;
  4. registra o número com um PIN gerado e guardado criptografado;
  5. sincroniza os modelos;
  6. roda o "Verificar com a Meta".
- O token de verificação do webhook vira um só, da Harpium (`META_WEBHOOK_VERIFY_TOKEN`). Hoje ele é guardado por cliente.
- A tela mostra só três coisas: o número conectado, o nome e o status (Conectado / Precisa de atenção, com o motivo em português e o que fazer). Há também um botão **Desconectar**.
- Testes automatizados para todo o caminho do servidor, simulando as respostas da Meta.

### Fase W2: a agência acompanha e convida

- Na ficha de cada CRM em `/agencia`: status do WhatsApp (conectado, número, última mensagem recebida).
- Um botão **"Enviar link de conexão"**: gera um link que o cliente abre logado no CRM dele e cai direto no botão Conectar. Dá para mandar pelo próprio WhatsApp.
- No modo suporte, a agência também pode conduzir a conexão numa chamada de vídeo com o cliente.

### Fase W3: continuar usando o app WhatsApp Business no celular (coexistência)

- O cliente conecta **o mesmo número que já usa** no app WhatsApp Business:
  - continua atendendo pelo celular;
  - as conversas também entram no CRM;
  - o histórico recente é importado.
- Ligamos isso com um parâmetro na mesma janela (`whatsapp_business_app_onboarding`).
- **Ressalvas:**
  - O número precisa estar em uso ativo no app há algum tempo, senão a Meta recusa.
  - Depois de ligado, o nome da empresa não muda mais.
  - Não achei a Meta confirmando oficialmente o Brasil na lista. Fornecedores dizem que funciona. Testamos primeiro com um número da própria Harpium.

## Enquanto a Meta não libera

- **Agência faz por eles:** o cliente adiciona a Harpium como parceira no Gerenciador de Negócios dele, e nós fazemos o passo a passo de hoje. Funciona já, mas dá trabalho por cliente.
- **uazapi (QR code):** já existe no CRM, em Canais. É simples (escanear como o WhatsApp Web), mas **não é oficial**: há risco de bloqueio do número. Serve como ponte para clientes pequenos, não como padrão.

## Decisões para você

1. **Coexistência:** os clientes vão continuar usando o app WhatsApp Business no celular com o mesmo número (recomendado), ou terão um número só para o CRM?
2. **Pagamento à Meta:** cada cliente paga as mensagens com o cartão dele (recomendado, é o modelo de Provedor de Tecnologia), ou a Harpium paga e repassa? A segunda opção exige virar Parceira de Soluções, com linha de crédito na Meta.
3. **Ponte até a liberação:** usamos a uazapi para os primeiros clientes, ou esperamos a Meta?

## Fontes

- Meta, Embedded Signup: https://developers.facebook.com/docs/whatsapp/embedded-signup/
- Meta, Embedded Signup v4: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4-public-preview/
- Meta, changelog: https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog/
- Wati, conexão via Embedded Signup (pt-BR): https://support.wati.io/pt-BR/articles/11462961-como-conectar-seu-numero-do-whatsapp-ao-wati-via-embedded-signup-cloud-api

# Plano — link de conexão sem login e "Nova conversa" na caixa de entrada

Data: 25/11/2026.

## O que já existe

- **Link de conexão (hoje):** no painel da agência, o card do WhatsApp de cada cliente já tem "Enviar link pelo WhatsApp" e "Copiar link". O problema é que esse link só leva para Configurações › WhatsApp, então a pessoa precisa **ter login no CRM e ser administradora**. Quem cuida do Facebook da empresa costuma não ter login (o contador, o sócio, o "menino do marketing"), e aí o link não serve.
- **Google Agenda:** já tem um link que funciona **sem login** (`/conectar-google/<código>`). É o modelo que vou seguir.
- **Caixa de entrada:** a tela de mensagens já sabe que, fora da janela de 24h da API oficial, só dá para mandar **modelo aprovado**, e já tem o seletor de modelos. Também já existe a lógica que acha ou cria o contato e a conversa a partir de um telefone (é a mesma que a API e a Agenda usam). Falta só o botão e a janela para digitar o número.

## Fase A — link de conexão do WhatsApp sem login

**Como fica para o cliente:**
1. Ele recebe pelo WhatsApp: "Para ligar o WhatsApp da sua empresa ao CRM X, abra este link…".
2. O link abre uma página do Harpium CRM, **sem pedir login**, com o nome do CRM e a escolha "número que já está no WhatsApp Business do celular" ou "número novo".
3. Ele clica em "Conectar com o Facebook", faz a janela da Meta e vê "WhatsApp conectado ao CRM X". Pronto.

**Regras do link:**
- Vale por **7 dias** e **uma conexão só**. Depois de usado, ou se a agência gerar outro, para de funcionar.
- O código no link é aleatório. No banco fica só o hash dele, como nas chaves de API.
- O link só faz uma coisa: conectar o WhatsApp **oficial** daquele CRM. Não dá acesso a conversas, contatos nem nada mais.
- Se o CRM já tem WhatsApp conectado, a página avisa e pede confirmação antes de trocar.

**Onde gerar o link:**
- No **painel da agência**, no card do WhatsApp do cliente: os botões atuais passam a gerar o link novo.
- Dentro do **CRM**, em Configurações › WhatsApp, para administradores: "Mandar link para outra pessoa conectar".
- Nos dois lugares aparece se existe um link ativo, até quando ele vale e um botão para cancelar.

**O que muda por baixo:**
- Migration **081**: tabela de links de conexão com a conta, o hash, quem gerou, a validade, quando foi usado e se foi cancelado.
- Página pública `/conectar-whatsapp/<código>` e a rota que conclui a conexão com o código. A rota reaproveita a mesma lógica do botão de dentro do CRM, então o resultado é idêntico (coexistência, importação do celular, registro do número).
- Limite de tentativas por IP, como no link do Google.
- Testes da validade, do uso único, do cancelamento e de link de outro CRM.

**Fica de fora:** o caminho por QR code (não oficial). Ele exige que alguém do CRM aceite o risco de bloqueio, e isso não combina com um link sem login.

## Fase B — "Nova conversa" na caixa de entrada

**Como fica:**
1. Na caixa de entrada, um botão **"Nova conversa"** no topo da lista de conversas.
2. Abre uma janela com dois campos: **telefone** (com +55 já preenchido; aceita número com ou sem DDD e com ou sem 9) e **nome**, que é opcional.
3. Enquanto você digita, se o número ou o nome já for de um contato, ele aparece para você escolher, e não cria contato repetido.
4. Ao confirmar, a conversa abre na hora, pronta para escrever:
   - **WhatsApp por QR code:** escreve normalmente. Antes de abrir, o CRM confere se o número tem WhatsApp e avisa se não tiver.
   - **WhatsApp oficial:** como o contato nunca falou com a empresa, a Meta só deixa começar com um **modelo aprovado**. O seletor de modelos já abre sozinho. Quando a pessoa responder, a conversa fica livre por 24h.

**Regras:**
- A conversa nova fica com **quem abriu**, igual a quando você assume uma conversa, e respeita setores e transferência.
- Quem não tem acesso à caixa de entrada não vê o botão.
- O contato nasce com a origem **"Iniciado pela equipe"**, para não confundir os relatórios de leads.

**O que muda por baixo:**
- Uma rota nova que recebe o telefone e o nome, acha ou cria o contato e a conversa (com a lógica que já existe) e devolve a conversa.
- O botão e a janela na lista de conversas, com os textos em português.
- No caminho por QR code, a checagem de "número tem WhatsApp" pela UAZAPI.
- Testes da rota (telefone inválido, contato existente, sem WhatsApp conectado, sem permissão) e da janela.
- Não precisa de migration.

## Ordem e entrega

- Cada fase vira um PR separado. A **B** pode ir primeiro, porque não tem migration e é a que vocês vão usar no dia a dia.
- A Fase A precisa da migration 081 aplicada no Supabase antes do merge.
- Antes de cada merge eu pergunto "posso pôr no ar?".

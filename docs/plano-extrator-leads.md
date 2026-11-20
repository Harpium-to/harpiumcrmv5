# Plano: Extrator de leads, a ferramenta que monta listas de empresas para prospectar

Data: 17 de novembro de 2026. Status: **as quatro fases estão escritas e testadas, na branch `feat/extrator-leads`**. Falta aplicar a migration 073 em produção, montar a base de CNPJ, criar a conta do Google Maps e fazer o merge; tudo espera o OK do dono. Como usar e instalar: `docs/extrator-leads.md`.

## Andamento (17 de novembro de 2026)

O dono pediu as quatro fases de uma vez ("pode fazer todas as fases direto"). As recomendações da tabela "Decisões para você" foram seguidas.

- **Fase 0, trocada:** em vez da prova com números reais, o formato dos arquivos da Receita foi conferido com uma amostra do mês 2026-11 (o importador e os testes seguem essa amostra). A comparação de qualidade entre CNPJ e Maps fica para o primeiro uso real.
- **Fase 1, feita:**
  - cartão em Ferramentas, tela de nova extração com a contagem antes de extrair, resultado com a situação de cada linha, planilha;
  - base de CNPJ em banco separado (`supabase/cnpj-base/schema.sql`) e o importador mensal (`scripts/cnpj-base/importar.mjs`);
  - extração em fatias, tocada pela tela aberta e pelo agendador;
  - limite mensal por CRM e a página no painel da agência;
  - migration 073.
- **Fase 2, feita:** entrada silenciosa no recebimento universal (sem cartão e sem "lead recebido"), duplicados, "Completar dados vazios", lista de bloqueio alimentada pelo descadastro, selo de dado pessoal, termo de uso, conferência de WhatsApp pela UAZAPI, lista de ligação, filtro por origem na tela Leads e limpeza em 90 dias.
- **Fase 3, feita:** modo prospecção no disparo pelo QR code, com a subida de 20 a 80 por dia, horário comercial sem feriado, textos sorteados com "SAIR", só para quem tem WhatsApp, nunca duas vezes para o mesmo contato, freio automático, SAIR automático e, na resposta, cartão no funil, etiqueta `respondeu` e "lead recebido".
- **Fase 4, feita:** Google Maps pelo Outscraper, com os bairros como buscas separadas, filtros de nota, avaliações e site, custo estimado na tela, e a leitura do site da empresa (link de WhatsApp, e-mail e Instagram), com proteção contra endereços internos e respeito ao `robots.txt`.

### O que ficou diferente do plano

- **Painel da agência:** mostra o uso, o custo, o limite e os números de cada extração. As empresas extraídas não aparecem lá; ficam dentro do CRM, com o acesso que o dono deu.
- **Planilha:** sai em CSV, que o Excel abre. Não é `.xlsx`.
- **Horário da prospecção:** é o de Brasília, não o configurado em cada CRM. Os feriados são os nacionais, mais Carnaval e Corpus Christi; os estaduais e municipais não entram.
- **"Lead recebido" na resposta:** é assim que o Agent SDR entra (decisão 7): uma automação com o filtro de origem "Extrator · …" passa a conversa para ele. Nada entra no SDR sozinho.
- **Conferência de WhatsApp e prospecção:** só pela UAZAPI. A Evolution está parada e não foi ligada a isso.
- **Base aberta de locais (Overture, Foursquare):** não entrou. Continua em "Depois".
- **Número da migration:** ficou com a 073. Se o plano de Reuniões com IA for feito depois, ele passa para a 074.

### O que foi conferido e o que não foi

- **Conferido:**
  - testes automáticos: a migration 073 e a base de CNPJ num Postgres de teste, com as regras de acesso; os filtros; as fontes; a classificação de duplicados; a execução em fatias; o envio para o CRM; o ritmo e o freio da prospecção; o SAIR; a leitura de sites;
  - o importador lendo as primeiras linhas reais dos arquivos da Receita de 2026-11;
  - `tsc`, `eslint` e o build de produção;
  - as telas no navegador, com o CRM local.
- **Não conferido:**
  - a carga completa da Receita num projeto do Supabase de verdade (ela leva horas e precisa do projeto novo);
  - uma busca real no Outscraper (precisa da conta);
  - a conferência de números na UAZAPI de produção (`POST /chat/check`, conforme a documentação dela);
  - o caminho inteiro contra o banco de produção, porque a migration 073 ainda não foi aplicada.

### Depois de colocar no ar

1. Aplicar a migration 073 no Supabase do CRM.
2. Criar o projeto da base de CNPJ, rodar `schema.sql` nele e carregar um estado para testar (passo a passo em `docs/extrator-leads.md`).
3. Pôr `CNPJ_BASE_URL` e `CNPJ_BASE_KEY` no Netlify e fazer um deploy.
4. Num CRM de teste: aceitar o termo, extrair 50 empresas de uma atividade numa cidade, conferir os números, enviar 10 para o CRM e ver os contatos com a etiqueta da lista e sem cartão no funil.
5. Com um número de teste no QR code: prospectar 3 contatos seus, responder um deles e responder SAIR no outro.
6. Depois: a conta do Outscraper, `OUTSCRAPER_API_KEY` no Netlify e uma extração pelo Google Maps.

## O pedido

- Uma ferramenta nova em **Ferramentas**, ao lado do Quiz, com a mesma lógica do [Extrator de Leads](https://www.extratordelead.shop/) (GLEADS): escolher a fonte, filtrar e extrair o máximo de leads.
- Filtros por canal, tipo de empresa, pessoa física e região.
- Depois de extrair: virar lista de contatos no CRM e seguir para o envio em massa.
- Não precisa usar a mesma tecnologia do produto de referência, só a mesma lógica.

## O produto de referência

O que o site deles mostra hoje:

| Parte | Como é |
|---|---|
| Fontes (11) | Google Maps, Instagram, Facebook, LinkedIn, TikTok, CNPJ, OLX, Mercado Livre, Bing Places, iFood e grupos de WhatsApp |
| Filtros | Nicho ou palavra-chave, cidade, estado e país; no Maps, avaliação, número de avaliações, "tem telefone" e "tem e-mail"; no CNPJ, CNAE, porte, capital social e empresas recém-abertas |
| O que entrega | Nome, telefone, e-mail, WhatsApp, endereço, site, avaliação e redes sociais. No Instagram, seguidores de um perfil com o WhatsApp tirado da bio. No CNPJ, razão social, CNAE, telefone e sócios |
| Saída | Planilha Excel, webhook para n8n/Make/Zapier e um "ambiente de disparos" |
| Disparo | Pela Evolution API (não oficial), com intervalos aleatórios e rodízio entre vários números. O cliente monta o próprio servidor |
| Cobrança | Dois planos mensais de preço fixo, mais um "disparador" vendido à parte. O site não fala em limite de extrações |

**Como ele funciona por trás:** o próprio site se descreve como "ferramenta de scraping". Quase tudo é raspagem das páginas (Maps, Instagram, Facebook, LinkedIn, OLX, iFood). A única fonte oficial e aberta da lista é a base de CNPJ da Receita.

## Minha opinião

- **Dá para fazer, e o CRM já tem metade do caminho pronto:** recebimento de leads, etiquetas, disparo pelo QR code com limites e descadastro. O extrator é a peça que falta no começo desse caminho.
- **Não recomendo copiar as 11 fontes.** Recomendo duas que resolvem quase tudo, mais um complemento:
  1. **Base de CNPJ da Receita Federal.** É oficial, gratuita, pode ser guardada e tem os melhores filtros (atividade, cidade, porte, data de abertura).
  2. **Google Maps.** É onde o telefone das empresas locais está mais atualizado. Na maioria dos negócios pequenos, é o WhatsApp da empresa.
  3. **O site da própria empresa**, como complemento: o extrator visita o site e pega o link de WhatsApp, o e-mail e o Instagram.
- **Instagram, Facebook, LinkedIn, TikTok e grupos de WhatsApp ficam de fora.** São três motivos:
  - Esses dados são de **pessoas** (seguidores, membros, profissionais), não de empresas. É onde a LGPD pesa mais.
  - As regras dessas redes proíbem a coleta automática, e a Meta bloqueia e processa quem faz.
  - O CRM depende da Meta: o WhatsApp oficial, o canal do Instagram e o app "Harpium CRM", que está em análise. Raspar as redes dela a partir do mesmo sistema é pôr isso em risco.
- **O maior risco do projeto não é extrair, é enviar.** Mandar mensagem para quem nunca falou com a empresa é o que derruba número de WhatsApp. Por isso o plano tem um modo de envio próprio para contato frio, mais lento que o disparo de hoje.
- **Um aviso honesto sobre o Google Maps:** não existe forma de montar lista de contatos com dados do Maps que esteja dentro das regras do Google. Vale para a API oficial e para a raspagem. O mercado inteiro de extratores trabalha nessa área cinzenta. A decisão de entrar nela é sua (decisão 1).

## As fontes, lado a lado

Custos de novembro de 2026. O que está marcado como estimativa precisa ser conferido antes de fechar preço com cliente.

| Fonte | Como se acessa | O que traz | Custo | O que as regras permitem | Risco |
|---|---|---|---|---|---|
| **CNPJ da Receita** (recomendada) | Arquivos públicos, atualizados todo mês. Baixamos e montamos a nossa cópia | Razão social, nome fantasia, atividade (CNAE), endereço, porte, data de abertura, situação, telefone, e-mail e nome dos sócios (o CPF vem mascarado) | Zero por extração. Um servidor pequeno para a base: de US$ 10 a 25 por mês (estimativa) | Dado aberto do governo: pode baixar, guardar e reusar | **Baixo.** O ponto fraco é a qualidade do contato: muito telefone é do contador, é fixo ou está desatualizado |
| **Google Maps, por serviço de coleta** (recomendada, com ressalva) | Empresa terceira que raspa o Maps e entrega pronto (Outscraper, Apify) | Nome, telefone, endereço, site, categoria, avaliação e número de avaliações | De US$ 1 a 6 por mil empresas. A Outscraper dá 500 por mês grátis e cobra US$ 3 por mil | Os termos do Google proíbem raspar o Maps. Quem raspa é o fornecedor, mas quem encomenda somos nós | **Médio.** O fornecedor pode mudar de preço ou parar. O dado é de empresa e está público |
| Google Maps, pela API oficial | Places API do Google, com chave nossa | O mesmo | Mil buscas grátis por mês e depois US$ 35 por mil buscas. Cada busca traz até 20 empresas, o que dá perto de US$ 1,75 por mil empresas | A política do Google **proíbe guardar** nome, endereço e telefone fora do Google, e proíbe baixar em volume. Só o identificador do local pode ser guardado | **Médio.** É oficial, mas o uso como lista de contatos quebra a política. O Google pode suspender o projeto |
| **Site da empresa** (complemento) | O CRM abre o site que veio do Maps ou do CNPJ | Link de WhatsApp, e-mail e Instagram | Quase zero | Informação que a empresa publicou para ser encontrada. Respeitamos o `robots.txt` | **Baixo** |
| Base aberta de locais (Overture, Foursquare) | Arquivos gratuitos, de licença aberta | Nome, endereço, categoria e, em parte, telefone e site | Zero | Licença aberta, pode guardar | **Baixo**, mas a cobertura no Brasil é mais fraca que a do Google. Vale testar na Fase 0 |
| Instagram, pela API oficial | Consulta de um perfil profissional por vez, pelo @ | Nome, bio, site e número de seguidores. **Não traz telefone nem e-mail, não busca por nicho ou cidade e não lista seguidores** | Zero | Permitido, mas exige uma permissão no app da Meta | Não dá para mexer no app agora (está em análise). Fica para depois |
| Instagram, Facebook, LinkedIn e TikTok, por raspagem | Robôs que leem os perfis | Seguidores, bios, cargos | Variável | Proibido pelos termos das redes | **Alto.** Dado de pessoa física, bloqueio e risco para o app da Meta. **Fora do plano** |
| OLX, Mercado Livre e iFood | Raspagem | Vendedores e lojas | Variável | Proibido pelos termos | **Alto na OLX** (muito vendedor é pessoa física) e pouco útil nos outros dois, que não mostram telefone. **Fora do plano** |
| Grupos de WhatsApp | Entrar em grupos e copiar os membros | Telefones de pessoas | Zero | Proibido pelo WhatsApp | **Alto.** Dado pessoal sem base legal e banimento. **Fora do plano** |
| Buscas na web | API de busca | Sites de empresas | Variável | A API de busca do Bing foi encerrada em 2025 e a do Google está fechada para clientes novos. Só restam serviços de raspagem | Não compensa. O Maps e o CNPJ já cobrem |

**As duas fontes se completam:**

- O **CNPJ** dá volume e filtro fino: "todas as clínicas odontológicas de Goiânia abertas há menos de um ano".
- O **Maps** dá contato bom: o telefone que a empresa atende hoje, com a avaliação.
- A **Fase 0** mede isso com números reais antes de qualquer investimento.

## O que o CRM já tem e será reaproveitado

- **Ferramentas** (migration 072): a tela de cartões. O extrator vira o segundo cartão, ao lado de "Quiz e formulários".
- **Recebimento universal de leads** (`src/lib/leads`), o mesmo caminho que o Quiz usa:
  - cria ou atualiza o contato pelo telefone;
  - grava a origem, as etiquetas, os campos personalizados e uma nota com o histórico;
  - nunca troca um nome digitado no CRM e nunca apaga um dado com vazio.
- **Etiquetas como lista de contatos.** O CRM não tem uma tabela de "listas": o público de um disparo é escolhido por etiqueta. Cada lista do extrator vira uma etiqueta.
- **Checagem de duplicidade por telefone** (`src/lib/contacts/dedupe.ts`), que já entende o nono dígito e as formas diferentes de escrever o mesmo número.
- **Disparo pelo QR code** (migration 065): 200 envios por dia por CRM, um a cada 30 a 90 segundos, um disparo por vez e o aceite do risco de banimento.
- **Disparo pela API oficial:** os envios de modelo aprovado, com público por etiqueta.
- **Descadastro** (migration 066): contato marcado como "pediu para não receber" fica fora de todo envio automático.
- **Tarefas** (migration 060), para a lista de ligação.
- **Agendador** (o cron-job.org chamando o CRM): a extração roda em fatias, como as automações, porque o Netlify não deixa um pedido rodar por muitos minutos.
- **Painel da agência:** números em qualquer nível de acesso, conteúdo só com "leitura" ou "total", como no Quiz.

**O que precisa de ajuste no que já existe:**

- Hoje, todo lead que entra pelo recebimento universal **abre um cartão no funil e dispara o evento "lead recebido"**, que aciona automações e o Agent SDR.
- Com 500 leads frios de uma vez, isso encheria o funil e faria o robô escrever para todos na hora, sem respeitar o ritmo de envio.
- O recebimento ganha uma **entrada silenciosa**, usada só pelo extrator: grava o contato, o lead, a origem, as etiquetas e os campos, mas não abre cartão e não dispara o evento.
- O cartão no funil nasce quando o lead **responder**, pela regra de primeiro contato que o CRM já tem.

## Como fica para quem usa

> **Ferramentas › Extrator de leads › Nova extração** → escolhe a fonte → preenche os filtros → vê a prévia e a quantidade → extrai → marca os que quer → **Enviar para o CRM** como lista → **Prospectar** essa lista.

- **Lista de extrações:** nome, fonte, data, quantos encontrou, quantos eram novos, quantos já foram para o CRM e o uso do mês.
- **Resultado de uma extração:** uma tabela com filtros, onde cada linha já diz o que ela é:
  - **Novo**;
  - **Já é contato** (com o link para o contato);
  - **Já extraído antes**;
  - **Pediu para não receber**;
  - **Sem telefone**.
- **Botões do resultado:** Enviar para o CRM, Baixar planilha (CSV e Excel) e Criar lista de ligação.

### Filtros da tela

| Filtro | CNPJ | Google Maps |
|---|---|---|
| Nicho ou atividade | Por CNAE, com busca por palavra ("dentista" sugere os CNAEs certos) | Por palavra-chave e categoria |
| Região | Estado, cidade, bairro e CEP | Cidade, bairro ou raio em volta de um ponto |
| Tipo | Empresas, ou MEI e autônomos (ver "Pessoa física e LGPD") | Empresas |
| Porte | MEI, microempresa, pequeno porte e demais | Não tem |
| Data de abertura | "Abertas nos últimos 30, 90 ou 365 dias", ou um período | Não tem |
| Capital social | Faixa de valor | Não tem |
| Matriz ou filial | Sim | Não tem |
| Avaliação | Não tem | Nota mínima e máxima, e número de avaliações |
| Site | Não tem | Com site ou **sem site** (bom para quem vende site e tráfego) |
| Contato | Só com telefone, só celular, só com e-mail | Só com telefone, só celular |
| Quantidade | Máximo de resultados por extração | O mesmo |
| Sempre ligados | Só empresas ativas, e fora quem já é contato ou pediu para não receber | Fora quem já é contato ou pediu para não receber |

- **Só celular:** separa o celular do fixo pelo formato do número. Fixo quase nunca tem WhatsApp.
- **Tem WhatsApp:** antes do envio, o CRM confere se o número existe no WhatsApp, pelo número conectado por QR code (a confirmar na UAZAPI, na Fase 2). Mandar para número que não existe é um dos sinais que levam a banimento.

### O que cada lead traz

| Campo | CNPJ | Google Maps |
|---|---|---|
| Nome | Nome fantasia, ou a razão social | Nome do local |
| Telefone e e-mail | Os do cadastro | O telefone do perfil. O e-mail vem do site, quando houver |
| Endereço, cidade e UF | Sim | Sim |
| Atividade | CNAE principal | Categoria |
| CNPJ, porte, data de abertura e capital | Sim | Não |
| Avaliação e número de avaliações | Não | Sim |
| Site e Instagram | Do site da empresa, quando houver | Do perfil e do site |
| Responsável | Nome do sócio-administrador (sem CPF) | Não |

## Da extração ao envio

1. **Extrair.** O resultado fica numa área própria do extrator. Ainda não é contato do CRM, não aparece no funil e nada é enviado.
2. **Escolher.** A pessoa filtra, marca os que quer e dá um nome à lista, por exemplo "Dentistas Goiânia nov/26".
3. **Enviar para o CRM.** Cada linha marcada entra pelo recebimento universal, no formato Harpium Lead v1, em entrada silenciosa:
   - vira contato, com a etiqueta da lista e a etiqueta `extrator`;
   - ganha a origem "Extrator · CNPJ" ou "Extrator · Google Maps";
   - os dados extras viram campos personalizados (CNPJ, atividade, porte, avaliação);
   - uma nota registra a fonte, a busca usada e a data.
4. **Prospectar.** Três caminhos, e a pessoa escolhe um:
   - **WhatsApp pelo QR code**, no modo prospecção (os limites estão abaixo);
   - **Lista de ligação:** uma tarefa por lead para a equipe ligar. É o caminho de menor risco;
   - **Planilha**, para usar fora do CRM.
5. **Resposta.** Quando o lead responde:
   - o cartão é aberto no funil, pela regra de primeiro contato;
   - o lead recebe a etiqueta `respondeu`;
   - a conversa pode ser passada ao Agent SDR, se o CRM quiser (decisão 7).
6. **Saída.** Quem responder SAIR, PARE ou "não quero" é marcado como "pediu para não receber" na hora e entra na lista de bloqueio do CRM. Nunca mais é importado nem recebe disparo.

### Duplicados e origem

- **Como o extrator reconhece o mesmo lead:**
  - pelo telefone, com a mesma regra que o CRM já usa;
  - pelo CNPJ;
  - pelo identificador do local no Google;
  - pelo e-mail, quando não há telefone.
- **Quando o lead já é contato do CRM:**
  - aparece como "Já é contato" e vem desmarcado;
  - o padrão é não mexer nele;
  - a opção **Completar dados vazios** preenche só o que está em branco (site, cidade, CNPJ). Nome e origem não mudam.
- **Quando o lead já saiu em outra extração:** aparece como "Já extraído antes" e vem desmarcado.
- **Reenvio:** enviar a mesma linha duas vezes não cria dois contatos nem dois leads.
- **Origem:**
  - fica no lead ("Extrator · Google Maps") e no contato, se o contato ainda não tinha origem;
  - a primeira origem de um contato nunca é trocada, como já acontece hoje;
  - na tela **Leads**, a origem já aparece numa coluna. A Fase 2 acrescenta um filtro por origem, para os leads extraídos não se misturarem com os que chegam sozinhos;
  - a nota guarda a busca que trouxe o lead. Serve para responder "onde vocês conseguiram meu número?".

## Pessoa física e LGPD

Isto não é parecer jurídico. É o que a lei e a ANPD indicam hoje, em linguagem simples.

- **Dado de empresa não é dado pessoal.** CNPJ, razão social, endereço comercial, atividade e telefone da empresa ficam fora da LGPD. Esse é o terreno seguro do extrator.
- **Parte do que vem junto é dado pessoal**, mesmo numa base de empresas:
  - **MEI e empresário individual:** o nome é o da pessoa, e o telefone quase sempre é o celular dela;
  - **nome dos sócios;**
  - **e-mail com nome de pessoa** (`joao.silva@...`).
- **Dado público não é dado livre.** A LGPD deixa usar dado pessoal público, mas pede finalidade legítima, boa-fé e respeito aos direitos da pessoa. Pelo que foi noticiado, a ANPD já alertou que encontrar um dado na internet não autoriza qualquer uso (não li o texto original do alerta).
- **A base legal possível para prospectar é o legítimo interesse.** Ela se sustenta quando:
  - a oferta tem a ver com a **atividade profissional** de quem recebe;
  - quem envia se identifica;
  - a pessoa consegue sair na hora;
  - a empresa sabe dizer de onde veio o dado.

### O que dá para oferecer em "pessoa física"

| | O que é | Como entra na ferramenta |
|---|---|---|
| **Dá** | **Profissionais com atuação comercial pública:** MEI, autônomos e profissionais liberais com CNPJ ou perfil de empresa no Maps (dentista, advogado, corretor, eletricista) | Filtro "MEI e autônomos", com o selo **contém dado pessoal**. A oferta precisa ser sobre o trabalho da pessoa. Saída automática pelo SAIR. Origem e data guardadas |
| **Dá** | **Pessoas que deram o contato:** quiz, formulários, anúncios de cadastro, clientes antigos, planilha própria com consentimento | Não é o extrator. São o Quiz, a tela Leads e a importação de contatos, que já existem. Para vender ao consumidor final, é este o caminho |
| **Não dá** | Lista de consumidores por região, renda, idade ou interesse | Não existe fonte legal para isso. Quem vende essas listas vende dado vazado ou raspado |
| **Não dá** | Seguidores de um perfil do Instagram, membros de grupos de WhatsApp ou Facebook, e pessoas do LinkedIn | Dado pessoal sem base legal, e proibido pelas redes |
| **Não dá** | Busca por CPF ou telefone pessoal de sócios | A Receita não publica, e a ferramenta não vai buscar em outro lugar |

### Cuidados que já vêm na ferramenta

- **Mínimo necessário:** do sócio, só o nome do administrador, para a saudação. O CPF nunca é guardado, nem o mascarado.
- **Selo "contém dado pessoal"** em cada lead de MEI ou autônomo, e um aviso na hora de extrair.
- **Origem e data em cada lead.**
- **Lista de bloqueio por CRM:** quem pediu para sair não volta em nenhuma extração nova, mesmo que o contato seja apagado.
- **Prazo de guarda:** resultado de extração que não foi para o CRM é apagado em 90 dias.
- **Papéis:** o cliente dono do CRM decide prospectar e responde por isso (controlador). A Harpium opera a ferramenta (operadora). O termo de uso da ferramenta diz isso em uma tela, aceita uma vez por CRM.
- **Cadastros de bloqueio de telemarketing:** alguns estados têm cadastro do Procon para quem não quer receber oferta. Vale para pessoa física e precisa ser conferido por estado antes de uma campanha grande.

## Risco de bloqueio do número no envio

### Pela API oficial do WhatsApp

- **A regra do WhatsApp exige que a pessoa tenha aceitado receber mensagens** da empresa. Lista extraída não tem esse aceite.
- Além disso, o primeiro contato precisa ser um **modelo aprovado**, cobrado como marketing: perto de R$ 0,32 por mensagem entregue no Brasil (fontes de terceiros, tabela de outubro de 2026).
- Conta nova começa limitada a 250 pessoas diferentes por dia (segundo guias de terceiros). Bloqueios e denúncias de quem recebe derrubam a nota de qualidade do número e reduzem esse limite.
- **Recomendação: não disparar lista fria pela API oficial.** Nos CRMs que usam a oficial, o extrator entrega a lista de ligação e a planilha, e mostra esse aviso. Nenhuma configuração do app da Meta muda.

### Pelo QR code (UAZAPI)

Não existe regra oficial de quantidade, porque esse uso já é fora das regras do WhatsApp. O que derruba um número é volume, ritmo de máquina, mensagens iguais, muita gente bloqueando e número novo mandando muito.

O disparo de hoje (200 por dia, um a cada 30 a 90 segundos) foi pensado para contatos que já conhecem a empresa. Para contato frio, proponho um **modo prospecção**, mais conservador:

| Regra | Modo prospecção (contato frio) | Disparo de hoje (para comparar) |
|---|---|---|
| Limite por dia | Semana 1: 20. Semana 2: 40. Semana 3: 60. Da semana 4 em diante: até 80 | 200 |
| Intervalo entre envios | De 60 a 180 segundos, sorteado | De 30 a 90 segundos |
| Horário | Segunda a sexta, das 9h às 18h, no horário do CRM. Sem feriado | Qualquer horário |
| Texto | No mínimo 3 variações, sorteadas, com o nome da empresa. Primeira mensagem curta, sem link e sem mídia | Um texto só |
| Identificação | Quem é, por que está escrevendo e "responda SAIR para não receber mais" | Não exige |
| Número conferido | Só envia para número que existe no WhatsApp | Não confere |
| Freio automático | Pausa a campanha se o número desconectar, se mais de 10% dos envios falharem ou se, depois de 30 envios, ninguém tiver respondido | Só o botão Parar |
| Quem pediu para sair | Marcado automaticamente pelo SAIR | Marcado à mão |
| Soma com outros disparos | O total do dia (prospecção mais disparo normal) não passa de 200 | 200 |

- **Um número só para prospecção.** A recomendação mais importante: não prospectar pelo número de atendimento. Se o número cair, o atendimento continua de pé.
- **Número novo aquece antes:** nos primeiros dias, só conversas normais. A subida de 20 para 80 por dia começa depois disso.
- **O aceite do risco continua**, como no disparo de hoje, com um texto próprio para contato frio.
- **Sem rodízio de números** para multiplicar volume, como o produto de referência faz. É a prática que mais leva a banimento em cadeia.
- **Esses números são um ponto de partida conservador**, não uma garantia. Nenhum limite elimina o risco no QR code.

## Custos por extração

Estimativas de novembro de 2026, sem margem. O preço para o cliente é assunto seu e não entra neste documento.

| Etapa | Custo |
|---|---|
| Extração pelo CNPJ (nossa cópia da base) | Zero por extração. O servidor da base é custo fixo, de US$ 10 a 25 por mês (estimativa) |
| Extração pelo Maps, por serviço de coleta | De US$ 1 a 6 por mil empresas. Com e-mail incluído pelo fornecedor, de US$ 10 a 14 por mil |
| Extração pelo Maps, pela API oficial | Grátis até mil buscas por mês (até 20 mil empresas, se toda busca vier cheia). Depois, perto de US$ 1,75 por mil empresas |
| Complemento pelo site da empresa | Quase zero |
| Conferir se o número tem WhatsApp | Incluso no número conectado (a confirmar na UAZAPI) |
| Envio pelo QR code | Sem custo por mensagem |
| Envio pela API oficial | Perto de R$ 0,32 por mensagem de marketing. Não recomendado para lista fria |

**Exemplo:** 500 clínicas odontológicas de uma capital.

- Pelo CNPJ: custo zero.
- Pelo Maps, por serviço de coleta: de US$ 0,50 a 3.
- Envio em modo prospecção: a 80 por dia, a lista leva perto de sete dias úteis para sair, depois do aquecimento.

**Limite de uso:** cada CRM tem um teto de leads extraídos por mês, definido pela agência no painel. O custo do Maps é da conta da agência (decisão 6).

## Modelo de dados

Uma migration nova, com o próximo número livre na hora de escrever. Hoje é a 073, mas o plano de Reuniões com IA também prevê a 073: quem for aprovado primeiro fica com ela.

| Tabela | O que guarda |
|---|---|
| `lead_extractions` | Uma extração por linha: CRM, quem pediu, nome, fonte, filtros usados, situação (na fila, rodando, pronta, falhou, cancelada), os totais (encontrados, novos, já contatos, sem telefone) e o custo |
| `lead_extraction_results` | Um lead extraído por linha: a chave da fonte (CNPJ ou identificador do local), nome, telefone, tipo do telefone, se tem WhatsApp, e-mail, site, Instagram, endereço, atividade, os dados extras, o selo de dado pessoal, a situação de duplicidade e o contato e o lead que ele virou |
| `prospecting_blocklist` | A lista de bloqueio do CRM: telefones que pediram para sair, com a data e o motivo |
| `bulk_sends` (colunas novas) | O modo (normal ou prospecção), as variações de texto e a janela de horário |
| `accounts` ou configuração do CRM (colunas novas) | O teto mensal de extração e a data do aceite do termo de uso |

- **Acesso:** a equipe do CRM lê as extrações do próprio CRM. Toda gravação passa pelo servidor, depois de conferir que a pessoa é administradora. É o mesmo modelo do Quiz (072).
- **Agência:** vê os números em qualquer nível de acesso, e os leads só com "leitura" ou "total".
- **A base de CNPJ fica fora do banco do CRM.** São dezenas de milhões de empresas. Ela vai para um banco separado, só de leitura, atualizado uma vez por mês. O banco de produção do CRM não cresce nem fica lento por causa dela.
- **Migration segura:** pode ser aplicada antes ou depois do código e pode rodar mais de uma vez, como as outras.

## Fases

Cada fase vira um PR, com testes, `tsc`, `eslint` e build limpos. Merge e migration só com o seu OK.

### Fase 0. Prova das fontes, sem código no CRM e sem custo

- **Objetivo:** saber, com números, qual fonte entrega contato que presta, antes de construir.
- **Como:** 3 nichos em 2 cidades (por exemplo, clínicas, lojas de planejados e escritórios de contabilidade), nas cotas gratuitas de cada fonte.
- **O que medimos em cada fonte:**
  - quantas empresas vieram;
  - quantas têm telefone, e quantas têm celular;
  - quantas têm WhatsApp de verdade;
  - quantas se repetem entre as fontes.
- **O que deixa pronto:** uma tabela de uma página para você fechar as decisões 1 e 2.

### Fase 1. O extrator com a base de CNPJ

- **Ferramentas:** o cartão "Extrator de leads".
- **Nova extração:** a tela de filtros do CNPJ, com a contagem antes de extrair ("essa busca traz perto de 1.240 empresas").
- **Resultado:** a tabela, com a situação de cada linha (novo, já é contato, já extraído, sem telefone).
- **Exportação:** planilha em CSV e Excel.
- **Base de CNPJ:** a nossa cópia, em banco separado, com a rotina mensal de atualização.
- **Limite mensal por CRM** e os números no painel da agência.
- **Migration:** as tabelas de extração e de resultados.
- **O que deixa pronto:** extrair, filtrar e baixar a planilha. Ainda sem contato no CRM e sem envio.

### Fase 2. Da extração para a lista no CRM

- **Enviar para o CRM:** entrada silenciosa no recebimento universal, com etiqueta da lista, origem, campos e nota.
- **Duplicados:** as regras de "Já é contato", "Completar dados vazios" e reenvio.
- **Tela Leads:** o filtro por origem.
- **Lista de bloqueio** e o termo de uso da ferramenta.
- **Selo "contém dado pessoal"** e o filtro "MEI e autônomos", conforme a decisão 3.
- **Conferência de WhatsApp** dos números, pelo número conectado por QR code.
- **Lista de ligação:** uma tarefa por lead.
- **Limpeza:** apagar os resultados não usados depois de 90 dias.
- **O que deixa pronto:** extração vira lista de contatos no CRM, sem duplicar, com a origem registrada, pronta para a equipe ligar.

### Fase 3. Prospecção pelo WhatsApp (QR code)

- **Modo prospecção** no disparo: os limites, a subida por semana, o horário, as variações de texto e o freio automático.
- **SAIR automático:** a resposta marca o descadastro e alimenta a lista de bloqueio.
- **Resposta do lead:** cartão no funil, etiqueta `respondeu` e, se você quiser, passagem para o Agent SDR.
- **Relatório da campanha:** enviados, entregues, respostas, saídas e falhas.
- **CRM na API oficial:** o aviso e os caminhos sem disparo (ligação e planilha).
- **O que deixa pronto:** o caminho inteiro, da extração à conversa no funil.

### Fase 4. Google Maps e o complemento pelo site

- **Fonte Google Maps**, pelo caminho escolhido na decisão 1. Ela entra como um encaixe, para dar para trocar de fornecedor sem refazer a tela.
- **Filtros do Maps:** avaliação, número de avaliações, com e sem site, raio.
- **Complemento pelo site da empresa:** link de WhatsApp, e-mail e Instagram.
- **Custo por extração na tela**, antes de confirmar, e somado no painel da agência.
- **O que deixa pronto:** as duas fontes na mesma tela, com o mesmo caminho até o envio.

A Fase 4 pode vir antes da Fase 1, se o Maps for a sua prioridade (decisão 2).

### Depois

- **Extração recorrente:** "toda segunda, me traga as empresas abertas na semana em Goiânia", caindo direto numa lista.
- **Instagram pela API oficial:** completar o perfil de empresas (bio, site, seguidores), depois que a análise do app da Meta terminar.
- **Base aberta de locais**, se a Fase 0 mostrar que a cobertura no Brasil compensa.
- **Segundo número só para prospecção** nos CRMs que usam a API oficial.

## Decisões para você

| # | Decisão | Recomendação |
|---|---|---|
| 1 | **Google Maps: entrar ou não, e por qual caminho** | Entrar, por um serviço de coleta (Outscraper ou Apify), numa conta separada das contas Google da Harpium. **Alternativas:** a API oficial, que é barata mas tem a política contra guardar os dados; ou ficar só com o CNPJ, sem nenhuma área cinzenta |
| 2 | **Qual fonte primeiro** | CNPJ primeiro: risco baixo, custo zero por extração e já monta o caminho inteiro. O Maps entra na Fase 4. **Alternativa:** Maps primeiro, se a Fase 0 mostrar que o telefone do CNPJ é fraco demais |
| 3 | **Pessoa física** | Oferecer só "MEI e autônomos", com o selo de dado pessoal e a saída automática. Nada de consumidor final, seguidores ou grupos. **Alternativa:** só empresas, sem MEI |
| 4 | **Base de CNPJ: nossa cópia ou API paga** | Nossa cópia, num banco separado, de US$ 10 a 25 por mês. **Alternativa:** uma API paga com busca (cnpj.ws, CNPJá, Casa dos Dados), que começa mais rápido mas cobra por uso. Não consegui confirmar os preços delas nesta pesquisa |
| 5 | **Limites do modo prospecção** | De 20 a 80 por dia, com subida por semana, intervalo de 60 a 180 segundos e horário comercial. **Alternativa:** manter os 200 por dia de hoje, com mais risco |
| 6 | **Quem paga o Maps e qual o teto por CRM** | A conta da agência, com um teto mensal de leads por CRM, ajustável no painel |
| 7 | **Agent SDR nos leads extraídos** | Só depois que o lead responder, nunca na primeira mensagem. **Alternativa:** não usar o agente nesses leads |
| 8 | **Número de prospecção** | Recomendar um número só para isso em cada CRM, e avisar na tela quando o número for o de atendimento. **Alternativa:** exigir o número separado |
| 9 | **CRM na API oficial** | Sem disparo de lista fria. Só ligação e planilha |
| 10 | **Nome do sócio** | Trazer só o do administrador, para a saudação. **Alternativa:** não trazer nenhum |

## Limites e cuidados

- **Qualidade do telefone do CNPJ.** Muito cadastro traz o telefone do contador ou um fixo antigo. A Fase 0 mede isso, e o filtro "só celular" com a conferência de WhatsApp reduz o problema.
- **Google Maps traz até 60 resultados por busca.** Para passar disso, o extrator divide a cidade em bairros ou em palavras-chave. Na API oficial, cada divisão é uma busca cobrada.
- **Dependência do fornecedor do Maps.** Ele pode mudar de preço, piorar ou sair do ar. Por isso a fonte entra como encaixe.
- **Contas Google separadas.** Qualquer uso do Maps fica fora do projeto `harpium-crm` do Google, que está em verificação por causa da Agenda.
- **Nada muda no app da Meta.** O plano não pede permissão nova nem configuração nele.
- **CNPJ com letras.** Desde julho de 2026, a Receita emite CNPJ com letras e números para empresas novas. A base e os filtros precisam aceitar os dois formatos.
- **Reclamação e denúncia.** Mesmo com todos os limites, parte de quem recebe vai bloquear. O relatório da campanha mostra isso cedo, e o freio automático pausa.
- **Repositório público.** Este plano não tem preço de venda nem margem. O material comercial da ferramenta fica fora do repositório.
- **O que eu não consegui confirmar:**
  - os preços das APIs pagas de CNPJ (as páginas bloquearam a leitura);
  - o limite de 60 resultados na página oficial do Google (é o que a documentação costuma dizer, mas não achei o trecho);
  - o endereço exato da UAZAPI para conferir se um número tem WhatsApp;
  - a tabela oficial de preço da Meta em reais. Os valores vêm de terceiros.

## Fontes

- Produto de referência: https://www.extratordelead.shop/
- Google Maps Platform, preços: https://developers.google.com/maps/billing-and-pricing/pricing
- Places API, política de uso e de guarda dos dados: https://developers.google.com/maps/documentation/places/web-service/policies
- Places API, campos e faixas de preço: https://developers.google.com/maps/documentation/places/web-service/data-fields
- Places API, busca por texto: https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places/searchText
- Outscraper, preços (análise de terceiros): https://scrap.io/outscraper-pricing
- Apify, extrator do Google Maps: https://apify.com/compass/google-maps-extractor/pricing
- Receita Federal, consulta e dados do CNPJ: https://www.gov.br/pt-br/servicos/consultar-cadastro-nacional-de-pessoas-juridicas
- Arquivos mensais da Receita (projeto que documenta): https://github.com/jonathands/dados-abertos-receita-cnpj
- CPF mascarado dos sócios: https://docs.cnpj.ws/modelos-de-dados/socios
- CNPJ alfanumérico: https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/julho/receita-federal-gera-o-primeiro-cnpj-em-formato-alfanumerico
- APIs de CNPJ com busca: https://cnpj.ws/llms.txt e https://cnpja.com/api
- ANPD e raspagem de dados pessoais: https://www.tabnews.com.br/NewsletterOficial/anpd-alerta-que-web-scraping-de-dados-pessoais-viola-lgpd
- ANPD, guia de legítimo interesse: https://legismap.com.br/conteudos/artigos-e-noticias/anpd-lanca-guia-orientativo-sobre-legitimo-interesse
- Raspagem e bases legais na LGPD: https://jus.com.br/artigos/87950/web-sscraping-na-lei-geral-protecao-de-dados-pessoais
- Instagram, consulta de perfis profissionais (Business Discovery): https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/business-discovery
- Meta contra Bright Data (raspagem sem login): https://techcrunch.com/2024/01/24/court-rules-in-favor-of-a-web-scraper-bright-data-which-meta-had-used-and-then-sued
- WhatsApp, limites de envio: https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits
- WhatsApp, preço por mensagem no Brasil (terceiros): https://chatmaxima.com/pt-br/whatsapp-api-pricing/brazil/ e https://digisac.com.br/blog/preco-whatsapp-api-outubro-2026
- Fim da API de busca do Bing: https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement
- Base aberta de locais: https://docs.overturemaps.org/guides/places e https://foursquare.com/resources/blog/products/foursquare-open-source-places-a-new-foundational-dataset-for-the-geospatial-community/

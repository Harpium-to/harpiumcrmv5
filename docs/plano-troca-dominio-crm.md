# Plano — CRM em crm.harpium.com.br e LP em harpium.com.br/crm

Data: 25/11/2026. A Meta aprovou o app Harpium CRM, então a troca de domínio que estava parada pode começar.

## Onde estamos

| O quê | Hoje | Depois |
|---|---|---|
| CRM | harpium-crm.netlify.app | **crm.harpium.com.br** (o endereço antigo continua funcionando) |
| Landing page | crm.harpium.com.br (site Netlify `harpium-crm-lp`) | **harpium.com.br/crm** |
| Site da agência | harpium.com.br (site Netlify `harpium-site`, pasta local `harpiumgroup-site`) | igual, com a rota `/crm` a mais |

**Teste feito hoje:** com domínio próprio configurado, o endereço `.netlify.app` **não** é redirecionado pelo Netlify (testei no `harpium-site`: GET e POST respondem direto). Isso significa que tudo o que já aponta para `harpium-crm.netlify.app` continua funcionando depois da troca:
- os webhooks da Meta e da UAZAPI (de todas as contas já conectadas);
- as URLs de recebimento de leads que os clientes já usam;
- a API da plataforma usada pelo Agency OS;
- a extensão do Chrome.

Por isso a troca pode ser feita **sem mexer em nenhuma integração já existente**. O que muda é o endereço que as pessoas abrem no navegador.

## Fase 1 — LP em harpium.com.br/crm (sem tocar no CRM)

1. No `_redirects` do site da agência (`harpiumgroup-site`), adicionar um proxy:
   ```
   /crm    https://harpium-crm-lp.netlify.app/        200
   /crm/*  https://harpium-crm-lp.netlify.app/:splat  200
   ```
   A LP segue sendo publicada sozinha a partir do `main` (pasta `LP/`). O `harpium.com.br/crm` só mostra o que já está lá.
2. Em `LP/index.html`:
   - nas 4 linhas marcadas (canonical, og:url, og:image, twitter:image), trocar para `https://harpium.com.br/crm/`;
   - no link "Política de privacidade" do rodapé, apontar para `https://harpium.com.br/privacidade/`, que não muda nunca.
   Vai num PR pequeno para o `main`.
3. Publicar o `harpium-site` pelo CLI (`netlify deploy --prod`).
4. Conferir: `harpium.com.br/crm` e `/crm/` abrem a LP, os botões de WhatsApp e a tabela de preços funcionam, e a prévia do link (og) aparece certa.

Nessa fase o `crm.harpium.com.br` continua mostrando a LP. Nada quebra.

## Fase 2 — preparar o CRM (código, PR)

Um ajuste em `src/proxy.ts`: quem abrir **páginas** do CRM em `harpium-crm.netlify.app` é levado para `crm.harpium.com.br`, no mesmo caminho (redirecionamento 308).
- Vale só para GET de páginas, só nesse host exato. Ficam de fora:
  - `/api/*`: webhooks, leads, Agency OS e extensão continuam respondendo no endereço antigo;
  - os links de deploy preview (`<hash>--harpium-crm…`).
- O redirecionamento só liga quando `NEXT_PUBLIC_SITE_URL` aponta para outro host. Assim o PR pode ir para o `main` antes da virada sem mudar nada.
- **Por que isso é necessário:** depois da troca, o retorno do Google Agenda e os links de convite vão para o domínio novo. Quem continuasse logado no endereço antigo cairia na tela de login no meio do caminho.
- Vai com testes.

## Fase 3 — a virada (uma sessão de ~30 min, em horário calmo)

Na ordem:

1. **Netlify:**
   - tirar `crm.harpium.com.br` do site `harpium-crm-lp`;
   - adicionar o domínio ao site `harpium-crm` como domínio principal.
2. **Cloudflare (você):** o CNAME `crm` passa a apontar para `harpium-crm.netlify.app`, com o proxy desligado. Depois é esperar o Netlify emitir o certificado HTTPS. Durante esses poucos minutos, só o `crm.harpium.com.br` fica fora; o CRM segue no ar pelo endereço antigo.
3. **Netlify, variáveis do `harpium-crm`:**
   - `NEXT_PUBLIC_SITE_URL=https://crm.harpium.com.br`;
   - se `ALLOWED_INVITE_HOSTS` estiver preenchida, incluir o host novo e manter o antigo.
   Depois, um novo deploy de produção (cerca de 15 créditos).
4. **Supabase → Auth → URL Configuration:**
   - Site URL passa a ser o domínio novo;
   - em Redirect URLs, adicionar `https://crm.harpium.com.br/**` e manter as antigas.
5. **Meta (app Harpium CRM):**
   - em App Domains, adicionar `crm.harpium.com.br`;
   - em Login do Facebook para Empresas, adicionar o domínio novo em "Domínios permitidos para o SDK do JavaScript" e "URIs de redirecionamento do OAuth válidos", mantendo o antigo.
   - O webhook continua no `.netlify.app`, que segue funcionando. Trocar depois é opcional.
6. **Google Agenda:** no `_redirects` do `harpium-site`, o `/google/retorno` passa a mandar para `https://crm.harpium.com.br/api/google/oauth/callback`. No Google Cloud não muda nada.
7. **Conferir no domínio novo:**
   - login, inbox e envio de mensagem;
   - "Conectar WhatsApp" pelo cadastro da Meta;
   - "Conectar Google Agenda";
   - um convite de usuário;
   - abrir o endereço antigo e ver o redirecionamento;
   - um POST de teste num webhook antigo, que precisa responder sem redirecionar.

## Fase 4 — avisos e limpeza

- **Agency OS (APP Harpium):** trocar o endereço do CRM usado no "Abrir no CRM" e nos links para o domínio novo. A API continua funcionando no antigo, então não tem pressa.
- **Extensão do Chrome:** o endereço padrão nas opções passa a ser o novo. Quem já configurou o antigo segue funcionando.
- **Documentação:** atualizar os docs (`passo-a-passo-implantacao`, `plano-whatsapp-conexao-simples` etc.) e a memória do projeto.
- **Opcional, mais tarde:** passar o webhook da Meta e os das instâncias UAZAPI para o domínio novo.

## O que é seu e o que é meu

- **Você:** o CNAME no Cloudflare (Fase 3, passo 2) e aprovar cada fase. As telas do Supabase e da Meta eu faço pelo Chrome do MacBook Air, com o seu OK.
- **Eu:**
  - Fase 1 inteira;
  - PR da Fase 2;
  - na Fase 3, Netlify, variáveis, Supabase, Meta e `_redirects`;
  - na Fase 4, extensão e docs.

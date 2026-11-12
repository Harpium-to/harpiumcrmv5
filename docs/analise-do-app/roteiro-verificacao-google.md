# Verificação do app "Harpium CRM" no Google: roteiro e textos

Este é o passo G0.8 de `docs/plano-google-agenda.md`. Preparado em 12 de novembro de 2026, com a G1, a G2 e a G3 no ar.

Enquanto o app estiver em modo **Teste**:
- só as contas de teste conectam (a da agência e a pessoal do dono);
- a autorização vence a cada 7 dias.

Para liberar aos clientes, o Google precisa verificar o app. Só um escopo é **sensível**, o `calendar.events.owned`. Nenhum é restrito, então não há auditoria de segurança paga.

O Google não informa o prazo da análise.

## 0. Antes de começar

- [ ] **Logo do app:** em Google Auth Platform › Branding › Logotipo, envie um PNG quadrado de 120×120 px, com até 1 MB.
  - Dá para gerar a partir de `docs/analise-do-app/harpium-crm-icon-1024.png` com: `sips -Z 120 harpium-crm-icon-1024.png --out harpium-crm-icon-120.png`.
  - Com logo, o app passa a precisar de verificação de marca. Ela entra no mesmo envio.
- [ ] **Página inicial e política:** já configuradas. A página inicial é `https://harpium.com.br` e a política é `https://harpium.com.br/privacidade/`, com a seção "Dados do Google Agenda" e a frase de Uso Limitado. O domínio harpium.com.br já está verificado no Search Console.
- [ ] **Idioma do vídeo:** o Google exige a tela de consentimento **em inglês**. Antes de gravar, mude o idioma da conta Google de teste para English, ou abra a conexão com `&hl=en` no fim do endereço do Google.
- [ ] **Conta de teste:** use uma conta de teste com alguns compromissos no Google Agenda (um almoço, uma reunião) para mostrar que eles aparecem no CRM.
- [ ] **Gravação:** QuickTime › Nova Gravação de Tela, ou Cmd+Shift+5. Envie o vídeo ao YouTube como **Não listado** e guarde o link.

## 1. Publicar e pedir a verificação

1. Em **Google Auth Platform › Público-alvo**, clique em **Publicar app** para passar de "Teste" para "Em produção".
   - A partir daí, qualquer conta Google consegue conectar, mas vê o aviso "O Google não verificou este app" até a verificação sair.
   - Antes da verificação, o Google limita o app a 100 contas novas no total, para sempre. Por isso, faça o pedido logo em seguida e não espalhe o link aos clientes antes da aprovação.
2. Em **Central de verificação**, clique em **Preparar para verificação** e preencha o formulário com os textos da seção 3.
3. Cole o link do vídeo da seção 2 e envie.

## 2. Vídeo de demonstração (de 2 a 3 minutos, em inglês)

O Google quer ver três coisas:
- a tela de consentimento com os escopos pedidos;
- o app usando cada escopo;
- o endereço do app e o ID do cliente OAuth na barra do navegador.

| # | Na tela | Legenda ou narração (inglês) |
|---|---|---|
| 1 | `harpium-crm.netlify.app`, Agenda aberta, logado como admin | *This is Harpium CRM, a customer service CRM for small businesses. Its Agenda books appointments for each professional.* |
| 2 | Agenda › engrenagem › editar a agenda › cartão "Google Agenda" › **Conectar com o Google** | *An admin connects a professional's Google Calendar to an agenda.* |
| 3 | Tela do Google: escolher a conta e mostrar a **tela de consentimento inteira**, em inglês, com "See, edit, create and delete events on calendars you own" e "See the list of Google calendars you're subscribed to". Deixar a barra de endereço visível, com `client_id=900921438655-…`. Clicar em **Continue**. | *The consent screen requests only what the feature needs: events on calendars the user owns, and their calendar list.* |
| 4 | De volta à Agenda: aviso "Google Agenda conectado". Mostrar o cartão com a conta e a agenda escolhida. Abrir **Trocar a agenda do Google** e mostrar a lista. | *The calendar list scope is used to let the admin pick which of the professional's calendars receives the appointments.* |
| 5 | Marcar um horário no CRM para um contato | *An appointment booked in the CRM…* |
| 6 | Abrir o Google Agenda da conta de teste e mostrar o evento "Consulta · Nome" | *…is created in the professional's Google Calendar (events.owned, write).* |
| 7 | Remarcar e depois cancelar no CRM, e mostrar o Google acompanhando | *Rescheduling and cancelling in the CRM update and delete the same event.* |
| 8 | Na Agenda do CRM, mostrar os blocos **"Ocupado (Google)"** que vêm dos compromissos da conta de teste. Abrir "Horários livres" e mostrar que esses horários não aparecem. | *Busy times already in the professional's Google Calendar show as "Busy (Google)" — start and end only, never the title — so the CRM, its AI assistant and its public booking page never offer those times (events.owned, read).* |
| 9 | Engrenagem › **Desconectar** a conta | *The admin can disconnect at any time; the CRM revokes the access and deletes the stored tokens and busy times.* |
| 10 | Abrir `https://harpium.com.br/privacidade/` na seção "Dados do Google Agenda" | *Our privacy policy explains what we access and store, and that our use complies with the Google API Services User Data Policy, including the Limited Use requirements.* |

## 3. Textos para o formulário (em inglês)

### Por que o app precisa dos escopos

> Harpium CRM is a customer service and sales CRM for small businesses in Brazil, operated by Harpium (LUMA PUBLICIDADE E MARKETING DIGITAL LTDA). Its Agenda feature books appointments for each professional of a business (for example, a doctor at a clinic). With the professional's consent, an agenda in the CRM is connected to that professional's own Google Calendar.
>
> **calendar.events.owned** — We create, update and delete, in the professional's own calendar, the appointments booked in the CRM (by the business's staff, by the business's AI assistant, or by customers through the business's public booking page), so the professional sees their schedule in Google Calendar. We also read the start and end times of the events on the calendars the professional owns, so the CRM never offers a time the professional is already busy; we store only start and end times (never titles, descriptions, locations or attendees) for the next 90 days. We never send invitations to anyone (sendUpdates=none, no attendees).
>
> **calendar.calendarlist.readonly** — We list the professional's calendars so the business admin can choose which calendar receives the appointments and which calendars count as busy.
>
> **openid, email** — We show which Google account is connected to each agenda.

### Por que não serve um escopo mais estreito

> calendar.app.created only covers secondary calendars created by the app, but professionals need the appointments in, and the busy times read from, the calendar they already use (usually their primary calendar). calendar.freebusy / calendar.events.freebusy only allow reading availability, but the feature must also create, update and delete events. calendar.events.owned is the narrowest scope that allows both on the calendars the user owns; we deliberately did not request calendar.events (all calendars the user can access) or calendar (full access).

### Como os dados são usados e protegidos

> Google user data is used only to provide the Agenda feature to the business that connected the account. Refresh and access tokens are stored encrypted (AES-256-GCM) and are only readable by our servers. Busy times are kept only for the window we display (90 days ahead) and are deleted when the account is disconnected. We do not sell Google user data, do not use it for advertising, do not use it to train AI models, and do not transfer it to third parties. Harpium staff do not read it except with the user's consent, for security, or to comply with the law. Users can disconnect from the CRM at any time or revoke access at myaccount.google.com/connections. Privacy policy: https://harpium.com.br/privacidade/

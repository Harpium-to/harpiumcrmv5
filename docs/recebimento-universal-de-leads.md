# Recebimento universal de leads

Uma URL recebe lead de qualquer origem (quiz, Google, Meta, Zapier, Make, formulários do site), traduz para o formato padrão da Harpium e **nunca descarta informação**: o que não tem campo próprio vira nota no contato, e o pacote original fica guardado.

Código: `src/lib/leads/` (`parse.ts` lê os formatos, `ingest.ts` grava, `receive.ts` é a URL, `events.ts` dispara o evento "lead recebido").

## A URL

```
POST /api/leads/ingest/<token>
POST /api/leads/ingest            (com Authorization: Bearer <token>)
```

- Aceita JSON e formulário (`application/x-www-form-urlencoded` e `multipart/form-data`). Chaves de formulário com colchetes ou ponto viram objeto: `contato[nome]`, `contato.telefone`, `etiquetas[]`, `respostas[0][pergunta]`.
- Até 100 KB por envio e 60 envios por minuto por token.
- O token principal da conta (em Leads) continua valendo. Com a migration 068, dá para criar **uma URL por origem** ("Quiz planejados", "Google Ads", "Zapier"), cada uma com botão de revogar. Lead que chega sem `origem` recebe o nome da URL como origem.

| Situação | Código | Corpo |
| --- | --- | --- |
| Lead gravado | 200 | `{"ok": true, "contato_id": "…", "lead_id": "…", "contato": "criado" \| "atualizado" \| null}` |
| Reenvio já recebido | 200 | o mesmo, com `"duplicado": true` |
| Faltou telefone e e-mail | 422 | `{"ok": false, "erro": "telefone_ou_email_obrigatorio", "lead_id": "…"}` (o lead fica guardado) |
| Formato ilegível | 400 | `{"ok": false, "erro": "formato_invalido"}` |
| Token errado ou revogado | 401 | `{"ok": false, "erro": "token_invalido"}` |
| Chave do Google errada | 401 | `{"ok": false, "erro": "chave_google_invalida"}` |
| Mais de 100 KB | 413 | `{"ok": false, "erro": "muito_grande"}` |
| Envios demais | 429 | `{"ok": false, "erro": "limite"}` + `Retry-After` |

`contact_id` continua na resposta 200 para integrações antigas.

## Formato padrão: Harpium Lead v1

Quem integra do zero (como o quiz) manda direto neste formato. Google, Meta e JSON genérico são traduzidos para ele.

| Campo | Obrigatório | Vai para |
| --- | --- | --- |
| `versao` = `"1"` | sim | identifica o formato |
| `origem` | recomendado | Origem do lead (`leads.source`, em slug) e do contato (só se vazio) |
| `id_externo` | recomendado | evita lead duplicado em reenvio (mesma origem, 24 h) |
| `contato.nome` | — | Nome (só troca nome vazio ou que era o telefone) |
| `contato.telefone` | telefone ou e-mail | Telefone, normalizado para +55DDD9XXXXXXXX (chave de duplicidade) |
| `contato.email` | telefone ou e-mail | E-mail |
| `contato.empresa`, `contato.cidade`, `contato.instagram` | não | colunas do contato |
| `contato.uf` | não | campo personalizado "UF", senão nota |
| `campanha` (objeto: `nome`, `conjunto`, `anuncio`, `utm_*`, `fbclid`, `gclid`) | não | Campanha do lead + nota |
| `etiquetas` | não | Etiquetas (criadas se não existirem) |
| `qualificacao` (`rota` A/B/C, `qualificado`, `pontuacao`, `motivos`) | não | etiqueta `rota-a`/`rota-b`/`rota-c` + nota |
| `respostas` (lista de `{pergunta, resposta}`) | não | nota |
| `campos` (chave → valor) | não | campo personalizado de mesmo nome (ou o de/para), senão nota |
| `nota` | não | nota |
| `consentimento` (`aceito`, `texto`, `em`) | recomendado | nota (LGPD); `aceito: false` não dispara fluxos |

Exemplo completo: ver "Formato Harpium Lead v1" na tela Leads, ou `src/lib/leads/parse.test.ts`.

## Regras de gravação

1. **Duplicidade.** Contato pelo telefone normalizado; sem telefone, pelo e-mail (sem telefone e sem contato com o mesmo e-mail, o lead fica sem contato, porque todo contato precisa de telefone).
2. **Nunca apagar com vazio.** Valor novo preenchido troca o antigo (e-mail, empresa, cidade, Instagram); vazio não apaga nada. O nome digitado no CRM nunca é trocado; a primeira origem do contato fica.
3. **Cada envio é um registro de lead** no histórico, mesmo com o contato já existente.
4. **Respostas viram nota**, com origem e data no topo e o id do lead no fim.
5. **Etiquetas** e a etiqueta da rota são aplicadas e criadas na hora.
6. **Campos personalizados** com a mesma chave (sem acento/maiúsculas: "Ticket médio" = `ticket_medio`). O resto vai para a nota. O **de/para por origem** (tela Leads, migration 068) escolhe outro destino: nota, ignorar, coluna do contato ou outro campo.
7. **Pacote bruto** guardado; botão "Ver dados recebidos" na lista.
8. **Reenvio não duplica** (mesmo `id_externo` da mesma origem em 24 h).

Google e Meta: colunas extras do formulário do Google e perguntas personalizadas do Meta viram `respostas`.

**Reprocessar** (tela Leads, administradores): passa os leads já guardados pelas regras de hoje. Só completa o contato (não sobrescreve), etiquetas e campos não duplicam, e a nota é escrita uma vez.

## Evento "lead recebido"

Depois de gravar (nunca num reenvio):

- **Webhook de saída** `lead.received` (ver `docs/public-api.md`).
- **Automações** com o gatilho "Lead recebido", filtrando por origem, rota e etiquetas obrigatórias. As mensagens podem usar `{{ vars.primeiro_nome }}`, `{{ vars.nome }}`, `{{ vars.empresa }}`, `{{ vars.origem }}`, `{{ vars.rota }}`. A conversa é aberta pelo telefone só quando alguma automação quer o lead.
- Passo **"Passar para agente de IA"**: entrega o contato ao Agent SDR (ou outra função) com as respostas do lead como briefing e uma instrução opcional. O agente abre a conversa no WhatsApp dentro do horário de trabalho dele.

Tudo respeita o "Pediu para não receber mensagens automáticas" (066) e o consentimento recusado.

Exemplos da tabela do plano, como automações:

| Gatilho "Lead recebido" com filtro | Passos |
| --- | --- |
| origem `quiz-planejados`, rota A | Passar para agente de IA (SDR) |
| rota A, etiqueta `verba-baixa` | Passar para agente de IA (SDR), instrução "comece validando o investimento" |
| rota A, etiqueta `decisor:nao` | Passar para agente de IA (SDR), instrução "peça para incluir o dono na reunião" |
| rota B | sequência de nutrição (mensagens + esperas) com a oferta do Raio-X Comercial |
| rota C | nenhuma automação (só entra na lista, para remarketing) |

Atenção, API oficial do WhatsApp: fora da janela de 24 h, a primeira mensagem para quem nunca escreveu precisa ser um modelo aprovado (passo "Enviar modelo"). Mensagem livre, inclusive a do agente, só passa no número conectado por QR code (UAZAPI) ou depois que o lead responder.

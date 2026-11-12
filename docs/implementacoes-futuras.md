# Implementações futuras

O lugar único do que ficou para depois. Cada item tem o pedido, o que já
existe para apoiar e o que falta decidir. Quando um item vira trabalho,
ele ganha um plano próprio em `docs/plano-*.md` e sai daqui.

## Ferramentas: Quiz (registrado em 12/11/2026)

**Pedido.** Uma aba **Ferramentas** no menu do CRM. A primeira ferramenta
é um **Quiz** parecido com o Typeform: cada cliente monta o próprio
formulário, publica num link e as respostas caem direto como **lead**,
já preenchendo os campos do contato.

**O que já existe para apoiar.**
- O recebimento universal de leads (`docs/recebimento-universal-de-leads.md`):
  o quiz manda as respostas no formato **Harpium Lead v1**, por uma URL
  própria (uma por origem, migration 068), com `respostas`,
  `qualificacao` (rota A/B/C, pontuação) e `consentimento`.
- Lead novo cai no funil e dispara o evento "Lead recebido" (automações e
  "Passar para agente de IA").
- As respostas viram campos personalizados do contato (Fase 2 de
  `docs/plano-leads-contexto-ia.md`), e o agente de IA lê esses campos
  (Fase 3).

**Ideia inicial.**
- Editor do quiz: perguntas (texto, múltipla escolha, número, telefone,
  e-mail), uma por tela, com barra de progresso.
- Pontuação por resposta e regra de rota (A/B/C) no fim.
- Link público por quiz, com a marca do cliente, e tela final
  configurável (mensagem, botão de WhatsApp).
- Cada resposta enviada vira um lead da origem do quiz.
- Lista de quizzes com quantos abriram, quantos terminaram e quantos
  viraram lead.

**Falta.** O usuário já tem a estrutura do quiz pronta e vai mandar. O
plano detalhado (telas, tabelas, migrations) sai dela.

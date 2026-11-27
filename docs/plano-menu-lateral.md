# Plano: menu lateral organizado pelo dia a dia do cliente

Data: 27 de novembro de 2026. Status: **aprovado e implementado** no branch `feat/menu-lateral`, à espera do merge. Veja [Andamento](#andamento) no fim.

## O pedido

- Organizar o menu lateral para ficar mais prático no dia a dia de quem usa o CRM.

## Como está hoje

São 16 itens numa coluna só, em 3 grupos (`src/lib/nav.ts`). Ferramentas já fica na barra de cima.

| Grupo | Itens |
|---|---|
| Dia a dia | Painel, Caixa de entrada, Notificações, Contatos, Leads, Funis, Agenda, Relatórios, Radar |
| Construir | Agentes de IA, Automações, Fluxos (Beta), Transmissões, Canais |
| Sistema | Configurações, Ajuda |

## O que atrapalha

1. **A Ajuda some em tela de notebook.**
   - Com 16 itens, o menu tem cerca de 806 px de altura.
   - Se a janela do navegador tiver menos de uns 840 px de altura, como num MacBook Air, o menu corta e rola. A barra de rolagem fica escondida.
   - No seu print, a lista termina em Configurações. A Ajuda está lá embaixo e não aparece.
2. **A ordem não segue o dia.**
   - Contatos, que funciona como uma agenda de endereços, vem antes de Leads e Funis, que são o trabalho do dia.
   - Relatórios e Radar, telas de análise que a pessoa olha de vez em quando, estão misturados com as de trabalho.
3. **Notificações ocupa uma linha inteira**, como se fosse uma área de trabalho. Notificação é aviso. O lugar dela é um sino na barra de cima, com o número.
4. **Canais é configurado uma vez** (conectar o WhatsApp), mas está no meio das telas de automação.
5. **Todo mundo vê tudo.** Um Atendente vê Agentes de IA, Automações, Canais e Configurações, mesmo sem poder alterar nada ali.

## A proposta

| Grupo | Itens | Por quê |
|---|---|---|
| **Dia a dia** | Painel, Caixa de entrada, Leads, Funis, Agenda, Contatos | Segue o caminho do cliente: conversa → lead → negócio → reunião. Contatos fica no fim, como a agenda de endereços |
| **Acompanhar** | Relatórios, Radar | Análise, separada do trabalho do dia |
| **Automatizar** | Agentes de IA, Automações, Fluxos (Beta), Transmissões | O que se configura para trabalhar sozinho |
| **Ajustes** | Canais, Configurações | O que se mexe uma vez |

Na barra de cima:
- **Notificações vira um sino** com o mesmo número de hoje.
  - O clique abre as últimas notificações. "Ver todas" leva para a tela atual de Notificações.
  - No celular, o menu continua listando Notificações, como já faz com Ferramentas.
- **A Ajuda sai do menu lateral.**
  - Ela continua no botão "?" da barra de cima, que já aparece em todas as telas.
  - Também entra no menu da conta.

Resultado: 14 itens e cerca de 720 px de altura, o que cabe numa tela de notebook.

### Por papel (decisão sua)

- **Proprietário e Administrador:** veem tudo.
- **Atendente e Visualizador:** veem só "Dia a dia" e "Acompanhar".
  - As outras telas continuam abrindo por link.
  - Elas já bloqueiam o que a pessoa não pode alterar.

### Selos (opcional)

- **Agentes de IA:** o número de aprovações esperando por você. Combina com o plano dos agentes ativos (`docs/plano-agentes-ativos.md`).
- **Canais:** um ponto vermelho quando o WhatsApp desconectar. Hoje não existe um sinal pronto para o menu ler, então isso dá um pouco mais de trabalho.

## Como fazer

- `src/lib/nav.ts`:
  - a nova ordem;
  - um grupo novo, "Acompanhar";
  - Notificações e Ajuda com `topbar: true`. É a mesma marcação de Ferramentas: o item sai do menu do computador e continua no do celular.
- `src/components/layout/topbar.tsx`: o sino, lendo o mesmo contador que o menu usa hoje (`useUnreadNotifications`).
- `src/components/layout/rail.tsx`:
  - esconder grupos por papel, com o papel que `useAuth` já entrega;
  - títulos dos grupos no menu do celular.
- Sem migration. Um PR. Conferir numa janela de 1440×800 e no celular.

## Decisões

| # | Pergunta | Recomendação |
|---|---|---|
| 1 | Ordem e grupos como na tabela acima? | Sim |
| 2 | Notificações vira sino na barra de cima? | Sim |
| 3 | Esconder "Automatizar" e "Ajustes" de Atendente e Visualizador? | Sim |
| 4 | Selos novos? | Aprovações em Agentes de IA agora. O de WhatsApp caído fica para depois |

## Andamento

Em 27/11/2026 você aprovou com "Sim, faz o menu", com as quatro recomendações. O que foi feito:

- **Ordem e grupos** como na tabela, em `src/lib/nav.ts`. Com o menu aberto, cada grupo mostra o nome no lugar da linha divisória. O espaço é o mesmo, então o menu não pula ao abrir.
- **O sino** (`src/components/layout/notifications-bell.tsx`):
  - mostra o número de não lidas e as 8 últimas;
  - o clique leva para o mesmo lugar que a tela de Notificações levaria. As duas usam agora a mesma regra (`src/lib/notifications/target.ts`).
  - Também aparece no celular. Para o nome da tela continuar cabendo, a barra de cima ficou com os botões um pouco mais juntos no celular.
- **Ajuda**: saiu do menu lateral e entrou no menu da conta. O botão "?" continua na barra de cima.
- **Por papel**: Atendente e Visualizador veem só "Dia a dia" e "Acompanhar".
  - Exceção: quem entra pela agência vê o menu inteiro. A agência com consentimento "só leitura" entra como Visualizador, mas está lá justamente para olhar a configuração.
  - Para saber se é a agência, o menu lê o mesmo `/api/account/context` da faixa de modo suporte. Os dois compartilham uma única chamada (`src/hooks/use-crm-context.ts`).
- **Selo de aprovações** em Agentes de IA (`src/hooks/use-pending-approvals.ts`). Conta as mesmas aprovações da aba Aprovações e atualiza na hora, pelo Realtime.
- O tutorial de Notificações, na Central de ajuda, agora explica o sino.

Conferido numa prévia na janela de 1440×807, do tamanho do seu print:
- o menu tem 740 px e não corta nada;
- o sino, o menu da conta e o menu do celular funcionam.

A prévia foi feita sem login, então o selo de aprovações e a lista do sino com notificações de verdade ainda não foram vistos em funcionamento.

Testes: `src/lib/nav.test.ts` confere a ordem, o limite de 14 itens e a regra por papel. `src/lib/notifications/target.test.ts` confere o destino de cada notificação.

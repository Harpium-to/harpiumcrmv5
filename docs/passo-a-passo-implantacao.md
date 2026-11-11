# Passo a passo: colocar a plataforma no ar

O que depende do dono para as fases do PR #3 funcionarem de verdade.
Tempo total: cerca de 1 hora, num horário com pouco movimento.

---

## 1. Backup do banco (5 min)

No painel do Supabase, abra o projeto › **Database › Backups**.

- **Plano pago:** confira que existe um backup de hoje. Se não houver,
  espere o próximo ou use a opção abaixo.
- **Plano gratuito:** faça uma cópia pelo terminal (precisa do Supabase
  CLI e do Docker). A URI fica em **Project Settings › Database ›
  Connection string › URI**:

  ```bash
  supabase db dump --db-url "COLE_A_URI_AQUI" -f backup-antes-da-plataforma.sql
  ```

Não siga sem backup: a migration 049 muda a regra de acesso de todas as
tabelas.

## 2. Ver o que já está aplicado (2 min)

Supabase › **SQL Editor › New query**, cole e clique em **Run**:

```sql
select
  to_regclass('public.agents') is not null                                   as m044,
  to_regclass('public.agent_tasks') is not null                              as m045,
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'deals'
            and column_name = 'closed_at')                                   as m046,
  to_regclass('public.instagram_config') is not null                         as m047,
  to_regprocedure('public.report_first_response(uuid,timestamptz,timestamptz,text)') is not null as m048,
  to_regclass('public.account_members') is not null                          as m049,
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'accounts'
            and column_name = 'status')                                      as m050,
  to_regclass('public.account_agency_access_requests') is not null           as m051,
  to_regclass('public.account_activity_days') is not null                    as m052,
  to_regclass('public.crm_templates') is not null                            as m053,
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'api_keys'
            and column_name = 'kind')                                        as m054,
  to_regprocedure('public.leave_agency_session()') is not null               as m055,
  to_regprocedure('public.agencia_account_totals()') is not null             as m056;
```

Cada coluna `false` é uma migration que falta. Pelo `HANDOFF.md`, devem
faltar todas, da 044 à 056.

## 3. Aplicar as que faltam, uma por vez, em ordem (20–30 min)

Os arquivos estão em `supabase/migrations/` (no GitHub:
`https://github.com/Harpium-to/harpiumcrmv5/blob/main/supabase/migrations/`
depois do merge, ou na branch `feat/agencia-supervisao-ptbr` antes).

Para cada número que deu `false`, **da menor para a maior**:

1. Abra o arquivo (ex.: `049_plataforma_acesso.sql`) e copie o conteúdo
   inteiro.
2. SQL Editor › New query › cole › **Run**.
3. Espere "Success. No rows returned".

Se uma der erro: **pare**, não pule para a próxima, copie a mensagem e
me mande. Todas podem rodar de novo sem estrago — se ficar em dúvida se
uma rodou, rode de novo.

A 048 cria um índice em mensagens: numa base grande, os envios podem
ficar alguns segundos parados enquanto ele é criado.

No fim, rode a consulta do passo 2 de novo: tudo tem que dar `true`.

## 4. Conferir (10 min)

Abra a prévia do PR (`https://deploy-preview-3--harpium-crm.netlify.app`)
ou, depois do merge, o endereço de produção.

- [ ] Com **harpiumdigital@gmail.com**: cai no **Painel da plataforma**,
      com a tabela de CRMs (as notas de saúde começam a encher conforme o
      pessoal usa).
- [ ] **Membros** (no topo do painel): você aparece como **Super admin**.
- [ ] Ao abrir um CRM: aparecem **Gestão do CRM**, **Uso e saúde** e
      **Modelos**.
- [ ] Com um login de **dono de CRM de cliente**: Configurações ›
      **Acesso da agência** mostra o nível **Leitura** (todos os CRMs que
      já existiam começam assim). **Extensão do Chrome** mostra o botão de
      baixar.
- [ ] O dono, o atendente e o visualizador de clientes diferentes veem
      só o próprio CRM.

Se a prévia e a produção usam o mesmo Supabase (mesmas variáveis na
Netlify), o banco já é o de produção — o código atual da `main` funciona
com as migrations novas, então não há pressa para o merge.

## 5. Mesclar o PR #3 (2 min)

GitHub › Pull requests › #3 › **Merge pull request**. A Netlify publica
em produção sozinha.

A ordem migrations → merge é a recomendada, mas as duas funcionam: o
código novo, sem as migrations, se comporta como antes.

## 6. Montar o CRM da Harpium (10 min)

Primeiro descubra em qual caso você está: abra o CRM pessoal de
harpiumdigital@gmail.com no painel. Ele tem WhatsApp conectado,
contatos, conversas da Harpium?

### Caso A — sim, os dados da Harpium estão nele

1. Logado como harpiumdigital, no Painel, abra esse CRM.
2. Em **Gestão do CRM**: Nome = **Harpium**, Nicho = **Serviços /
   Agência** › **Salvar**.
3. Em **Convidar o dono**: `marcelarruda2013@gmail.com` › **Gerar
   convite** › copie o link.
4. Abra o link num navegador logado como **marcelarruda2013@gmail.com**
   (se ainda não tiver conta, crie com esse e-mail) › **Aceitar**. Ele
   vira o dono; o harpiumdigital fica como administrador.
5. Logado como Marcelo: Configurações › **Acesso da agência** › escolha
   **Total** (é o CRM da própria Harpium).
6. Opcional: em Configurações › Membros, remova o harpiumdigital desse
   CRM. A agência continua entrando quando precisar, pelo botão
   **Entrar no CRM** do painel.

### Caso B — não, ele está vazio

1. Painel › **Novo CRM**: Nome **Harpium**; e-mail do dono
   `marcelarruda2013@gmail.com`; Nicho **Serviços / Agência** (o modelo
   Serviços vem junto); Acesso **Total** › **Criar CRM e gerar convite**.
2. Mande o link ao Marcelo — ou ele só entra no sistema com esse e-mail:
   o convite aparece na hora.
3. O CRM pessoal vazio do harpiumdigital: abra › Gestão do CRM › Status
   **Arquivado** › Salvar.

## 7. Decisões rápidas (quando quiser)

- **Cadastro aberto.** No fim do Painel, "Cadastro novo cria um CRM
  pessoal". Recomendado **desligar**: quem se cadastrar fica em
  "Aguardando liberação" até vocês criarem ou vincularem o CRM.
- **Nome da extensão.** Resolvido: "Harpium CRM" desde a versão 0.5.0.
- **Chrome Web Store (opcional).** Com uma conta de desenvolvedor Google
  (taxa única de US$ 5), publique a extensão como "não listada". Depois,
  na Netlify › Site configuration › Environment variables, crie
  `NEXT_PUBLIC_EXTENSION_STORE_URL` com o link da loja e publique de
  novo: o botão vira "Adicionar ao Chrome".

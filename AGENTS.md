<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Deploys custam créditos (leia antes de qualquer merge)

Cada merge em `main` publica o CRM no Netlify, e cada deploy de produção custa 15 créditos. O plano da agência tem 1.000 créditos por mês.
- Em novembro de 2026 foram 105 deploys de produção, 60 deles do CRM, alguns dias com mais de dez.
- Em 27/11/2026 os créditos acabaram e o Netlify tirou o CRM do ar para todos os clientes.

- **Nunca faça merge em `main` sem o OK do dono** para pôr no ar, dado nesta conversa ("pôr no ar", "pode fazer o merge").
- **Junte as mudanças.** Vários PRs prontos entram de uma vez, no mesmo momento, e não um merge por correção. O normal é no máximo um deploy por dia, a não ser que o dono peça mais ou seja uma correção urgente com o CRM quebrado.
- **Não mescle sozinho o que só muda docs, LP, migrations ou testes.** Esses arquivos não geram deploy do CRM (`scripts/netlify-ignore.sh`), mas vão junto do próximo merge de código, em vez de abrir um merge só para eles.
- **Em outros sites do Netlify, teste com deploy de rascunho:** `netlify deploy`, sem `--prod`, é grátis. Cada `--prod` custa 15 créditos.
- Antes de pôr no ar, confira o saldo em app.netlify.com › Usage & billing. Com o saldo baixo, avise o dono antes do merge.


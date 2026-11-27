-- ============================================================
-- A base de CNPJ do Extrator de leads (docs/extrator-leads.md)
--
-- NÃO é uma migration do CRM. Roda num banco SEPARADO (um segundo
-- projeto do Supabase), só de leitura para o CRM, para que as dezenas
-- de milhões de empresas não pesem no banco de produção.
--
-- De onde vêm os dados: os arquivos públicos do CNPJ que a Receita
-- Federal publica todo mês. Quem carrega é scripts/cnpj-base/importar.mjs,
-- que guarda só os estabelecimentos ATIVOS.
--
--   cnpj_estabelecimentos  um estabelecimento ativo por linha (matriz
--                          ou filial): endereço, atividade, contato
--   cnpj_empresas          a empresa por trás (os 8 primeiros caracteres
--                          do CNPJ): razão social, porte, capital, MEI
--   cnpj_responsaveis      o nome do sócio-administrador, quando há.
--                          O CPF nunca é guardado, nem o mascarado
--   cnpj_cnaes             código e descrição das atividades
--   cnpj_municipios        código da Receita, nome e UF
--   cnpj_meta              o mês da carga em uso
--
--   cnpj_buscar()          os estabelecimentos de um filtro, em páginas
--   cnpj_contar()          quantos são, até um teto
--   cnpj_finalizar_lote()  apaga o que não veio na carga do mês
--
-- Ninguém lê estas tabelas com a chave pública: RLS ligado e nenhuma
-- regra. O CRM usa a chave de serviço deste projeto.
--
-- Pode rodar mais de uma vez.
-- ============================================================

CREATE TABLE IF NOT EXISTS cnpj_empresas (
  basico       TEXT PRIMARY KEY,
  razao_social TEXT NOT NULL DEFAULT '',
  natureza     TEXT,
  -- '01' microempresa, '03' pequeno porte, '05' demais, '00' não informado
  porte        TEXT,
  capital      NUMERIC(18, 2),
  mei          BOOLEAN NOT NULL DEFAULT FALSE,
  lote         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cnpj_estabelecimentos (
  cnpj          TEXT PRIMARY KEY,
  basico        TEXT NOT NULL,
  matriz        BOOLEAN NOT NULL DEFAULT TRUE,
  nome_fantasia TEXT,
  abertura      DATE,
  -- CNAE principal, 7 dígitos
  cnae          TEXT,
  endereco      TEXT,
  bairro        TEXT,
  cep           TEXT,
  uf            TEXT,
  -- Código do município na Receita (não é o do IBGE)
  municipio     INTEGER,
  -- DDD + número, só dígitos
  telefone1     TEXT,
  telefone2     TEXT,
  email         TEXT,
  -- Algum dos telefones tem formato de celular
  tem_celular   BOOLEAN NOT NULL DEFAULT FALSE,
  lote          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cnpj_est_cnae_municipio
  ON cnpj_estabelecimentos (cnae, municipio);
CREATE INDEX IF NOT EXISTS idx_cnpj_est_municipio_abertura
  ON cnpj_estabelecimentos (municipio, abertura);
CREATE INDEX IF NOT EXISTS idx_cnpj_est_uf_cnae
  ON cnpj_estabelecimentos (uf, cnae);
CREATE INDEX IF NOT EXISTS idx_cnpj_est_basico
  ON cnpj_estabelecimentos (basico);
CREATE INDEX IF NOT EXISTS idx_cnpj_est_lote
  ON cnpj_estabelecimentos (lote);
CREATE INDEX IF NOT EXISTS idx_cnpj_emp_lote
  ON cnpj_empresas (lote);

CREATE TABLE IF NOT EXISTS cnpj_responsaveis (
  basico TEXT PRIMARY KEY,
  nome   TEXT NOT NULL,
  lote   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cnpj_cnaes (
  codigo    TEXT PRIMARY KEY,
  descricao TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cnpj_municipios (
  codigo INTEGER PRIMARY KEY,
  nome   TEXT NOT NULL,
  uf     TEXT
);

CREATE INDEX IF NOT EXISTS idx_cnpj_municipios_uf ON cnpj_municipios (uf, nome);

CREATE TABLE IF NOT EXISTS cnpj_meta (
  chave         TEXT PRIMARY KEY,
  valor         TEXT NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cnpj_empresas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cnpj_estabelecimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE cnpj_responsaveis     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cnpj_cnaes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE cnpj_municipios       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cnpj_meta             ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- O filtro, num lugar só. `f` é o JSON que o CRM manda
-- (src/lib/extractor/filters.ts):
--
--   cnaes        ["8630504", …]     atividade principal
--   ufs          ["GO", …]
--   municipios   [9373, …]          códigos da Receita
--   bairro       "setor bueno"      começo do nome, sem diferenciar maiúsculas
--   cep          "74"               começo do CEP
--   tipo         "empresas" | "mei" | "todos"
--   portes       ["01", "03", "05"]
--   abertura_de  "2026-01-01"       abertura_ate  "2026-12-31"
--   capital_min  10000              capital_max  500000
--   unidade      "matriz" | "filial"
--   com_telefone, so_celular, com_email   true
-- ============================================================
CREATE OR REPLACE FUNCTION public.cnpj_filtrar(f JSONB)
RETURNS TABLE (
  cnpj          TEXT,
  basico        TEXT,
  matriz        BOOLEAN,
  nome_fantasia TEXT,
  razao_social  TEXT,
  abertura      DATE,
  cnae          TEXT,
  endereco      TEXT,
  bairro        TEXT,
  cep           TEXT,
  uf            TEXT,
  municipio     INTEGER,
  telefone1     TEXT,
  telefone2     TEXT,
  email         TEXT,
  porte         TEXT,
  capital       NUMERIC,
  mei           BOOLEAN,
  natureza      TEXT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    e.cnpj, e.basico, e.matriz, e.nome_fantasia, p.razao_social, e.abertura, e.cnae,
    e.endereco, e.bairro, e.cep, e.uf, e.municipio, e.telefone1, e.telefone2, e.email,
    p.porte, p.capital, COALESCE(p.mei, FALSE), p.natureza
  FROM cnpj_estabelecimentos e
  LEFT JOIN cnpj_empresas p ON p.basico = e.basico
  WHERE (NOT (f ? 'cnaes')
         OR e.cnae = ANY (ARRAY(SELECT jsonb_array_elements_text(f -> 'cnaes'))))
    AND (NOT (f ? 'ufs')
         OR e.uf = ANY (ARRAY(SELECT jsonb_array_elements_text(f -> 'ufs'))))
    AND (NOT (f ? 'municipios')
         OR e.municipio = ANY (ARRAY(SELECT (jsonb_array_elements_text(f -> 'municipios'))::INTEGER)))
    AND (NOT (f ? 'bairro') OR e.bairro ILIKE (f ->> 'bairro') || '%')
    AND (NOT (f ? 'cep') OR e.cep LIKE (f ->> 'cep') || '%')
    AND (NOT (f ? 'abertura_de') OR e.abertura >= (f ->> 'abertura_de')::DATE)
    AND (NOT (f ? 'abertura_ate') OR e.abertura <= (f ->> 'abertura_ate')::DATE)
    AND (NOT (f ? 'unidade')
         OR (f ->> 'unidade' = 'matriz' AND e.matriz)
         OR (f ->> 'unidade' = 'filial' AND NOT e.matriz))
    AND (COALESCE((f ->> 'com_telefone')::BOOLEAN, FALSE) IS FALSE
         OR e.telefone1 IS NOT NULL OR e.telefone2 IS NOT NULL)
    AND (COALESCE((f ->> 'so_celular')::BOOLEAN, FALSE) IS FALSE OR e.tem_celular)
    AND (COALESCE((f ->> 'com_email')::BOOLEAN, FALSE) IS FALSE OR e.email IS NOT NULL)
    AND (COALESCE(f ->> 'tipo', 'todos') = 'todos'
         OR (f ->> 'tipo' = 'mei' AND COALESCE(p.mei, FALSE))
         OR (f ->> 'tipo' = 'empresas' AND NOT COALESCE(p.mei, FALSE)))
    AND (NOT (f ? 'portes')
         OR p.porte = ANY (ARRAY(SELECT jsonb_array_elements_text(f -> 'portes'))))
    AND (NOT (f ? 'capital_min') OR p.capital >= (f ->> 'capital_min')::NUMERIC)
    AND (NOT (f ? 'capital_max') OR p.capital <= (f ->> 'capital_max')::NUMERIC)
$$;

-- Uma página do filtro, em ordem de CNPJ, a partir de `p_apos`.
CREATE OR REPLACE FUNCTION public.cnpj_buscar(
  p_filtros JSONB,
  p_apos    TEXT DEFAULT '',
  p_limite  INTEGER DEFAULT 200
)
RETURNS TABLE (
  cnpj           TEXT,
  matriz         BOOLEAN,
  nome_fantasia  TEXT,
  razao_social   TEXT,
  abertura       DATE,
  cnae           TEXT,
  cnae_descricao TEXT,
  endereco       TEXT,
  bairro         TEXT,
  cep            TEXT,
  uf             TEXT,
  municipio      INTEGER,
  municipio_nome TEXT,
  telefone1      TEXT,
  telefone2      TEXT,
  email          TEXT,
  porte          TEXT,
  capital        NUMERIC,
  mei            BOOLEAN,
  natureza       TEXT,
  responsavel    TEXT
)
LANGUAGE plpgsql
STABLE
SET statement_timeout = '20s'
-- O JSON do filtro precisa entrar no plano como constante, para os
-- índices serem usados.
SET plan_cache_mode = force_custom_plan
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.cnpj, r.matriz, r.nome_fantasia, r.razao_social, r.abertura, r.cnae, c.descricao,
    r.endereco, r.bairro, r.cep, r.uf, r.municipio, m.nome,
    r.telefone1, r.telefone2, r.email, r.porte, r.capital, r.mei, r.natureza, s.nome
  FROM cnpj_filtrar(p_filtros) r
  LEFT JOIN cnpj_cnaes c ON c.codigo = r.cnae
  LEFT JOIN cnpj_municipios m ON m.codigo = r.municipio
  LEFT JOIN cnpj_responsaveis s ON s.basico = r.basico
  WHERE r.cnpj > COALESCE(p_apos, '')
  ORDER BY r.cnpj
  LIMIT LEAST(GREATEST(COALESCE(p_limite, 200), 1), 1000);
END;
$$;

-- Quantos estabelecimentos o filtro traz, contando até `p_teto`.
CREATE OR REPLACE FUNCTION public.cnpj_contar(
  p_filtros JSONB,
  p_teto    INTEGER DEFAULT 10001
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SET statement_timeout = '20s'
-- O JSON do filtro precisa entrar no plano como constante, para os
-- índices serem usados.
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  total INTEGER;
BEGIN
  SELECT COUNT(*) INTO total
    FROM (SELECT 1 FROM cnpj_filtrar(p_filtros)
          LIMIT LEAST(GREATEST(COALESCE(p_teto, 10001), 1), 100001)) t;
  RETURN total;
END;
$$;

-- Depois de uma carga: apaga, aos poucos, o que não veio no mês (as
-- empresas que fecharam) e registra o mês em uso. Devolve quantas
-- linhas apagou nesta chamada; o importador chama até voltar 0.
CREATE OR REPLACE FUNCTION public.cnpj_finalizar_lote(
  p_lote   TEXT,
  p_limite INTEGER DEFAULT 20000
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  apagadas INTEGER := 0;
  n        INTEGER;
BEGIN
  DELETE FROM cnpj_estabelecimentos
   WHERE cnpj IN (SELECT cnpj FROM cnpj_estabelecimentos WHERE lote <> p_lote LIMIT p_limite);
  GET DIAGNOSTICS n = ROW_COUNT;
  apagadas := apagadas + n;

  IF n = 0 THEN
    DELETE FROM cnpj_empresas
     WHERE basico IN (SELECT basico FROM cnpj_empresas WHERE lote <> p_lote LIMIT p_limite);
    GET DIAGNOSTICS n = ROW_COUNT;
    apagadas := apagadas + n;
  END IF;

  IF apagadas = 0 THEN
    DELETE FROM cnpj_responsaveis WHERE lote <> p_lote;
    INSERT INTO cnpj_meta (chave, valor) VALUES ('lote', p_lote)
    ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = NOW();
  END IF;
  RETURN apagadas;
END;
$$;

REVOKE ALL ON FUNCTION public.cnpj_filtrar(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cnpj_buscar(JSONB, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cnpj_contar(JSONB, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cnpj_finalizar_lote(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cnpj_filtrar(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.cnpj_buscar(JSONB, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.cnpj_contar(JSONB, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.cnpj_finalizar_lote(TEXT, INTEGER) TO service_role;

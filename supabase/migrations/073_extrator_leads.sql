-- ============================================================
-- 073_extrator_leads.sql — Ferramentas › Extrator de leads
-- (docs/plano-extrator-leads.md)
--
--   lead_extractions         one extraction per row: the source (the
--                            public CNPJ base or Google Maps), the
--                            filters, how far the job got and what it
--                            cost. The job runs in slices; `cursor` is
--                            where the next slice picks up.
--   lead_extraction_results  one extracted company per row. NOT a
--                            contact yet: it becomes one only when a
--                            person sends it to the CRM. `status` says
--                            what it is against the CRM (new, already a
--                            contact, extracted before, asked not to be
--                            contacted, no phone).
--   prospecting_blocklist    numbers that asked not to be contacted.
--                            Fed by contacts.opted_out_at (066) through
--                            a trigger, so it survives the contact being
--                            deleted: a blocked number is never imported
--                            or messaged again.
--   lead_extractor_settings  per CRM: the monthly ceiling (set by the
--                            agency; NULL = the app's default) and when
--                            the terms of use were accepted.
--   bulk_sends.mode          'normal' (065, contacts who know the
--                            company) or 'prospeccao' (cold contacts:
--                            slower, business hours, several texts).
--   scheduled_messages.replied_at  when the recipient of a prospecting
--                            send wrote back — the campaign's report and
--                            its automatic brake read it.
--
-- Members read their CRM's extractions; every write goes through the
-- service role in the API routes, after an admin check (the model of
-- 072). The CNPJ base itself is NOT here: it lives in a separate
-- database (supabase/cnpj-base/schema.sql), read only.
--
-- Safe to apply before or after the code: while these tables are
-- absent the screens say the migration is pending and nothing breaks.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- LEAD_EXTRACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_extractions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  source      TEXT NOT NULL CHECK (source IN ('cnpj', 'google_maps')),
  -- What the person asked for (src/lib/extractor/filters.ts).
  filters     JSONB NOT NULL DEFAULT '{}'::jsonb,
  status      TEXT NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  -- The most results this extraction may keep.
  requested   INTEGER NOT NULL CHECK (requested BETWEEN 1 AND 5000),
  -- Read from the source so far, and kept after the filters. `found`
  -- counts against the CRM's monthly ceiling and stays after the
  -- results themselves are cleaned up.
  fetched     INTEGER NOT NULL DEFAULT 0 CHECK (fetched >= 0),
  found       INTEGER NOT NULL DEFAULT 0 CHECK (found >= 0),
  -- Where the next slice continues (a CNPJ, a provider's request id).
  cursor      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- A slice in progress holds the job until this is stale.
  claimed_at  TIMESTAMPTZ,
  -- What the source charged, estimated (USD).
  cost_usd    NUMERIC(10, 4) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  error       TEXT,
  finished_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_extractions_account
  ON lead_extractions (account_id, created_at DESC);

-- What the scheduler scans: the jobs still going.
CREATE INDEX IF NOT EXISTS idx_lead_extractions_open
  ON lead_extractions (created_at)
  WHERE status IN ('queued', 'running');

DROP TRIGGER IF EXISTS set_updated_at ON lead_extractions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON lead_extractions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE lead_extractions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_extractions_select ON lead_extractions;
CREATE POLICY lead_extractions_select ON lead_extractions FOR SELECT
  USING (is_account_member(account_id));

-- ============================================================
-- LEAD_EXTRACTION_RESULTS
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_extraction_results (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  extraction_id       UUID NOT NULL REFERENCES lead_extractions(id) ON DELETE CASCADE,
  source              TEXT NOT NULL CHECK (source IN ('cnpj', 'google_maps')),
  -- The source's own id: the CNPJ, or Google's place id.
  external_key        TEXT NOT NULL CHECK (char_length(external_key) BETWEEN 1 AND 200),
  -- 'pessoa': a MEI or a sole trader — the name and the phone are a
  -- person's, so the row carries the "contém dado pessoal" mark.
  kind                TEXT NOT NULL DEFAULT 'empresa' CHECK (kind IN ('empresa', 'pessoa')),
  name                TEXT NOT NULL,
  phone               TEXT,
  -- Digits only, the same key contacts.phone_normalized uses.
  phone_normalized    TEXT,
  phone_kind          TEXT CHECK (phone_kind IS NULL OR phone_kind IN ('celular', 'fixo')),
  -- NULL: not checked yet.
  has_whatsapp        BOOLEAN,
  whatsapp_checked_at TIMESTAMPTZ,
  email               TEXT,
  website             TEXT,
  instagram           TEXT,
  address             TEXT,
  district            TEXT,
  city                TEXT,
  uf                  TEXT,
  cep                 TEXT,
  -- The CNAE's description, or Google's category.
  activity            TEXT,
  -- What only one source has: CNPJ, size, opening date, capital, the
  -- administrator's name; rating and number of reviews.
  extras              JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Against the CRM, when it was extracted.
  status              TEXT NOT NULL DEFAULT 'novo'
                      CHECK (status IN ('novo', 'contato', 'extraido', 'bloqueado', 'sem_telefone')),
  -- The contact it matched ('contato').
  matched_contact_id  UUID REFERENCES contacts(id) ON DELETE SET NULL,
  -- What it became when it was sent to the CRM.
  contact_id          UUID REFERENCES contacts(id) ON DELETE SET NULL,
  lead_id             UUID REFERENCES leads(id) ON DELETE SET NULL,
  imported_at         TIMESTAMPTZ,
  -- When the company's own site was read for WhatsApp, e-mail, Instagram.
  enriched_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (extraction_id, external_key)
);

CREATE INDEX IF NOT EXISTS idx_lead_extraction_results_extraction
  ON lead_extraction_results (extraction_id, created_at, id);

-- "Was this one extracted before in this CRM?"
CREATE INDEX IF NOT EXISTS idx_lead_extraction_results_key
  ON lead_extraction_results (account_id, source, external_key);

CREATE INDEX IF NOT EXISTS idx_lead_extraction_results_phone
  ON lead_extraction_results (account_id, phone_normalized)
  WHERE phone_normalized IS NOT NULL;

-- The clean-up: results never sent to the CRM, by age.
CREATE INDEX IF NOT EXISTS idx_lead_extraction_results_unused
  ON lead_extraction_results (created_at)
  WHERE imported_at IS NULL;

ALTER TABLE lead_extraction_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_extraction_results_select ON lead_extraction_results;
CREATE POLICY lead_extraction_results_select ON lead_extraction_results FOR SELECT
  USING (is_account_member(account_id));

-- ============================================================
-- LEAD_EXTRACTION_TOTALS — the numbers on the list of extractions
-- ============================================================
CREATE OR REPLACE VIEW lead_extraction_totals
WITH (security_invoker = true) AS
SELECT
  extraction_id,
  account_id,
  COUNT(*)::INTEGER                                        AS kept,
  COUNT(*) FILTER (WHERE status = 'novo')::INTEGER         AS novos,
  COUNT(*) FILTER (WHERE status = 'contato')::INTEGER      AS contatos,
  COUNT(*) FILTER (WHERE status = 'extraido')::INTEGER     AS extraidos,
  COUNT(*) FILTER (WHERE status = 'bloqueado')::INTEGER    AS bloqueados,
  COUNT(*) FILTER (WHERE status = 'sem_telefone')::INTEGER AS sem_telefone,
  COUNT(imported_at)::INTEGER                              AS importados
FROM lead_extraction_results
GROUP BY extraction_id, account_id;

-- ============================================================
-- PROSPECTING_BLOCKLIST
-- ============================================================
CREATE TABLE IF NOT EXISTS prospecting_blocklist (
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  phone_normalized TEXT NOT NULL CHECK (char_length(phone_normalized) BETWEEN 8 AND 20),
  -- 'descadastro': the contact opted out (066). 'manual': added by hand.
  reason           TEXT NOT NULL DEFAULT 'descadastro' CHECK (reason IN ('descadastro', 'manual')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, phone_normalized)
);

ALTER TABLE prospecting_blocklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prospecting_blocklist_select ON prospecting_blocklist;
CREATE POLICY prospecting_blocklist_select ON prospecting_blocklist FOR SELECT
  USING (is_account_member(account_id));

-- A contact who opts out goes on the list; one who is unmarked by hand
-- comes off it. SECURITY DEFINER: whoever marks the contact (an agent,
-- the extension, the automatic "SAIR") has no write access to the list.
CREATE OR REPLACE FUNCTION public.sync_prospecting_blocklist()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.phone_normalized IS NULL OR char_length(NEW.phone_normalized) < 8 THEN
    RETURN NEW;
  END IF;
  IF NEW.opted_out_at IS NOT NULL THEN
    INSERT INTO prospecting_blocklist (account_id, phone_normalized, reason)
    VALUES (NEW.account_id, NEW.phone_normalized, 'descadastro')
    ON CONFLICT (account_id, phone_normalized) DO NOTHING;
  ELSIF TG_OP = 'UPDATE' AND OLD.opted_out_at IS NOT NULL THEN
    DELETE FROM prospecting_blocklist
     WHERE account_id = NEW.account_id
       AND phone_normalized = NEW.phone_normalized
       AND reason = 'descadastro';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  -- contacts.opted_out_at is migration 066; without it there is nothing
  -- to follow yet.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'opted_out_at'
  ) THEN
    DROP TRIGGER IF EXISTS contacts_sync_prospecting_blocklist ON contacts;
    CREATE TRIGGER contacts_sync_prospecting_blocklist
      AFTER INSERT OR UPDATE OF opted_out_at ON contacts
      FOR EACH ROW EXECUTE FUNCTION public.sync_prospecting_blocklist();

    -- Whoever had already opted out.
    INSERT INTO prospecting_blocklist (account_id, phone_normalized, reason)
    SELECT account_id, phone_normalized, 'descadastro'
      FROM contacts
     WHERE opted_out_at IS NOT NULL
       AND phone_normalized IS NOT NULL
       AND char_length(phone_normalized) BETWEEN 8 AND 20
    ON CONFLICT (account_id, phone_normalized) DO NOTHING;
  END IF;
END
$$;

-- ============================================================
-- LEAD_EXTRACTOR_SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_extractor_settings (
  account_id        UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  -- Leads a month this CRM may extract. NULL: the app's default.
  monthly_limit     INTEGER CHECK (monthly_limit IS NULL OR monthly_limit BETWEEN 0 AND 100000),
  -- The CRM's admin read and accepted the terms of use of the tool.
  terms_accepted_at TIMESTAMPTZ,
  terms_accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at ON lead_extractor_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON lead_extractor_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE lead_extractor_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_extractor_settings_select ON lead_extractor_settings;
CREATE POLICY lead_extractor_settings_select ON lead_extractor_settings FOR SELECT
  USING (is_account_member(account_id));

-- ============================================================
-- BULK SENDS — the prospecting mode
-- ============================================================
DO $$
BEGIN
  -- bulk_sends is migration 065.
  IF to_regclass('public.bulk_sends') IS NOT NULL THEN
    ALTER TABLE bulk_sends
      ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'normal',
      -- The texts a prospecting send draws from, one per recipient.
      ADD COLUMN IF NOT EXISTS variations JSONB NOT NULL DEFAULT '[]'::jsonb,
      -- Why it stopped by itself (the automatic brake), for the person.
      ADD COLUMN IF NOT EXISTS stopped_reason TEXT;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'bulk_sends_mode_check'
    ) THEN
      ALTER TABLE bulk_sends
        ADD CONSTRAINT bulk_sends_mode_check CHECK (mode IN ('normal', 'prospeccao'));
    END IF;
  END IF;

  -- scheduled_messages is migration 064.
  IF to_regclass('public.scheduled_messages') IS NOT NULL THEN
    ALTER TABLE scheduled_messages
      ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;
  END IF;
END
$$;

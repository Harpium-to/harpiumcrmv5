-- ============================================================
-- 046_deal_close_timestamp.sql
--
-- `deals.closed_at`: when a deal actually reached won or lost.
--
-- Why this column has to exist before any report does. The table had
-- `created_at` and `updated_at` and nothing else, so the only way to
-- answer "quantos negócios fechamos em outubro" was to read
-- `updated_at` of the rows whose status is won/lost. That is wrong, and
-- wrong in the quiet way: `update_updated_at_column()` fires on every
-- edit, so renaming a deal, adding a note or fixing its value in
-- November silently moves it out of October's revenue. A sales report
-- built on that number is worse than no report, because people act on
-- it.
--
-- The stamp is set by a trigger rather than by the application. Deals
-- change status from the Kanban drag, the deal form, the public API,
-- automations, flows and the agent runner — six call sites today and
-- more later, and a column that only four of them remember to set is a
-- column nobody can trust.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE deals ADD COLUMN IF NOT EXISTS closed_at timestamptz;

-- ------------------------------------------------------------
-- The stamp.
--
-- Three rules, and the third is the one that matters:
--   open → won/lost   stamp it (now(), unless the caller supplied a
--                     date — an importer backfilling real history
--                     should be able to say when it really closed)
--   → open            clear it: a deal reopened is not a closed deal,
--                     and leaving the old stamp would have it counted
--                     in a past month's revenue while sitting in the
--                     pipeline
--   won → lost, or
--   any edit while
--   already closed    leave it alone. This is the whole point of the
--                     column: the close date must survive every later
--                     edit to the row.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stamp_deal_closed_at()
RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('won', 'lost') THEN
    IF TG_OP = 'INSERT' OR OLD.status NOT IN ('won', 'lost') THEN
      NEW.closed_at := COALESCE(NEW.closed_at, now());
    ELSE
      -- Already closed before this statement: keep the original date,
      -- even if the caller passed something else.
      NEW.closed_at := OLD.closed_at;
    END IF;
  ELSE
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS stamp_deal_closed_at ON deals;
CREATE TRIGGER stamp_deal_closed_at
  BEFORE INSERT OR UPDATE OF status, closed_at ON deals
  FOR EACH ROW EXECUTE FUNCTION public.stamp_deal_closed_at();

-- ------------------------------------------------------------
-- Backfill, and the honest note about it.
--
-- For deals that closed before this migration there is no record of
-- when, so `updated_at` is the best available guess and it is only a
-- guess: it is the date of the last edit, which for an untouched deal
-- is the close and for an edited one is not. Reports over periods
-- before this migration ran are therefore approximate; from here
-- forward they are exact.
--
-- Scoped to rows with no stamp so re-running never overwrites a real
-- date the trigger has since recorded.
-- ------------------------------------------------------------
UPDATE deals
SET closed_at = updated_at
WHERE status IN ('won', 'lost') AND closed_at IS NULL;

-- Partial: every report filters on a closed window, and open deals are
-- the majority of the table in a healthy pipeline.
CREATE INDEX IF NOT EXISTS deals_account_closed_at_idx
  ON deals (account_id, closed_at DESC)
  WHERE closed_at IS NOT NULL;

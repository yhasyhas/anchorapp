/*
  # Future letters — write to your future self

  1. New Table
    - `future_letters` — a letter she writes to herself now, sealed until a
      chosen delivery date (1 or 3 months out, computed client-side and sent
      as `deliver_on`).
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `content` (text) — her own words, never touched by AI, 1-1000 chars
      - `written_at` (timestamptz) — when she sealed it
      - `deliver_on` (date) — the day the letter becomes readable
      - `delivered_at` (timestamptz, nullable) — stamped by the reminders
        cron (api/cron/reminders.ts) the first time it notices `deliver_on`
        has arrived for her local date; purely an idempotency/notification
        marker, NOT what gates readability (see below)
      - `opened_at` (timestamptz, nullable) — stamped when she actually
        opens the ritual, separate from `delivered_at` since a push can
        arrive before she opens the app

  2. Security — the product's one hard rule: she can never read `content`
     before `deliver_on`, enforced at the database layer, not just hidden
     in the UI.
    - RLS enabled, scoped to her own rows for SELECT/INSERT/UPDATE as usual.
    - RLS alone is ROW-level, not column-level (same limitation already
      noted in circle_of_trust's migration) — a plain "auth.uid() = user_id"
      SELECT policy would still let a direct query return `content` early.
      Supabase's default privileges also grant blanket table-wide
      SELECT/INSERT/UPDATE to `authenticated` on every new public table, so
      that blanket grant is REVOKEd first, then re-GRANTed only on the
      specific columns each operation actually needs:
        - SELECT: everything except `content` (metadata only, for the
          waiting/ready/archive lists and countdown cards).
        - INSERT: only `user_id`, `content`, `deliver_on` — the row she's
          allowed to create.
        - UPDATE: only `opened_at`, and only once `deliver_on` has arrived
          (the RLS USING clause) — she can never move her own delivery date
          up or rewrite what she wrote.
        - `delivered_at` is never grantable to `authenticated` at all —
          only the cron (service-role key, bypasses RLS/grants entirely)
          ever sets it.
    - `content` is only ever readable through `get_future_letter_content()`
      below, a SECURITY DEFINER function that re-checks `deliver_on <=
      CURRENT_DATE` server-side before returning anything — this is what
      actually satisfies "verified at the API layer, not just the UI": even
      a direct RPC call before the date raises an exception, never a value.
    - Max 3 simultaneously "sealed and waiting" letters per user (rows with
      `deliver_on > CURRENT_DATE`) enforced by a BEFORE INSERT trigger, same
      shape as `enforce_circle_max_active` in the circle_of_trust migration.
      Letters that have already reached their date don't count against the
      cap even if not yet opened — the cap is about pending anticipation,
      not archive size.
*/

CREATE TABLE IF NOT EXISTS future_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  written_at timestamptz NOT NULL DEFAULT now(),
  deliver_on date NOT NULL,
  delivered_at timestamptz,
  opened_at timestamptz,
  CHECK (length(trim(content)) > 0 AND char_length(content) <= 1000),
  CHECK (deliver_on > CURRENT_DATE)
);

CREATE INDEX IF NOT EXISTS future_letters_user_id_deliver_on_idx ON future_letters (user_id, deliver_on);
-- Partial index for the cron's global "what's due" scan across all users.
CREATE INDEX IF NOT EXISTS future_letters_undelivered_idx ON future_letters (deliver_on) WHERE delivered_at IS NULL;

ALTER TABLE future_letters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own future letters metadata"
  ON future_letters FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own future letters"
  ON future_letters FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Only reachable once the letter's own date has arrived — she can't flip
-- opened_at early, and even if she could, it wouldn't reveal `content`
-- (that's a separate, more tightly gated read path — see below).
CREATE POLICY "Users can mark own due future letters opened"
  ON future_letters FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id AND deliver_on <= CURRENT_DATE)
  WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON future_letters FROM authenticated;
GRANT SELECT (id, user_id, written_at, deliver_on, delivered_at, opened_at) ON future_letters TO authenticated;
GRANT INSERT (user_id, content, deliver_on) ON future_letters TO authenticated;
GRANT UPDATE (opened_at) ON future_letters TO authenticated;

-- ============================================================================
-- Max-3-pending trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION enforce_future_letters_max_pending()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  pending_count integer;
BEGIN
  SELECT count(*) INTO pending_count
  FROM future_letters
  WHERE user_id = NEW.user_id AND deliver_on > CURRENT_DATE;

  IF pending_count >= 3 THEN
    RAISE EXCEPTION 'max_pending_letters' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS future_letters_enforce_max_pending ON future_letters;
CREATE TRIGGER future_letters_enforce_max_pending
  BEFORE INSERT ON future_letters
  FOR EACH ROW
  EXECUTE FUNCTION enforce_future_letters_max_pending();

-- ============================================================================
-- get_future_letter_content: the ONLY path that ever returns `content`,
-- gated on the delivery date regardless of who calls it or how.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_future_letter_content(p_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
  letter_row future_letters%ROWTYPE;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO letter_row FROM future_letters WHERE id = p_id AND user_id = caller;
  IF letter_row.id IS NULL THEN
    RAISE EXCEPTION 'letter_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF letter_row.deliver_on > CURRENT_DATE THEN
    RAISE EXCEPTION 'letter_not_yet_due' USING ERRCODE = 'P0001';
  END IF;

  RETURN letter_row.content;
END;
$$;

REVOKE ALL ON FUNCTION get_future_letter_content(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_future_letter_content(uuid) TO authenticated;

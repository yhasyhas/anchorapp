/*
  # SOS doux — a wordless call for support from your Circle

  Circle of Trust so far (20260803130000, 20260803140000) shares presence and
  mutual encouragements, both content-free by design. This adds one more
  content-free signal: "I could use some love today", with absolutely nothing
  attached — no reason, no mood, no message. Same posture as everything else
  in the circle: RLS enabled with ZERO policies for `authenticated`, every
  read/write gated by a SECURITY DEFINER function.

  Design note — "local midnight" is computed from `profiles.timezone`
  (already populated for the existing push-reminder cron, see
  api/cron/reminders.ts), not from a client-supplied date string. Every
  function below is parameter-less as a result: there is no client input that
  could desync "today" from the sender's actual local day, and a friend's read
  query (`circle_sos_list_active_for_circle`) simply stops returning a row
  once the sender's local date has moved on — no cron job needed to "close"
  anything, and nothing is ever visible to a friend once that happens. The
  `resolve_stale` function below is pure bookkeeping (accurate `resolved_at`
  for the sender's own history) layered on top of that guarantee, not load-
  bearing for it.

  One SOS "in flight" per sender per local day: `circle_sos_send()` checks
  for an existing unresolved row with today's local date before inserting.
*/

CREATE TABLE circle_sos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX circle_sos_sender_created_idx ON circle_sos (sender_id, created_at DESC);

ALTER TABLE circle_sos ENABLE ROW LEVEL SECURITY;

-- Deliberately no policies for `authenticated` at all — every read/write
-- goes through the SECURITY DEFINER functions below, same posture as
-- circle_memberships / circle_encouragements.

-- Send an SOS. No content, no params. Raises sos_no_circle if the caller has
-- no active circle member to notify, sos_already_sent_today if she already
-- has one in flight for her own local day.
CREATE OR REPLACE FUNCTION circle_sos_send()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
  caller_tz text;
  today_local date;
  new_id uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM circle_memberships WHERE user_id = caller AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'sos_no_circle' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(timezone, 'UTC') INTO caller_tz FROM profiles WHERE id = caller;
  today_local := (now() AT TIME ZONE caller_tz)::date;

  IF EXISTS (
    SELECT 1 FROM circle_sos
    WHERE sender_id = caller
      AND resolved_at IS NULL
      AND (created_at AT TIME ZONE caller_tz)::date = today_local
  ) THEN
    RAISE EXCEPTION 'sos_already_sent_today' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO circle_sos (sender_id) VALUES (caller) RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION circle_sos_send() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_sos_send() TO authenticated;

-- Caller's own SOS, if still open today (her local day).
CREATE OR REPLACE FUNCTION circle_sos_get_own_active()
RETURNS TABLE (id uuid, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT s.id, s.created_at
  FROM circle_sos s
  JOIN profiles p ON p.id = s.sender_id
  WHERE s.sender_id = auth.uid()
    AND s.resolved_at IS NULL
    AND (s.created_at AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date
        = (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION circle_sos_get_own_active() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_sos_get_own_active() TO authenticated;

-- Open SOS from the caller's active circle friends — "open" evaluated
-- against each sender's OWN local day, not the viewer's.
CREATE OR REPLACE FUNCTION circle_sos_list_active_for_circle()
RETURNS TABLE (sender_id uuid, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT s.sender_id, s.created_at
  FROM circle_sos s
  JOIN circle_memberships cm ON cm.friend_id = s.sender_id AND cm.user_id = auth.uid() AND cm.status = 'active'
  JOIN profiles p ON p.id = s.sender_id
  WHERE s.resolved_at IS NULL
    AND (s.created_at AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date
        = (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date
  ORDER BY s.created_at DESC;
$$;

REVOKE ALL ON FUNCTION circle_sos_list_active_for_circle() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_sos_list_active_for_circle() TO authenticated;

-- Opportunistic close-out of the caller's own SOS once her local day has
-- moved on. Called on home load; not load-bearing for friend-side privacy
-- (the date filter above already guarantees that), just keeps her own
-- history's resolved_at accurate.
CREATE OR REPLACE FUNCTION circle_sos_resolve_stale()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
  caller_tz text;
BEGIN
  IF caller IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(timezone, 'UTC') INTO caller_tz FROM profiles WHERE id = caller;

  UPDATE circle_sos
  SET resolved_at = now()
  WHERE sender_id = caller
    AND resolved_at IS NULL
    AND (created_at AT TIME ZONE caller_tz)::date <> (now() AT TIME ZONE caller_tz)::date;
END;
$$;

REVOKE ALL ON FUNCTION circle_sos_resolve_stale() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_sos_resolve_stale() TO authenticated;

-- Caller's own past SOS — personal history only, never exposed to a friend
-- (no function here or elsewhere accepts a target user id for this table).
CREATE OR REPLACE FUNCTION circle_sos_list_own_history()
RETURNS TABLE (id uuid, created_at timestamptz, resolved_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT id, created_at, resolved_at
  FROM circle_sos
  WHERE sender_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION circle_sos_list_own_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_sos_list_own_history() TO authenticated;

/*
  # Circle of Trust — voice encouragements, shared intentions, grace gifts,
    milestone celebrations, anniversaries

  Five additions on top of the existing Circle of Trust (memberships,
  presence, text encouragements, SOS, shared letters). Same posture
  throughout: mutual encouragement, NO feed, NO comparison, everything
  reversible, every new read path returns only a narrow derived signal —
  same conventions as 20260803140000/20260803150000 (RLS enabled with ZERO
  policies for `authenticated` on cross-user tables, all reads/writes via
  SECURITY DEFINER functions pinning `search_path = public, pg_temp`).

  1. Voice encouragements — a 15-20s audio message, same MediaRecorder +
     Supabase Storage pattern as check-in voice notes (see
     20260802190000_voice_transcript_and_private_bucket.sql), but its own
     private bucket (`circle-voice`) since two people (not just the owner)
     need read access. Path convention: `${senderId}/${recipientId}/${uuid}.webm`
     — both segments are checked by the storage policies below, so access
     control lives entirely in the path shape (no cross-table EXISTS
     lookup needed, same simplicity as the existing voice-notes bucket).
     No transcription (intimacy + cost, per product spec).

  2. Shared weekly intentions ("Anchor Together") — one member proposes an
     intention for the week, the other accepts/declines. Acceptance never
     force-overwrites `daily_anchors.daily_intention` — the client treats
     it as a default to pre-select, still freely editable per day (see
     src/pages/home.tsx). Closes naturally every Monday: rows are scoped by
     `week_key` (Postgres `IYYY-"W"IW`, e.g. "2026-W32"; this format is
     internal to this table and circle_grace_gifts only — it's never
     compared against the client-side getISOWeek()-based week_key used by
     move_suggestions/insight_log, so the differing zero-padding between
     the two doesn't matter).

  3. Grace gifts — a circle friend can gift one extra day of streak grace.
     Design choice (documented per the product spec's own request to pick
     the simplest compatible option): rather than trying to pin the gift to
     one specific future calendar date at send time, the existing anchor-
     streak grace algorithm (src/lib/streaks.ts, calculateBestAnchorStreakWithGrace's
     sibling `currentStreakRun`) is generalized from a single boolean
     "1 grace day allowed" to a `graceTokens: number` count. A gift simply
     makes 2 tokens available instead of 1 for that user's CURRENT streak
     calculation. Whether the extra token actually got used (a real gap
     happened) is detected client-side by comparing the streak length WITH
     vs WITHOUT the extra token — if they differ, the gift just protected a
     real gap and the client calls circle_mark_grace_gift_consumed(). This
     keeps the streak functions pure (no DB awareness inside src/lib/streaks.ts)
     and keeps "was it used" a derived fact rather than something this
     migration has to compute. Max 1 gift outstanding (unconsumed) per
     recipient at a time, max 1 sent per sender→recipient pair per week.

  4. Streak milestone log — today, reaching a 7/14/21/30-day anchor streak
     is detected and celebrated PURELY client-side (src/hooks/use-daily-cycle.ts,
     localStorage dedup) with nothing persisted server-side at all. A circle
     friend's device has no way to learn "she hit day 14" without a new
     signal, so this adds one: a simple append-only log the user writes to
     her own row (direct RLS, no RPC needed — it's her own data, no cross-
     user write), plus a SECURITY DEFINER read function scoped to the last
     7 days so old milestones don't resurface stale celebration prompts.

  5. Circle anniversary — no new schema: circle_memberships.accepted_at
     already marks when the circle became active, computed client-side.
     The one new piece here is circle_get_encouragement_count(), a simple
     aggregate (text + voice combined) so the anniversary card can say "X
     encouragements exchanged" without exposing any message content.
*/

-- ============================================================================
-- 1. Voice encouragements
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('circle-voice', 'circle-voice', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Path shape `${senderId}/${recipientId}/${filename}` — both segments are
-- checked directly against auth.uid(), same one-folder-per-user spirit as
-- the voice-notes bucket, just two segments deep so either party's access
-- is expressible without a cross-table lookup.
DROP POLICY IF EXISTS "Circle voice: sender can upload" ON storage.objects;
CREATE POLICY "Circle voice: sender can upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'circle-voice' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Circle voice: sender and recipient can read" ON storage.objects;
CREATE POLICY "Circle voice: sender and recipient can read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'circle-voice' AND (
      (storage.foldername(name))[1] = auth.uid()::text OR
      (storage.foldername(name))[2] = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "Circle voice: sender can delete" ON storage.objects;
CREATE POLICY "Circle voice: sender can delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'circle-voice' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE TABLE IF NOT EXISTS circle_voice_encouragements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  duration_seconds integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CHECK (sender_id <> recipient_id),
  CHECK (duration_seconds > 0 AND duration_seconds <= 20)
);

CREATE INDEX IF NOT EXISTS circle_voice_encouragements_recipient_created_idx
  ON circle_voice_encouragements (recipient_id, created_at DESC);

ALTER TABLE circle_voice_encouragements ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies for `authenticated` — every read/write goes
-- through the SECURITY DEFINER functions below, same posture as
-- circle_encouragements.

CREATE OR REPLACE FUNCTION circle_send_voice_encouragement(p_recipient_id uuid, p_storage_path text, p_duration_seconds integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
  today_count integer;
  new_id uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM circle_memberships
    WHERE user_id = caller AND friend_id = p_recipient_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'not_circle_member' USING ERRCODE = 'P0001';
  END IF;

  IF p_duration_seconds <= 0 OR p_duration_seconds > 20 THEN
    RAISE EXCEPTION 'invalid_duration' USING ERRCODE = 'P0001';
  END IF;

  -- Defense in depth alongside the storage policy's own check: the path's
  -- first segment must be the caller's own id.
  IF p_storage_path NOT LIKE caller::text || '/%' THEN
    RAISE EXCEPTION 'invalid_storage_path' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO today_count
  FROM circle_voice_encouragements
  WHERE sender_id = caller AND recipient_id = p_recipient_id AND created_at::date = CURRENT_DATE;

  IF today_count >= 3 THEN
    RAISE EXCEPTION 'encouragement_limit_reached' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO circle_voice_encouragements (sender_id, recipient_id, storage_path, duration_seconds)
  VALUES (caller, p_recipient_id, p_storage_path, p_duration_seconds)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION circle_send_voice_encouragement(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_send_voice_encouragement(uuid, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION circle_list_voice_encouragements_received()
RETURNS TABLE (id uuid, sender_id uuid, storage_path text, duration_seconds integer, created_at timestamptz, read_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT id, sender_id, storage_path, duration_seconds, created_at, read_at
  FROM circle_voice_encouragements
  WHERE recipient_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION circle_list_voice_encouragements_received() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_list_voice_encouragements_received() TO authenticated;

-- No read_at column, by design — same reasoning as circle_list_encouragements_sent.
CREATE OR REPLACE FUNCTION circle_list_voice_encouragements_sent()
RETURNS TABLE (id uuid, recipient_id uuid, storage_path text, duration_seconds integer, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT id, recipient_id, storage_path, duration_seconds, created_at
  FROM circle_voice_encouragements
  WHERE sender_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION circle_list_voice_encouragements_sent() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_list_voice_encouragements_sent() TO authenticated;

CREATE OR REPLACE FUNCTION circle_mark_voice_encouragement_read(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE circle_voice_encouragements
  SET read_at = now()
  WHERE id = p_id AND recipient_id = auth.uid() AND read_at IS NULL;
$$;

REVOKE ALL ON FUNCTION circle_mark_voice_encouragement_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_mark_voice_encouragement_read(uuid) TO authenticated;

-- ============================================================================
-- 2. Shared weekly intentions ("Anchor Together")
-- ============================================================================

CREATE TABLE IF NOT EXISTS circle_shared_intentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_key text NOT NULL,
  proposer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  intention text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CHECK (proposer_id <> recipient_id),
  UNIQUE (proposer_id, recipient_id, week_key)
);

CREATE INDEX IF NOT EXISTS circle_shared_intentions_recipient_week_idx
  ON circle_shared_intentions (recipient_id, week_key);
CREATE INDEX IF NOT EXISTS circle_shared_intentions_proposer_week_idx
  ON circle_shared_intentions (proposer_id, week_key);

ALTER TABLE circle_shared_intentions ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies for `authenticated` — RPC-only, same posture as above.

CREATE OR REPLACE FUNCTION circle_propose_shared_intention(p_recipient_id uuid, p_intention text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
  current_week text := to_char(CURRENT_DATE, 'IYYY-"W"IW');
  new_id uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM circle_memberships
    WHERE user_id = caller AND friend_id = p_recipient_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'not_circle_member' USING ERRCODE = 'P0001';
  END IF;

  -- Fixed intention list only (src/lib/constants.ts) — no free-text/custom
  -- intention exists anywhere else in the app today, so this doesn't add one.
  IF p_intention NOT IN ('Clarity', 'Courage', 'Love', 'Abundance', 'Peace') THEN
    RAISE EXCEPTION 'invalid_intention' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM circle_shared_intentions
    WHERE week_key = current_week
      AND status IN ('pending', 'accepted')
      AND ((proposer_id = caller AND recipient_id = p_recipient_id) OR (proposer_id = p_recipient_id AND recipient_id = caller))
  ) THEN
    RAISE EXCEPTION 'intention_already_proposed' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO circle_shared_intentions (week_key, proposer_id, recipient_id, intention)
  VALUES (current_week, caller, p_recipient_id, p_intention)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION circle_propose_shared_intention(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_propose_shared_intention(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION circle_respond_shared_intention(p_id uuid, p_accept boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM circle_shared_intentions WHERE id = p_id AND recipient_id = caller AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'proposal_not_found' USING ERRCODE = 'P0001';
  END IF;

  UPDATE circle_shared_intentions
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END, responded_at = now()
  WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION circle_respond_shared_intention(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_respond_shared_intention(uuid, boolean) TO authenticated;

-- This week's proposals involving the caller, either direction, pending or
-- accepted (declined rows aren't returned — nothing to show once declined,
-- per the "never display that she changed her mind" spirit).
CREATE OR REPLACE FUNCTION circle_get_active_shared_intention()
RETURNS TABLE (id uuid, proposer_id uuid, recipient_id uuid, intention text, status text, proposed_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT id, proposer_id, recipient_id, intention, status, proposed_at
  FROM circle_shared_intentions
  WHERE week_key = to_char(CURRENT_DATE, 'IYYY-"W"IW')
    AND status IN ('pending', 'accepted')
    AND (proposer_id = auth.uid() OR recipient_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION circle_get_active_shared_intention() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_get_active_shared_intention() TO authenticated;

-- ============================================================================
-- 3. Grace gifts
-- ============================================================================

CREATE TABLE IF NOT EXISTS circle_grace_gifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_key text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  CHECK (sender_id <> recipient_id),
  UNIQUE (sender_id, recipient_id, week_key)
);

CREATE INDEX IF NOT EXISTS circle_grace_gifts_recipient_idx ON circle_grace_gifts (recipient_id);

ALTER TABLE circle_grace_gifts ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies for `authenticated` — RPC-only.

CREATE OR REPLACE FUNCTION circle_send_grace_gift(p_recipient_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
  current_week text := to_char(CURRENT_DATE, 'IYYY-"W"IW');
  new_id uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM circle_memberships
    WHERE user_id = caller AND friend_id = p_recipient_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'not_circle_member' USING ERRCODE = 'P0001';
  END IF;

  -- Non-cumulable: at most 1 unconsumed gift in stock, from anyone.
  IF EXISTS (
    SELECT 1 FROM circle_grace_gifts WHERE recipient_id = p_recipient_id AND consumed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'gift_already_active' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM circle_grace_gifts
    WHERE sender_id = caller AND recipient_id = p_recipient_id AND week_key = current_week
  ) THEN
    RAISE EXCEPTION 'gift_already_sent_this_week' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO circle_grace_gifts (sender_id, recipient_id, week_key)
  VALUES (caller, p_recipient_id, current_week)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION circle_send_grace_gift(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_send_grace_gift(uuid) TO authenticated;

-- Caller's own unconsumed gift, if any (she's always the recipient here).
CREATE OR REPLACE FUNCTION circle_get_my_grace_gift()
RETURNS TABLE (id uuid, sender_id uuid, sent_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT id, sender_id, sent_at
  FROM circle_grace_gifts
  WHERE recipient_id = auth.uid() AND consumed_at IS NULL
  ORDER BY sent_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION circle_get_my_grace_gift() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_get_my_grace_gift() TO authenticated;

-- Called by the recipient's own client once it detects (by comparing her
-- streak length with/without the extra grace token — see
-- src/hooks/use-daily-cycle.ts) that the gift just protected a real gap.
CREATE OR REPLACE FUNCTION circle_mark_grace_gift_consumed(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE circle_grace_gifts
  SET consumed_at = now()
  WHERE id = p_id AND recipient_id = auth.uid() AND consumed_at IS NULL;
$$;

REVOKE ALL ON FUNCTION circle_mark_grace_gift_consumed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_mark_grace_gift_consumed(uuid) TO authenticated;

-- Soft absence signal (per product spec: "sinon via un signal soft: elle
-- n'est pas apparue 2 jours") — same shape/privacy gating as
-- circle_get_presence_today, just widened to a 2-day window and inverted.
CREATE OR REPLACE FUNCTION circle_get_streak_alerts()
RETURNS TABLE (friend_id uuid, absent boolean)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    cm.friend_id,
    (
      NOT EXISTS (
        SELECT 1 FROM daily_anchors da
        WHERE da.user_id = cm.friend_id
          AND da.date >= CURRENT_DATE - INTERVAL '2 days'
          AND da.anchors_locked_at IS NOT NULL
      )
      AND COALESCE((SELECT p.share_presence_enabled FROM profiles p WHERE p.id = cm.friend_id), true)
    ) AS absent
  FROM circle_memberships cm
  WHERE cm.user_id = auth.uid() AND cm.status = 'active';
$$;

REVOKE ALL ON FUNCTION circle_get_streak_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_get_streak_alerts() TO authenticated;

-- ============================================================================
-- 4. Streak milestone log (server-side signal for circle celebration cards)
-- ============================================================================

CREATE TABLE IF NOT EXISTS anchor_streak_milestones_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  milestone integer NOT NULL CHECK (milestone IN (7, 14, 21, 30)),
  reached_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, milestone)
);

ALTER TABLE anchor_streak_milestones_log ENABLE ROW LEVEL SECURITY;

-- Own data, no cross-user write involved — plain RLS is enough here,
-- unlike the RPC-only tables above.
CREATE POLICY "Users can log own milestones"
  ON anchor_streak_milestones_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own milestones"
  ON anchor_streak_milestones_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Recent (7d) milestones from active circle friends only — narrow signal
-- (which milestone, when), never raw streak/task data.
CREATE OR REPLACE FUNCTION circle_get_recent_milestones()
RETURNS TABLE (friend_id uuid, milestone integer, reached_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT m.user_id, m.milestone, m.reached_at
  FROM anchor_streak_milestones_log m
  JOIN circle_memberships cm ON cm.friend_id = m.user_id AND cm.user_id = auth.uid() AND cm.status = 'active'
  WHERE m.reached_at >= now() - INTERVAL '7 days'
  ORDER BY m.reached_at DESC;
$$;

REVOKE ALL ON FUNCTION circle_get_recent_milestones() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_get_recent_milestones() TO authenticated;

-- ============================================================================
-- 5. Circle anniversary — aggregate only, no new schema needed otherwise
-- ============================================================================

CREATE OR REPLACE FUNCTION circle_get_encouragement_count(p_friend_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
  total integer;
BEGIN
  IF caller IS NULL OR NOT EXISTS (
    SELECT 1 FROM circle_memberships WHERE user_id = caller AND friend_id = p_friend_id AND status = 'active'
  ) THEN
    RETURN 0;
  END IF;

  SELECT
    (SELECT count(*) FROM circle_encouragements
      WHERE (sender_id = caller AND recipient_id = p_friend_id) OR (sender_id = p_friend_id AND recipient_id = caller))
    +
    (SELECT count(*) FROM circle_voice_encouragements
      WHERE (sender_id = caller AND recipient_id = p_friend_id) OR (sender_id = p_friend_id AND recipient_id = caller))
  INTO total;

  RETURN total;
END;
$$;

REVOKE ALL ON FUNCTION circle_get_encouragement_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_get_encouragement_count(uuid) TO authenticated;

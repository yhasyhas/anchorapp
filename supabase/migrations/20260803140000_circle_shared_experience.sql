/*
  # Circle of Trust — shared experience layer

  The previous migration (20260803130000) built membership/invites only and
  deliberately opened no data between circle members. This one is that "lot
  R": daily presence (not content), mutual encouragements, and opt-in weekly
  letter sharing. Golden rule enforced throughout: mutual encouragement, NO
  feed, NO likes, NO comparison — every new read path returns only a narrow,
  derived signal, never raw rows from daily_anchors/mood_logs/check_ins.

  1. Presence — no new table.
    `daily_anchors.anchors_locked_at IS NOT NULL` for today already means
    "she locked in her day" (the app's existing daily-cycle milestone). A
    SECURITY DEFINER function (`circle_get_presence_today`) derives a plain
    boolean from it, gated by `profiles.share_presence_enabled`, and never
    exposes task content, mood, or historical presence.

  2. `profiles.share_presence_enabled boolean NOT NULL DEFAULT true` — global
     "share my presence with my circle" toggle. Only presence is gated by
     this; encouragements remain possible either way.

  3. `circle_encouragements` — sender_id, recipient_id, message, is_preset,
     created_at, read_at. RLS enabled, ZERO policies for `authenticated` —
     every read and write goes through a SECURITY DEFINER function, same
     posture as `circle_memberships`/`circle_invites`. This is also how "the
     sender can never learn read status" is enforced structurally: the
     "sent" list function's return type has no `read_at` column at all, so
     there is no query shape that could ever reveal it to her.

  4. `weekly_letters.shared_with_circle boolean NOT NULL DEFAULT false` — an
     explicit, reversible, one-row-at-a-time opt-in per letter. A new UPDATE
     policy lets the owner flip her own flag (she already owns the whole
     row; no column-level restriction needed there). Reading a *friend's*
     shared letters needs a SECURITY DEFINER function, since the existing
     SELECT policy on weekly_letters stays owner-only.

  Every SECURITY DEFINER function below pins `search_path = public, pg_temp`
  and has EXECUTE revoked from PUBLIC / granted only to the roles that need
  it — same convention established in the previous migration.
*/

-- ============================================================================
-- Presence
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS share_presence_enabled boolean NOT NULL DEFAULT true;

-- Returns present=false both when she genuinely hasn't locked in today AND
-- when sharing is switched off — deliberately indistinguishable to the
-- viewer, so disabling the toggle can never read as "she's been absent."
-- The UI only ever renders the true case, never a negative state.
CREATE OR REPLACE FUNCTION circle_get_presence_today()
RETURNS TABLE (friend_id uuid, present boolean)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    cm.friend_id,
    (
      EXISTS (
        SELECT 1 FROM daily_anchors da
        WHERE da.user_id = cm.friend_id
          AND da.date = CURRENT_DATE
          AND da.anchors_locked_at IS NOT NULL
      )
      AND COALESCE((SELECT p.share_presence_enabled FROM profiles p WHERE p.id = cm.friend_id), true)
    ) AS present
  FROM circle_memberships cm
  WHERE cm.user_id = auth.uid() AND cm.status = 'active';
$$;

REVOKE ALL ON FUNCTION circle_get_presence_today() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_get_presence_today() TO authenticated;

-- ============================================================================
-- Encouragements
-- ============================================================================

CREATE TABLE IF NOT EXISTS circle_encouragements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message text NOT NULL,
  is_preset boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CHECK (sender_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS circle_encouragements_recipient_created_idx ON circle_encouragements (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS circle_encouragements_sender_recipient_created_idx ON circle_encouragements (sender_id, recipient_id, created_at);

ALTER TABLE circle_encouragements ENABLE ROW LEVEL SECURITY;

-- Deliberately no policies for `authenticated` at all — every read/write
-- goes through the SECURITY DEFINER functions below.

-- Send an encouragement. p_message is either a fixed preset KEY (translated
-- client-side, in the RECIPIENT's own language at render time — never the
-- sender's) or free text, 1-140 chars. Rate-limited to 3/day per recipient.
CREATE OR REPLACE FUNCTION circle_send_encouragement(p_recipient_id uuid, p_message text, p_is_preset boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
  today_count integer;
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

  IF p_is_preset THEN
    IF p_message NOT IN (
      'thinking_of_you', 'proud_of_you', 'one_gentle_step', 'sending_warmth',
      'you_are_doing_great', 'here_for_you', 'small_steps_count', 'holding_you_gently'
    ) THEN
      RAISE EXCEPTION 'invalid_preset' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF length(trim(p_message)) = 0 OR length(p_message) > 140 THEN
      RAISE EXCEPTION 'invalid_message' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT count(*) INTO today_count
  FROM circle_encouragements
  WHERE sender_id = caller AND recipient_id = p_recipient_id AND created_at::date = CURRENT_DATE;

  IF today_count >= 3 THEN
    RAISE EXCEPTION 'encouragement_limit_reached' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO circle_encouragements (sender_id, recipient_id, message, is_preset)
  VALUES (caller, p_recipient_id, p_message, p_is_preset);
END;
$$;

REVOKE ALL ON FUNCTION circle_send_encouragement(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_send_encouragement(uuid, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION circle_list_encouragements_received()
RETURNS TABLE (id uuid, sender_id uuid, message text, is_preset boolean, created_at timestamptz, read_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT id, sender_id, message, is_preset, created_at, read_at
  FROM circle_encouragements
  WHERE recipient_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION circle_list_encouragements_received() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_list_encouragements_received() TO authenticated;

-- No read_at column here, by design — there is no query shape through which
-- a sender could ever learn whether her message was read.
CREATE OR REPLACE FUNCTION circle_list_encouragements_sent()
RETURNS TABLE (id uuid, recipient_id uuid, message text, is_preset boolean, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT id, recipient_id, message, is_preset, created_at
  FROM circle_encouragements
  WHERE sender_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION circle_list_encouragements_sent() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_list_encouragements_sent() TO authenticated;

CREATE OR REPLACE FUNCTION circle_mark_encouragement_read(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE circle_encouragements
  SET read_at = now()
  WHERE id = p_id AND recipient_id = auth.uid() AND read_at IS NULL;
$$;

REVOKE ALL ON FUNCTION circle_mark_encouragement_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_mark_encouragement_read(uuid) TO authenticated;

-- ============================================================================
-- Weekly letter sharing
-- ============================================================================

ALTER TABLE weekly_letters ADD COLUMN IF NOT EXISTS shared_with_circle boolean NOT NULL DEFAULT false;

CREATE POLICY "Users can update own weekly letters"
  ON weekly_letters FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION circle_get_shared_letters()
RETURNS TABLE (friend_id uuid, week_start date, week_end date, letter_text text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT wl.user_id, wl.week_start, wl.week_end, wl.letter_text
  FROM weekly_letters wl
  JOIN circle_memberships cm ON cm.friend_id = wl.user_id AND cm.user_id = auth.uid() AND cm.status = 'active'
  WHERE wl.shared_with_circle = true
  ORDER BY wl.week_end DESC
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION circle_get_shared_letters() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_get_shared_letters() TO authenticated;

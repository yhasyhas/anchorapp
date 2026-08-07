/*
  # Circle of Trust — voice replies

  Lets the recipient of a voice encouragement reply with her own voice,
  linked back to the note she's answering. Reuses everything from
  20260808120000_circle_features.sql (bucket, storage policies, rate
  limit) unchanged — a reply is just a normal circle_voice_encouragements
  row with sender/recipient swapped, plus a nullable `reply_to_id` back-
  pointer. No new table, no read-receipt surface: `reply_to_id` is
  visible on both the received and sent list functions (it's just "what
  this note is about", not "was it heard"), but `read_at` stays exactly
  as narrow as before — sent rows still never expose it.

  Threading is intentionally shallow: `reply_to_id` can only point at a
  note the caller received directly, and the reply must be addressed
  back to that note's original sender. That keeps every thread exactly
  one reply deep server-side too, matching the "no infinite thread, just
  question/answer pairs" product intent — a reply-to-a-reply still works
  (nothing stops it), but the client only ever visually groups one level.
*/

ALTER TABLE circle_voice_encouragements
  ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES circle_voice_encouragements(id) ON DELETE SET NULL;

DROP FUNCTION IF EXISTS circle_send_voice_encouragement(uuid, text, integer);

CREATE OR REPLACE FUNCTION circle_send_voice_encouragement(
  p_recipient_id uuid,
  p_storage_path text,
  p_duration_seconds integer,
  p_reply_to_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
  today_count integer;
  new_id uuid;
  parent_sender uuid;
  parent_recipient uuid;
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

  -- A reply must point at a note the caller actually received, and must be
  -- addressed back to that note's original sender — enforced server-side so
  -- a forged reply_to_id can't link unrelated threads or fake a reply from
  -- someone who never sent the original.
  IF p_reply_to_id IS NOT NULL THEN
    SELECT sender_id, recipient_id INTO parent_sender, parent_recipient
    FROM circle_voice_encouragements
    WHERE id = p_reply_to_id;

    IF parent_sender IS NULL THEN
      RAISE EXCEPTION 'reply_target_not_found' USING ERRCODE = 'P0001';
    END IF;

    IF parent_recipient <> caller OR parent_sender <> p_recipient_id THEN
      RAISE EXCEPTION 'invalid_reply_target' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT count(*) INTO today_count
  FROM circle_voice_encouragements
  WHERE sender_id = caller AND recipient_id = p_recipient_id AND created_at::date = CURRENT_DATE;

  IF today_count >= 3 THEN
    RAISE EXCEPTION 'encouragement_limit_reached' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO circle_voice_encouragements (sender_id, recipient_id, storage_path, duration_seconds, reply_to_id)
  VALUES (caller, p_recipient_id, p_storage_path, p_duration_seconds, p_reply_to_id)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION circle_send_voice_encouragement(uuid, text, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_send_voice_encouragement(uuid, text, integer, uuid) TO authenticated;

DROP FUNCTION IF EXISTS circle_list_voice_encouragements_received();

CREATE OR REPLACE FUNCTION circle_list_voice_encouragements_received()
RETURNS TABLE (id uuid, sender_id uuid, storage_path text, duration_seconds integer, created_at timestamptz, read_at timestamptz, reply_to_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT id, sender_id, storage_path, duration_seconds, created_at, read_at, reply_to_id
  FROM circle_voice_encouragements
  WHERE recipient_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION circle_list_voice_encouragements_received() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_list_voice_encouragements_received() TO authenticated;

DROP FUNCTION IF EXISTS circle_list_voice_encouragements_sent();

-- Still no read_at column, by design — unchanged from 20260808120000.
-- reply_to_id is fine to expose here: it says what the sender was replying
-- to, not whether her note was heard.
CREATE OR REPLACE FUNCTION circle_list_voice_encouragements_sent()
RETURNS TABLE (id uuid, recipient_id uuid, storage_path text, duration_seconds integer, created_at timestamptz, reply_to_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT id, recipient_id, storage_path, duration_seconds, created_at, reply_to_id
  FROM circle_voice_encouragements
  WHERE sender_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION circle_list_voice_encouragements_sent() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_list_voice_encouragements_sent() TO authenticated;

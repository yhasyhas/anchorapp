/*
  # Circle of Trust — membership & invite layer only

  This is the first step of "Circle of Trust": a woman can invite 1–2 close
  friends into a small, private circle so they can encourage each other.
  Explicit non-negotiables from the product spec: no feed, no likes, no
  ranking, no comparative metrics, sharing minimal and reversible at any
  time. This migration builds ONLY the membership/invite layer. It does NOT
  open any actual data (moods, anchors, check-ins) between circle members —
  that is a separate future milestone ("lot R"); see the big comment near
  the bottom of this file for the policy shape that milestone will add.

  1. New Tables
    - `circle_memberships` — one row PER DIRECTION of a relationship (A→B
      and B→A are two separate rows, not one shared row). See the design
      note above the table for why.
      - `id`, `user_id`, `friend_id` (both FK auth.users, cascade delete)
      - `status` ('pending' | 'active' | 'declined')
      - `invited_by` (FK auth.users) — who initiated this relationship.
        Both mirrored rows store the SAME `invited_by` value, so a row
        where `invited_by = user_id` is "I sent this invite" and a row
        where `invited_by = friend_id` is "I received this invite" — the
        only way to tell the two apart in the UI, since otherwise the two
        directions of a pending invite are structurally identical. Not in
        the original spec's column list, added because the UI cannot
        render "waiting for her" vs. "accept / not yet" without it.
      - `invited_at`, `accepted_at`
      - UNIQUE(user_id, friend_id)
    - `circle_invites` — token-based invites for people who don't have an
      account yet (invite-by-email branch only; an existing-account invite
      never creates a row here, see `circle_invite_by_email` below).
      - `id`, `token` (uuid, unique, the link's secret)
      - `inviter_id` (FK auth.users)
      - `invitee_email`, `status` ('pending' | 'accepted')
      - `created_at`, `expires_at` (7 days from creation)
      - UNIQUE(inviter_id, invitee_email) — re-inviting the same still-
        unregistered address upserts instead of erroring.

  2. Security
    - RLS enabled on both tables. `circle_memberships` gets a single SELECT
      policy (own rows only) — there is deliberately NO insert/update/delete
      policy for `authenticated`: every mutation needs to touch the OTHER
      person's row too (accept flips both directions, remove deletes both),
      which a same-row policy can never express safely. All writes instead
      go through the SECURITY DEFINER functions below.
    - `circle_invites` gets a single SELECT policy (own invites, as
      inviter) so the Settings UI can list "invitations sent, still
      pending". No direct insert/update policy — same reasoning.
    - Friends' display names: RLS is row-level, not column-level. A naive
      "circle members can read each other's profile" policy would leak
      EVERY column of `profiles` (ai_enabled, tone, timezone,
      onboarded_at...), not just full_name. `circle_get_member_names()`
      below is a SECURITY DEFINER function that returns only
      `(friend_id, full_name)`, which is the only way to give column-level
      granularity on top of Postgres RLS. This is the first SECURITY
      DEFINER function in this schema — every one below pins
      `search_path = public, pg_temp` explicitly (defense against
      search_path hijacking) and EXECUTE is granted only to the roles that
      actually need it.

  3. Business rule: max 2 active members per circle
    - Enforced at the database level by the `enforce_circle_max_active`
      trigger (BEFORE INSERT OR UPDATE, fires only when the incoming row's
      status is 'active') — this is the real, un-bypassable guarantee.
    - Also checked up front inside the RPC functions so the client gets a
      clean, translatable error code instead of a raw Postgres exception.
*/

-- ============================================================================
-- Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS circle_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'declined')),
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  UNIQUE (user_id, friend_id),
  CHECK (user_id <> friend_id)
);

CREATE INDEX IF NOT EXISTS circle_memberships_user_id_status_idx ON circle_memberships (user_id, status);
CREATE INDEX IF NOT EXISTS circle_memberships_friend_id_idx ON circle_memberships (friend_id);

ALTER TABLE circle_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own circle memberships"
  ON circle_memberships FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Deliberately no INSERT/UPDATE/DELETE policy for `authenticated` — see
-- comment block at the top of this file. All mutations go through the
-- SECURITY DEFINER functions below, which run as the function owner and
-- therefore bypass RLS internally while still enforcing the real rules.

CREATE TABLE IF NOT EXISTS circle_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  inviter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invitee_email text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  UNIQUE (inviter_id, invitee_email)
);

CREATE INDEX IF NOT EXISTS circle_invites_inviter_id_idx ON circle_invites (inviter_id);

ALTER TABLE circle_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own sent circle invites"
  ON circle_invites FOR SELECT
  TO authenticated
  USING (auth.uid() = inviter_id);

-- ============================================================================
-- Max-2-active-members trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION enforce_circle_max_active()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  active_count integer;
BEGIN
  SELECT count(*) INTO active_count
  FROM circle_memberships
  WHERE user_id = NEW.user_id
    AND status = 'active'
    AND id <> NEW.id;

  IF active_count >= 2 THEN
    RAISE EXCEPTION 'circle_full' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS circle_memberships_enforce_max_active ON circle_memberships;
CREATE TRIGGER circle_memberships_enforce_max_active
  BEFORE INSERT OR UPDATE ON circle_memberships
  FOR EACH ROW
  WHEN (NEW.status = 'active')
  EXECUTE FUNCTION enforce_circle_max_active();

-- ============================================================================
-- SECURITY DEFINER functions — all cross-user mutation/reads go through
-- these, never through direct table access from the client.
-- ============================================================================

-- Bulk name lookup: returns (friend_id, full_name) for every relationship
-- row the CALLER has (any status — pending-received/pending-sent/active all
-- need a name to render), never anything else from `profiles`.
CREATE OR REPLACE FUNCTION circle_get_member_names()
RETURNS TABLE (friend_id uuid, full_name text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT cm.friend_id, p.full_name
  FROM circle_memberships cm
  JOIN profiles p ON p.id = cm.friend_id
  WHERE cm.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION circle_get_member_names() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_get_member_names() TO authenticated;

-- Invite by email. Looks up auth.users directly (only possible because this
-- runs SECURITY DEFINER — a normal client can never query auth.users), so
-- the "does she already have an account" check never leaks anything back to
-- the client beyond the two outcomes below.
CREATE OR REPLACE FUNCTION circle_invite_by_email(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
  caller_email text;
  normalized_email text := lower(trim(p_email));
  target_id uuid;
  active_count integer;
  existing_status text;
  new_token uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT email INTO caller_email FROM auth.users WHERE id = caller;
  IF caller_email IS NOT NULL AND lower(trim(caller_email)) = normalized_email THEN
    RAISE EXCEPTION 'cannot_invite_self' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO active_count
  FROM circle_memberships
  WHERE user_id = caller AND status = 'active';
  IF active_count >= 2 THEN
    RAISE EXCEPTION 'circle_full' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO target_id FROM auth.users WHERE lower(trim(email)) = normalized_email;

  IF target_id IS NOT NULL THEN
    SELECT status INTO existing_status
    FROM circle_memberships
    WHERE user_id = caller AND friend_id = target_id;

    IF existing_status = 'active' THEN
      RAISE EXCEPTION 'already_member' USING ERRCODE = 'P0001';
    ELSIF existing_status = 'pending' THEN
      RAISE EXCEPTION 'already_pending' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO circle_memberships (user_id, friend_id, status, invited_by, invited_at, accepted_at)
    VALUES (caller, target_id, 'pending', caller, now(), NULL)
    ON CONFLICT (user_id, friend_id)
      DO UPDATE SET status = 'pending', invited_by = caller, invited_at = now(), accepted_at = NULL;

    INSERT INTO circle_memberships (user_id, friend_id, status, invited_by, invited_at, accepted_at)
    VALUES (target_id, caller, 'pending', caller, now(), NULL)
    ON CONFLICT (user_id, friend_id)
      DO UPDATE SET status = 'pending', invited_by = caller, invited_at = now(), accepted_at = NULL;

    RETURN jsonb_build_object('matched', true, 'friend_id', target_id);
  ELSE
    INSERT INTO circle_invites (inviter_id, invitee_email, status, created_at, expires_at)
    VALUES (caller, normalized_email, 'pending', now(), now() + interval '7 days')
    ON CONFLICT (inviter_id, invitee_email)
      DO UPDATE SET status = 'pending', created_at = now(), expires_at = now() + interval '7 days'
    RETURNING token INTO new_token;

    RETURN jsonb_build_object('matched', false, 'token', new_token, 'invitee_email', normalized_email);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION circle_invite_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_invite_by_email(text) TO authenticated;

-- Accept an in-app pending invite (existing-account branch). Flips BOTH
-- direction rows to active atomically.
CREATE OR REPLACE FUNCTION circle_accept_pending(p_inviter_id uuid)
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
    SELECT 1 FROM circle_memberships
    WHERE user_id = caller AND friend_id = p_inviter_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0001';
  END IF;

  UPDATE circle_memberships
  SET status = 'active', accepted_at = now()
  WHERE user_id = caller AND friend_id = p_inviter_id;

  UPDATE circle_memberships
  SET status = 'active', accepted_at = now()
  WHERE user_id = p_inviter_id AND friend_id = caller;
END;
$$;

REVOKE ALL ON FUNCTION circle_accept_pending(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_accept_pending(uuid) TO authenticated;

-- Decline an in-app pending invite. Quiet by design: the inviter gets no
-- notification, her copy of the row just moves to 'declined' and stops
-- showing up as pending next time she looks.
CREATE OR REPLACE FUNCTION circle_decline_pending(p_inviter_id uuid)
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

  UPDATE circle_memberships
  SET status = 'declined'
  WHERE user_id = caller AND friend_id = p_inviter_id AND status = 'pending';

  UPDATE circle_memberships
  SET status = 'declined'
  WHERE user_id = p_inviter_id AND friend_id = caller AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION circle_decline_pending(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_decline_pending(uuid) TO authenticated;

-- Remove a member: deletes BOTH direction rows immediately, no lingering
-- history row. Sharing stops instantly on both sides.
CREATE OR REPLACE FUNCTION circle_remove_member(p_friend_id uuid)
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

  DELETE FROM circle_memberships WHERE user_id = caller AND friend_id = p_friend_id;
  DELETE FROM circle_memberships WHERE user_id = p_friend_id AND friend_id = caller;
END;
$$;

REVOKE ALL ON FUNCTION circle_remove_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_remove_member(uuid) TO authenticated;

-- Public-safe preview for the /circle/invite/:token landing page. Granted to
-- `anon` too since a visitor may not be signed in yet — only ever returns the
-- inviter's name (never anything else from her profile), the invitee email
-- the link was sent to, and status/expiry.
CREATE OR REPLACE FUNCTION circle_get_invite_preview(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  invite_row circle_invites%ROWTYPE;
  inviter_name text;
BEGIN
  SELECT * INTO invite_row FROM circle_invites WHERE token = p_token;

  IF invite_row.id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF invite_row.status = 'accepted' THEN
    RETURN jsonb_build_object('status', 'accepted');
  END IF;

  IF invite_row.expires_at < now() THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  SELECT full_name INTO inviter_name FROM profiles WHERE id = invite_row.inviter_id;

  RETURN jsonb_build_object(
    'status', 'pending',
    'inviter_name', inviter_name,
    'invitee_email', invite_row.invitee_email,
    'expires_at', invite_row.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION circle_get_invite_preview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_get_invite_preview(uuid) TO authenticated, anon;

-- Accept via emailed token link. Requires the caller to be authenticated
-- (client redirects to sign-in/register first, carrying ?redirect= back to
-- the landing page). Matches the caller's own email against invitee_email
-- as defense-in-depth beyond the token's own secrecy.
CREATE OR REPLACE FUNCTION circle_accept_invite_by_token(p_token uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
  caller_email text;
  invite_row circle_invites%ROWTYPE;
  inviter_active_count integer;
  caller_active_count integer;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO invite_row FROM circle_invites WHERE token = p_token;
  IF invite_row.id IS NULL THEN
    RAISE EXCEPTION 'invite_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF invite_row.status = 'accepted' THEN
    RAISE EXCEPTION 'invite_already_used' USING ERRCODE = 'P0001';
  END IF;
  IF invite_row.expires_at < now() THEN
    RAISE EXCEPTION 'invite_expired' USING ERRCODE = 'P0001';
  END IF;

  SELECT email INTO caller_email FROM auth.users WHERE id = caller;
  IF caller_email IS NULL OR lower(trim(caller_email)) <> lower(trim(invite_row.invitee_email)) THEN
    RAISE EXCEPTION 'email_mismatch' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO inviter_active_count
  FROM circle_memberships WHERE user_id = invite_row.inviter_id AND status = 'active';
  IF inviter_active_count >= 2 THEN
    RAISE EXCEPTION 'inviter_circle_full' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO caller_active_count
  FROM circle_memberships WHERE user_id = caller AND status = 'active';
  IF caller_active_count >= 2 THEN
    RAISE EXCEPTION 'circle_full' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO circle_memberships (user_id, friend_id, status, invited_by, invited_at, accepted_at)
  VALUES (invite_row.inviter_id, caller, 'active', invite_row.inviter_id, invite_row.created_at, now())
  ON CONFLICT (user_id, friend_id)
    DO UPDATE SET status = 'active', invited_by = invite_row.inviter_id, accepted_at = now();

  INSERT INTO circle_memberships (user_id, friend_id, status, invited_by, invited_at, accepted_at)
  VALUES (caller, invite_row.inviter_id, 'active', invite_row.inviter_id, invite_row.created_at, now())
  ON CONFLICT (user_id, friend_id)
    DO UPDATE SET status = 'active', invited_by = invite_row.inviter_id, accepted_at = now();

  UPDATE circle_invites SET status = 'accepted' WHERE id = invite_row.id;
END;
$$;

REVOKE ALL ON FUNCTION circle_accept_invite_by_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_accept_invite_by_token(uuid) TO authenticated;

-- ============================================================================
-- FUTURE (lot R, NOT enabled here): data-sharing between circle members.
--
-- This migration deliberately does not open mood_logs / daily_anchors /
-- check_ins to circle friends — only the membership/invite layer above.
-- When that milestone is scoped, the template each of those tables' extra
-- SELECT policy should follow is:
--
--   CREATE POLICY "Circle members can read shared <table>"
--     ON <table> FOR SELECT
--     TO authenticated
--     USING (
--       auth.uid() = user_id
--       OR EXISTS (
--         SELECT 1 FROM circle_memberships cm
--         WHERE cm.user_id = auth.uid()
--           AND cm.friend_id = <table>.user_id
--           AND cm.status = 'active'
--       )
--     );
--
-- Row-level sharing is fine there (unlike `profiles`) because every column
-- on those tables is meant to become shareable — there's no column-level
-- secret to protect the way profiles.ai_enabled/tone/timezone are. Do not
-- add this policy until lot R explicitly turns data-sharing on.
-- ============================================================================

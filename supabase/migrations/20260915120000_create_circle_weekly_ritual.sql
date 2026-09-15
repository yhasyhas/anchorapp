/*
  # Circle of Trust — weekly shared ritual

  A single question, shared between exactly two circle members, revealed to
  each of them only once BOTH have answered. Same relational model as
  circle_shared_intentions / circle_grace_gifts (20260808120000): this
  schema has no "circle" entity at all — `circle_memberships` is a per-
  DIRECTION friend graph capped at 2 active rows per user (see
  20260803130000's own design note), so every existing "shared" feature is
  modeled pairwise (proposer/recipient, sender/recipient), never as an
  N-person group. This follows suit: one ritual thread per active
  friendship, not one per user's whole (up to 3-person) circle. A user with
  2 active friends gets two independent weekly threads, same as she already
  gets two independent shared-intention/grace-gift relationships today.

  1. New Tables
    - `circle_weekly_prompts` — one row per (friend pair, ISO week).
      - `id`, `user_a`/`user_b` (FK auth.users, CHECK user_a < user_b so a
        dyad can never produce two rows for the same week regardless of who
        triggers creation first — see circle_get_weekly_ritual below)
      - `week_key` (text, `to_char(CURRENT_DATE, 'IYYY-"W"IW')` — same
        internal format as circle_shared_intentions/circle_grace_gifts;
        ISO weeks start Monday, giving the "rotates every Monday" behavior
        for free with no cron job)
      - `prompt_key` (text) — one of a fixed rotation, see
        WEEKLY_RITUAL_PROMPT_KEYS in src/lib/circle-weekly-ritual.ts (kept
        in sync by hand, same convention as this schema's other fixed-list
        columns like circle_shared_intentions.intention). Text lives
        client-side, resolved via i18n — this column only stores the key.
      - `created_at`
      - UNIQUE (user_a, user_b, week_key)
    - `circle_weekly_responses` — one row per (prompt, user).
      - `id`, `circle_prompt_id` (FK circle_weekly_prompts, cascade),
        `user_id` (FK auth.users, cascade), `response` (text, 1-300 chars,
        enforced in the RPC below), `created_at`
      - UNIQUE (circle_prompt_id, user_id) — the "one response per user per
        prompt" rule from the spec, at the database level.

  2. Security — the core requirement
    RLS enabled on both tables, ZERO policies for `authenticated` (same
    posture as every other cross-user Circle table: circle_memberships,
    circle_encouragements, circle_shared_intentions, circle_grace_gifts).
    All reads and writes go through the SECURITY DEFINER functions below.

    This is deliberate, not just "for consistency": the actual leak rule —
    "you may read the pair's responses only once YOUR OWN response for this
    prompt already exists" — is a condition on a DIFFERENT row (yours) than
    the one being read (hers), which a single-row RLS USING clause can only
    express via a self-referencing subquery on the same table. That pattern
    is a known Postgres foot-gun (the subquery is itself subject to the same
    policy, recursing through row-security evaluation) and isn't needed
    here anyway, since every other multi-party Circle table already solved
    this exact class of problem the same way: push the whole read behind a
    STABLE SECURITY DEFINER function that computes the reveal server-side
    and simply never puts the other person's answer in its return value
    until it's earned. circle_get_weekly_ritual below withholds
    `other_answered` (not just the text) until the caller has answered, so
    "has she answered yet" leaks nothing before the caller has contributed
    her own — the network response itself never carries the unrevealed
    state, let alone its content.

  3. Rotation: circle_get_weekly_ritual computes the current ISO week's
     prompt_key from `to_char(CURRENT_DATE, 'IW')::int` modulo the fixed
     prompt count, then get-or-creates the (user_a, user_b, week_key) row —
     same lazy-materialize-on-first-read pattern already used for weekly
     move_suggestions (see src/pages/move.tsx's ensureWeeklySuggestions).
     No dynamic generation, no AI, per spec.
*/

CREATE TABLE IF NOT EXISTS circle_weekly_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_key text NOT NULL,
  prompt_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_a < user_b),
  UNIQUE (user_a, user_b, week_key)
);

CREATE INDEX IF NOT EXISTS circle_weekly_prompts_pair_idx ON circle_weekly_prompts (user_a, user_b);

ALTER TABLE circle_weekly_prompts ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies for `authenticated` — RPC-only, see above.

CREATE TABLE IF NOT EXISTS circle_weekly_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_prompt_id uuid NOT NULL REFERENCES circle_weekly_prompts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  response text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (circle_prompt_id, user_id)
);

ALTER TABLE circle_weekly_responses ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies for `authenticated` — RPC-only, see above.

-- ============================================================================
-- SECURITY DEFINER functions
-- ============================================================================

-- This ISO week's prompt key — shared by circle_get_weekly_ritual and
-- circle_submit_weekly_response so the fixed list only lives in one place.
-- Kept in sync BY HAND with WEEKLY_RITUAL_PROMPT_KEYS in
-- src/lib/circle-weekly-ritual.ts (same convention as this schema's other
-- fixed lists, e.g. circle_shared_intentions.intention).
CREATE OR REPLACE FUNCTION circle_current_weekly_prompt_key()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT (ARRAY[
    'aligned_moment', 'small_help', 'proud_of', 'let_go',
    'unexpected_good', 'leaning_on', 'brave_moment', 'grateful_for'
  ])[(to_char(CURRENT_DATE, 'IW')::integer % 8) + 1];
$$;

-- Not SECURITY DEFINER and touches no table — just which predefined
-- question is active, same non-secret as the fixed Move-suggestion pool.
-- Left callable by any authenticated user (also lets rotation be verified
-- directly rather than only indirectly through a friend pair).
GRANT EXECUTE ON FUNCTION circle_current_weekly_prompt_key() TO authenticated;

-- Get-or-create this week's prompt for (caller, p_friend_id) and return the
-- full ritual state from the caller's point of view. Withholds
-- `other_answered`/`responses` entirely (not merely null-text) until the
-- caller has answered — see the migration comment above for why this can't
-- just be a table + RLS policy.
CREATE OR REPLACE FUNCTION circle_get_weekly_ritual(p_friend_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
  ua uuid;
  ub uuid;
  wk text := to_char(CURRENT_DATE, 'IYYY-"W"IW');
  prompt_row circle_weekly_prompts%ROWTYPE;
  my_resp text;
  friend_resp text;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM circle_memberships
    WHERE user_id = caller AND friend_id = p_friend_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'not_circle_member' USING ERRCODE = 'P0001';
  END IF;

  ua := LEAST(caller, p_friend_id);
  ub := GREATEST(caller, p_friend_id);

  SELECT * INTO prompt_row FROM circle_weekly_prompts WHERE user_a = ua AND user_b = ub AND week_key = wk;

  IF prompt_row.id IS NULL THEN
    INSERT INTO circle_weekly_prompts (user_a, user_b, week_key, prompt_key)
    VALUES (ua, ub, wk, circle_current_weekly_prompt_key())
    ON CONFLICT (user_a, user_b, week_key) DO NOTHING;

    SELECT * INTO prompt_row FROM circle_weekly_prompts WHERE user_a = ua AND user_b = ub AND week_key = wk;
  END IF;

  SELECT response INTO my_resp FROM circle_weekly_responses WHERE circle_prompt_id = prompt_row.id AND user_id = caller;

  IF my_resp IS NULL THEN
    RETURN jsonb_build_object(
      'prompt_id', prompt_row.id,
      'week_key', prompt_row.week_key,
      'prompt_key', prompt_row.prompt_key,
      'my_response', NULL,
      'other_answered', NULL,
      'revealed', false,
      'responses', NULL
    );
  END IF;

  SELECT response INTO friend_resp FROM circle_weekly_responses WHERE circle_prompt_id = prompt_row.id AND user_id = p_friend_id;

  IF friend_resp IS NULL THEN
    RETURN jsonb_build_object(
      'prompt_id', prompt_row.id,
      'week_key', prompt_row.week_key,
      'prompt_key', prompt_row.prompt_key,
      'my_response', my_resp,
      'other_answered', false,
      'revealed', false,
      'responses', NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'prompt_id', prompt_row.id,
    'week_key', prompt_row.week_key,
    'prompt_key', prompt_row.prompt_key,
    'my_response', my_resp,
    'other_answered', true,
    'revealed', true,
    'responses', jsonb_build_array(
      jsonb_build_object('user_id', caller, 'response', my_resp),
      jsonb_build_object('user_id', p_friend_id, 'response', friend_resp)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION circle_get_weekly_ritual(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_get_weekly_ritual(uuid) TO authenticated;

-- Submit (once) the caller's answer for this week's prompt with p_friend_id,
-- then return the fresh state (same shape as circle_get_weekly_ritual) so
-- the client doesn't need a second round trip.
CREATE OR REPLACE FUNCTION circle_submit_weekly_response(p_friend_id uuid, p_response text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
  trimmed text := trim(p_response);
  ua uuid;
  ub uuid;
  wk text := to_char(CURRENT_DATE, 'IYYY-"W"IW');
  prompt_id uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM circle_memberships
    WHERE user_id = caller AND friend_id = p_friend_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'not_circle_member' USING ERRCODE = 'P0001';
  END IF;

  IF length(trimmed) = 0 OR length(trimmed) > 300 THEN
    RAISE EXCEPTION 'invalid_response' USING ERRCODE = 'P0001';
  END IF;

  -- Same get-or-create as circle_get_weekly_ritual (kept inline rather than
  -- calling it, since this needs the raw prompt id, not the jsonb shape).
  ua := LEAST(caller, p_friend_id);
  ub := GREATEST(caller, p_friend_id);

  SELECT id INTO prompt_id FROM circle_weekly_prompts WHERE user_a = ua AND user_b = ub AND week_key = wk;
  IF prompt_id IS NULL THEN
    INSERT INTO circle_weekly_prompts (user_a, user_b, week_key, prompt_key)
    VALUES (ua, ub, wk, circle_current_weekly_prompt_key())
    ON CONFLICT (user_a, user_b, week_key) DO NOTHING;
    SELECT id INTO prompt_id FROM circle_weekly_prompts WHERE user_a = ua AND user_b = ub AND week_key = wk;
  END IF;

  IF EXISTS (SELECT 1 FROM circle_weekly_responses WHERE circle_prompt_id = prompt_id AND user_id = caller) THEN
    RAISE EXCEPTION 'already_answered' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO circle_weekly_responses (circle_prompt_id, user_id, response)
  VALUES (prompt_id, caller, trimmed);

  RETURN circle_get_weekly_ritual(p_friend_id);
END;
$$;

REVOKE ALL ON FUNCTION circle_submit_weekly_response(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_submit_weekly_response(uuid, text) TO authenticated;

-- Past weeks, fully revealed only (both answered) — an unanswered/half-
-- answered past week simply never appears, same "never a partial preview"
-- rule as the live card. No active-membership requirement (unlike the two
-- functions above): once a week is mutually revealed it's shared history
-- both of them already consented to, same spirit as encouragement history
-- staying readable after a friend is later removed.
CREATE OR REPLACE FUNCTION circle_get_weekly_ritual_history(p_friend_id uuid)
RETURNS TABLE (week_key text, prompt_key text, my_response text, friend_response text, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    p.week_key,
    p.prompt_key,
    mine.response AS my_response,
    theirs.response AS friend_response,
    p.created_at
  FROM circle_weekly_prompts p
  JOIN circle_weekly_responses mine ON mine.circle_prompt_id = p.id AND mine.user_id = auth.uid()
  JOIN circle_weekly_responses theirs ON theirs.circle_prompt_id = p.id AND theirs.user_id = p_friend_id
  WHERE (p.user_a = auth.uid() AND p.user_b = p_friend_id) OR (p.user_a = p_friend_id AND p.user_b = auth.uid())
  ORDER BY p.week_key DESC
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION circle_get_weekly_ritual_history(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_get_weekly_ritual_history(uuid) TO authenticated;

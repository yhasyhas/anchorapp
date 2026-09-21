/*
  # Companion — data foundations only (no generation, no UI yet)

  Storage for the Companion feature: a chat history, a queue of "things worth
  noticing" detected client-side (see src/lib/companion-triggers.ts), and a
  weekly check-in ritual row. Nothing here generates text or notifies
  anyone — a detection only ever writes a row with shown_at = NULL, for a
  later prompt to consume.

  1. New Tables (all strictly per-user, no cross-user reads — unlike Circle)
    - `companion_messages` — on-demand chat history. Empty for now.
      - `role` ('user' | 'companion'), `content` (text), `created_at`.
    - `companion_observations` — one row per detected condition.
      - `type` ('pattern' | 'gap' | 'celebration' | 'first_time' |
        'weekly_checkin'). The first four are written by
        companion-triggers.ts; 'weekly_checkin' is reserved for the later
        generation prompts (the weekly ritual itself lives in
        companion_weekly_checkins below).
      - `payload` (jsonb) — what a later prompt needs to write the text
        (e.g. which goal, which category, which milestone). Always carries a
        `dedupeKey` string, see the unique index below.
      - `shown_at` (nullable) — NULL until a later prompt surfaces it.
      - `acknowledged` (boolean, default false) / `user_response` (text,
        nullable) — filled in when she reacts to it.
    - `companion_weekly_checkins` — the Sunday ritual.
      - `week_start` (date, the Monday), UNIQUE per user per week.
      - `status` ('pending' | 'completed' | 'skipped').
      - `summary` (text, nullable) — filled at real generation time, not
        here. `user_response` (text, nullable) — her answer.

  2. Duplicate protection lives in the database, not only in the client:
    - `companion_observations_dedupe_key_idx` — UNIQUE (user_id,
      payload->>'dedupeKey'): the same condition (same goal gap, same
      first-time category, same milestone, same low-mood run) can never be
      stored twice, acknowledged or not. Two tabs racing the same detection
      both try to insert; one simply gets a unique violation, which the
      client treats as "already recorded".
    - `companion_observations_one_pending_pattern_idx` — at most ONE
      un-acknowledged 'pattern' observation per user, so patterns never
      stack while one is still waiting for her.

  3. Security
    - RLS enabled on all three. Standard per-user shape (see reflections,
      user_compass): `auth.uid() = user_id`, SELECT/INSERT/UPDATE on
      observations and weekly check-ins (shown_at / acknowledged /
      user_response / status / summary all change after insert).
      companion_messages is an append-only log: SELECT/INSERT only. No
      DELETE policy anywhere — account deletion goes through ON DELETE
      CASCADE.
*/

-- ============================================================================
-- companion_messages
-- ============================================================================

CREATE TABLE IF NOT EXISTS companion_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'companion')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS companion_messages_user_created_idx
  ON companion_messages (user_id, created_at);

ALTER TABLE companion_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own companion messages"
  ON companion_messages FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own companion messages"
  ON companion_messages FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- companion_observations
-- ============================================================================

CREATE TABLE IF NOT EXISTS companion_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('pattern', 'gap', 'celebration', 'first_time', 'weekly_checkin')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  shown_at timestamptz,
  acknowledged boolean NOT NULL DEFAULT false,
  user_response text
);

CREATE INDEX IF NOT EXISTS companion_observations_user_created_idx
  ON companion_observations (user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS companion_observations_dedupe_key_idx
  ON companion_observations (user_id, (payload->>'dedupeKey'))
  WHERE payload ? 'dedupeKey';

CREATE UNIQUE INDEX IF NOT EXISTS companion_observations_one_pending_pattern_idx
  ON companion_observations (user_id)
  WHERE type = 'pattern' AND acknowledged = false;

ALTER TABLE companion_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own companion observations"
  ON companion_observations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own companion observations"
  ON companion_observations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own companion observations"
  ON companion_observations FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- companion_weekly_checkins
-- ============================================================================

CREATE TABLE IF NOT EXISTS companion_weekly_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'skipped')),
  summary text,
  user_response text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);

ALTER TABLE companion_weekly_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own companion weekly checkins"
  ON companion_weekly_checkins FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own companion weekly checkins"
  ON companion_weekly_checkins FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own companion weekly checkins"
  ON companion_weekly_checkins FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

/*
  # Weekly letters

  1. New Table
    - `weekly_letters` — one AI-written (or fallback-templated) personal letter per
      user per ISO week, generated server-side every Sunday evening by
      api/cron/weekly-letter.ts.
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `week_start` (date) — Monday of the ISO week the letter covers
      - `week_end` (date) — Sunday of that same week (generation day)
      - `letter_text` (text) — the final letter, already in the user's
        preferred_language at generation time (no client-side retranslation)
      - `highlights` (jsonb) — structured facts the letter draws from
        (dominant intention, mood distribution, anchors completed, this
        week's anchor streak, best journal sentence...), kept alongside the
        prose so the UI can render a highlights strip without re-parsing text
      - `created_at` (timestamptz)
      - UNIQUE(user_id, week_start) — idempotency: the cron checks this
        before generating, so at most one letter per user per week regardless
        of how many times the window fires

  2. Security
    - RLS enabled. Only a SELECT policy for the owning user — letters are
      read-only from the client. Writes come exclusively from
      api/cron/weekly-letter.ts using the service-role key (no end-user
      session exists in that context, same reasoning as notification_log), so
      no INSERT/UPDATE/DELETE policy is needed for the `authenticated` role —
      a regular user can never write to this table, even their own row.
*/

CREATE TABLE IF NOT EXISTS weekly_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  week_end date NOT NULL,
  letter_text text NOT NULL,
  highlights jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, week_start)
);

CREATE INDEX IF NOT EXISTS weekly_letters_user_id_week_start_idx ON weekly_letters (user_id, week_start DESC);

ALTER TABLE weekly_letters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own weekly letters"
  ON weekly_letters FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

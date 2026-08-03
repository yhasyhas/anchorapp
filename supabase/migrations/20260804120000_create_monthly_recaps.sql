/*
  # Monthly recaps (the "Wrapped")

  1. New Table
    - `monthly_recaps` — a full-screen, shareable "stories" recap of the month
      just ended (moods, anchors, intentions, journal, gratitudes), generated
      lazily client-side (see src/lib/wrapped.ts) the first time she opens the
      app in a new month rather than by a server cron:
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `month_start` (date) — first day of the recapped month
      - `month_end` (date) — last day of the recapped month
      - `evolution_sentence` (text) — one AI-generated (or static-fallback)
        "you started the month X, you ended it Y" line, already in the
        user's preferred_language
      - `stats` (jsonb) — structured stats (days present, streaks, dominant
        intention, mood trend vs previous month, gratitude count, journal
        highlight) so the stories viewer never has to recompute from raw
        daily rows
      - `created_at` (timestamptz)
      - UNIQUE(user_id, month_start) — idempotency, one recap per user per
        month, same reasoning as weekly_letters' UNIQUE(user_id, week_start)

  2. Security
    - RLS enabled. SELECT + INSERT for the owning user only — unlike
      weekly_letters/progress_stories (cron-only writes via service role),
      this is generated directly by the client, so it needs the same
      SELECT+INSERT shape as gratitudes. No UPDATE/DELETE policy: a recap is
      a snapshot of a closed month, not something to rewrite.
*/

CREATE TABLE IF NOT EXISTS monthly_recaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month_start date NOT NULL,
  month_end date NOT NULL,
  evolution_sentence text NOT NULL,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, month_start)
);

CREATE INDEX IF NOT EXISTS monthly_recaps_user_id_month_start_idx ON monthly_recaps (user_id, month_start DESC);

ALTER TABLE monthly_recaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own monthly recaps"
  ON monthly_recaps FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own monthly recaps"
  ON monthly_recaps FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

/*
  # Progress stories

  1. New Table
    - `progress_stories` — a rolling 3-week narrative ("Three weeks ago... Two
      weeks ago... This week...") generated server-side every Sunday, same
      cron run as weekly_letters (api/cron/weekly-letter.ts), right after the
      letter. Unlike the letter (covers just the past 7 days), this looks
      back 21 days to show the shift in energy across three weeks — a fresh
      row every week, keyed by the rolling window's end date.
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `period_start` (date) — 20 days before period_end (3 full weeks)
      - `period_end` (date) — the Sunday this story was generated for, same
        value as that week's weekly_letters.week_end
      - `story_text` (text) — already in the user's preferred_language
      - `stats` (jsonb) — structured per-week breakdown (dominant intention,
        mood distribution, anchors completed) + aggregated top intentions and
        completion rate, so the UI can render the mood-trend chart and top
        anchors panel without re-deriving them from raw daily rows
      - `created_at` (timestamptz)
      - UNIQUE(user_id, period_end) — idempotency, same reasoning as
        weekly_letters' UNIQUE(user_id, week_start)

  2. Security
    - RLS enabled. Only a SELECT policy for the owning user — same as
      weekly_letters, writes come exclusively from api/cron/weekly-letter.ts
      via the service-role key, no INSERT/UPDATE/DELETE policy for
      `authenticated`.
*/

CREATE TABLE IF NOT EXISTS progress_stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  story_text text NOT NULL,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, period_end)
);

CREATE INDEX IF NOT EXISTS progress_stories_user_id_period_end_idx ON progress_stories (user_id, period_end DESC);

ALTER TABLE progress_stories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own progress stories"
  ON progress_stories FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

/*
  # Insights history

  1. New Table
    - `insight_log` — archives AI-generated Patterns insights (never the
      local rule-based ones, which are always live-recomputed from raw data
      and not a meaningful snapshot) so she can look back at what the app
      told her in past weeks. Written directly by the client the moment a
      fresh weekly AI batch is generated (see fetchInsightsWithFallback in
      src/lib/ai-service.ts), not by a cron.
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `week_key` (text) — same ISO-week format as getWeekKey() in
        src/lib/ai-service.ts, groups insights by the week they were
        generated for
      - `text` (text)
      - `category` (text) — mood_action_correlation | pattern | suggestion
      - `created_at` (timestamptz)
      - UNIQUE(user_id, week_key, text) — idempotent if the same weekly
        batch gets logged more than once (e.g. re-fetched insights cache)

  2. Security
    - RLS enabled. SELECT + INSERT for the owning user only — same shape as
      gratitudes, since this is written by the client rather than a
      service-role cron.
*/

CREATE TABLE IF NOT EXISTS insight_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_key text NOT NULL,
  text text NOT NULL,
  category text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, week_key, text)
);

CREATE INDEX IF NOT EXISTS insight_log_user_id_created_at_idx ON insight_log (user_id, created_at DESC);

ALTER TABLE insight_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own insight log"
  ON insight_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own insight log"
  ON insight_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

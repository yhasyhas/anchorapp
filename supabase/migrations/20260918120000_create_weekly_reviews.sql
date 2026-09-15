/*
  # Weekly review — a rule-based, factual bilan tying the week's activity
  back to Compass, never a verdict

  One row per user per Monday-Sunday week (UNIQUE on user_id,week_start),
  generated once (lazily, client-side, mirroring monthly_recaps/Wrapped's
  own "generate once, never recompute" shape) the first time she opens the
  app on the week's eligible day. Never generated retroactively for a
  quiet week — see summary_snapshot below.

  1. New Table
    - `weekly_reviews`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users, ON DELETE CASCADE)
      - `week_start` (date) — the Monday of the reviewed week.
      - `status` (text) — 'pending' (generated, not yet displayed),
        'shown' (the card has mounted at least once), 'dismissed' (she
        closed it without necessarily answering the goal question, if one
        was asked). CHECK-constrained rather than a real enum, same
        convention as daily_suggestions.status/awe_thoughts.category
        elsewhere in this schema.
      - `summary_snapshot` (jsonb) — the exact computed values used to
        build this week's sentences (accepted/declined counts, dominant
        Compass values if any). Stored rather than recomputed per view so
        the review stays stable even if the underlying computation logic
        changes later — same reasoning as monthly_recaps.stats.
      - `goal_prompted_id` (text, nullable) — the CompassGoal.id (see
        user_compass.goals, a jsonb array — not a separate table, so this
        is a plain text column with no FK) this week's review asked about,
        if any. Also doubles as the per-goal cooldown marker: a goal whose
        id appears here in the last GOAL_COOLDOWN_WEEKS (8, see
        src/lib/weekly-review.ts) rows is skipped when picking which goal
        to ask about next, regardless of whether goal_response ended up
        filled in.
      - `goal_response` (text, nullable) — one of 'still_true', 'changed',
        'prefer_not' (see src/lib/weekly-review.ts), only ever set when
        goal_prompted_id is set. Null forever if no goal question was
        asked that week, or if one was asked but the card was dismissed
        without answering.
      - `created_at` (timestamptz)

  2. Security
    - RLS enabled, standard per-user SELECT/INSERT/UPDATE (auth.uid() =
      user_id) — same shape as daily_suggestions/reflections. UPDATE is
      needed for status pending -> shown -> dismissed and for filling in
      goal_response after generation. No DELETE policy.
*/

CREATE TABLE IF NOT EXISTS weekly_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'shown', 'dismissed')),
  summary_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  goal_prompted_id text,
  goal_response text CHECK (goal_response IN ('still_true', 'changed', 'prefer_not')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, week_start)
);

ALTER TABLE weekly_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own weekly reviews"
  ON weekly_reviews FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own weekly reviews"
  ON weekly_reviews FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own weekly reviews"
  ON weekly_reviews FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

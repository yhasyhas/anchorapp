/*
  # Move: personalized weekly suggestions, favorites

  1. Changes
    - `move_suggestions.generated_by` (text, default 'user') — 'user' for
      customs, 'ai' for the weekly Groq-generated batch (see
      src/pages/move.tsx). The hardcoded 5-item static pool is never stored
      as rows at all (rendered client-side), so this only ever distinguishes
      real DB rows.
    - `move_suggestions.week_key` (text, nullable) — ISO week the AI batch
      was generated for (e.g. "2026-W32", same format as the AI-insights
      cache's getWeekKey() in src/lib/ai-service.ts). Null for customs.
      Lets old AI batches "archive" themselves for free: a suggestion is
      only shown when it's a custom, a favorite, or matches the CURRENT
      week_key — no separate archived flag or cleanup job needed.
    - `move_suggestions.is_favorite` (boolean, default false) — the ⭐ toggle.
    - `move_suggestions.intensity` (text, default 'standard') — 'gentle' |
      'standard' | 'ambitious', used to pick the featured "move of the day"
      to match her actual state (low mood → gentle, active streak →
      ambitious). `category` itself stays a free text column (no CHECK
      constraint existed before this migration either) — now also allows
      'creative' and 'rest' alongside the original four, enforced only in
      TypeScript (src/types/index.ts) and the AI prompt, same as today.

  2. Security
    - Missing piece found while building this: move_suggestions had
      SELECT/INSERT/DELETE policies but no UPDATE policy, so favoriting
      (an UPDATE) would have been silently rejected by RLS. Added here.
*/

ALTER TABLE move_suggestions ADD COLUMN IF NOT EXISTS generated_by text NOT NULL DEFAULT 'user';
ALTER TABLE move_suggestions ADD COLUMN IF NOT EXISTS week_key text;
ALTER TABLE move_suggestions ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false;
ALTER TABLE move_suggestions ADD COLUMN IF NOT EXISTS intensity text NOT NULL DEFAULT 'standard';

CREATE INDEX IF NOT EXISTS move_suggestions_user_week_idx ON move_suggestions (user_id, week_key);

CREATE POLICY "Users can update own move suggestions"
  ON move_suggestions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

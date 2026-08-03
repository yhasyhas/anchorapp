/*
  # Add check_ins.personal_question

  1. Changes
    - `check_ins.personal_question` (text, nullable, NO default) — the
      AI-generated "For you" follow-up question resolved for that day (see
      src/pages/checkin.tsx), moved server-side so it's consistent across
      devices instead of a per-device localStorage cache.

  2. Notes
    - Nullable with no default is deliberate, not an oversight: three states
      are distinguished —
        NULL            = not yet attempted by any device today
        '' (empty text) = attempted, resolved to "no personalization"
                          (offline, consent off, nothing to reference, or the
                          model declined)
        non-empty text  = the resolved question itself
      A NOT NULL DEFAULT '' column (like every other check_ins text column)
      would collapse the first two states together, which is exactly the
      distinction the client needs to decide whether to attempt generation.
    - Written via a small partial upsert (only user_id, date,
      personal_question), independent of the full-row upsert in handleSave —
      see src/pages/move.tsx's addToAnchor for the same established
      single-column-upsert pattern elsewhere in this app. PostgREST upsert
      only sets the columns present in the request body, so this never
      clobbers (or is clobbered by) the reflection fields saved separately.
    - Idempotent: safe to re-run (ADD COLUMN IF NOT EXISTS).
    - Adding a column does not affect any existing RLS policy.
*/

ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS personal_question text;

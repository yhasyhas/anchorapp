/*
  # Add evening mood + server-side anchor lock timestamp

  1. Changes
    - `check_ins.evening_mood` (text, nullable, default '') — the column was
      missing in the database even though the TypeScript type and checkin.tsx
      already send it in the evening upsert, which made the save fail.
    - `daily_anchors.anchors_locked_at` (timestamptz, nullable) — timestamp of
      when the day was locked ("Lock my anchors & start the day"). Replaces
      the 3h anchor-check lock currently kept only in localStorage, which is
      lost on cache clear or device change.

  2. Notes
    - Idempotent: safe to re-run (ADD COLUMN IF NOT EXISTS).
    - Adding columns does not affect any existing RLS policy.
*/

ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS evening_mood text DEFAULT '';
ALTER TABLE daily_anchors ADD COLUMN IF NOT EXISTS anchors_locked_at timestamptz;

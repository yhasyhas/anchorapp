/*
  # Add check_ins.evening_mood_note

  1. Changes
    - `check_ins.evening_mood_note` (text, not null, default '') — a short
      answer to a mood-adapted micro-question shown right after she picks her
      evening mood (see src/pages/checkin.tsx), e.g. "What's weighing on you
      tonight?" for a stressed/low mood. Folded into the same check-in
      snippet the weekly letter / progress story cron already picks from
      (see pickBestCheckInSnippet in api/cron/weekly-letter.ts), alongside
      what_felt_real and voice_transcript.

  2. Notes
    - Idempotent: safe to re-run (ADD COLUMN IF NOT EXISTS).
    - Adding a column does not affect any existing RLS policy.
*/

ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS evening_mood_note text NOT NULL DEFAULT '';

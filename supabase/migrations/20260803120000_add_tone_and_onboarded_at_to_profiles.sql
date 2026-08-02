/*
  # Add tone preference and onboarding completion timestamp to profiles

  1. Changes
    - `profiles.tone` (text, default 'gentle') — the voice/style used for all
      AI-generated messages (morning companion, weekly letter, progress
      story, human reminders): 'gentle' | 'direct' | 'poetic'. Chosen during
      onboarding, editable later in Settings. Only affects STYLE, never the
      safety rules already baked into each prompt (no diagnosis, no
      guilt-tripping) — those stay fixed regardless of tone.
    - `profiles.onboarded_at` (timestamptz, nullable) — server-side source of
      truth for onboarding completion, so it survives across devices instead
      of living only in localStorage (`anchor_has_seen_onboarding`, kept as a
      fast local cache on top of this). NULL means "not yet onboarded".

  2. Backfill
    - Existing accounts (created before this migration) are stamped with
      `onboarded_at = created_at` below — they've already been through the
      app's original onboarding and must NOT be forced through the new one.
      Only accounts created AFTER this migration start out NULL, which is
      what actually triggers the new interactive onboarding
      (see src/components/onboarding/onboarding-modal.tsx).

  3. Notes
    - Idempotent: safe to re-run (ADD COLUMN IF NOT EXISTS; the backfill only
      touches rows still NULL, so it never clobbers a real completion time).
    - No RLS changes needed: profiles already restricts read/update to
      `auth.uid() = id`.
*/

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tone text NOT NULL DEFAULT 'gentle';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;

UPDATE profiles SET onboarded_at = created_at WHERE onboarded_at IS NULL;

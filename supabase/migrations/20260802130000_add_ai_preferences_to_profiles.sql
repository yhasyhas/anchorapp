/*
  # Move AI consent preferences from localStorage to profiles

  1. Changes
    - `profiles.ai_enabled` (boolean, default false) — replaces the
      `anchor_ai_enabled` localStorage flag, which didn't follow a user across
      devices/browsers.
    - `profiles.ai_checkins_enabled` (boolean, default false) — replaces
      `anchor_ai_checkins`.

  2. Notes
    - Idempotent: safe to re-run (ADD COLUMN IF NOT EXISTS).
    - Default `false` on both matches the previous localStorage default
      (unset key read as falsy), so existing users keep AI opted out until
      they explicitly enable it again in Settings.
    - No RLS changes needed: profiles already restricts read/update to
      `auth.uid() = id`.
*/

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ai_checkins_enabled boolean NOT NULL DEFAULT false;

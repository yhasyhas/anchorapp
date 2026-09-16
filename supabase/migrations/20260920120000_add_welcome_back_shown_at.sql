/*
  # Welcome-back message tracking

  1. Changes
    - `profiles.welcome_back_shown_at` (timestamptz, nullable) — same shape
      as profiles.soft_mode_since: a simple flag/timestamp column rather
      than a dedicated table, since this is one fact about one user (like
      soft_mode_since, onboarded_at). Stamped by the client
      (src/components/anchor/welcome-back-banner.tsx via updateProfile) the
      moment the one-time welcome-back banner is shown after a ≥21-day gap
      since her last significant activity (mood check-in, suggestion
      response, Journal, or Reflection — see src/lib/welcome-back.ts).

      Suppresses a re-show for the SAME absence stretch without a separate
      "reset" mechanism: isWelcomeBackEligible only blocks showing again
      while this stamp is still at or after her last significant activity
      date. The moment fresh activity lands after this stamp, a later
      ≥21-day gap measured from that new activity naturally re-arms it —
      no code ever needs to explicitly null this back out.

  2. Security
    - No RLS change needed: profiles' existing per-user SELECT/UPDATE
      policies already cover this new column like every other profile
      field.
*/

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS welcome_back_shown_at timestamptz;

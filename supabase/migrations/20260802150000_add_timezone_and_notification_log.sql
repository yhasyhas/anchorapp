/*
  # Timezone-aware reminders: profiles.timezone + notification_log

  1. Changes
    - `profiles.timezone` (text, default 'Africa/Nairobi') — an IANA timezone
      name, used by the reminders cron (api/cron/reminders.ts) to compute
      each user's local time rather than assuming everyone is in Kenya.
      Default matches the app's actual current userbase.

  2. New Tables
    - `notification_log` — one row per reminder actually sent (or attempted),
      used for two things:
      a. Idempotency: never send more than one reminder per user/slot/day —
         checked before sending, not enforced by a DB constraint, because
         "today" is evaluated in the user's local timezone, not a fixed UTC
         calendar day a UNIQUE(user_id, slot, date) column could express
         cleanly without also duplicating timezone conversion into SQL.
      b. The 3-strikes circuit breaker: if a user's last 3 logged reminders
         all predate their most recent mood/anchor/check-in activity... no —
         predate is backwards, see api/cron/reminders.ts for the actual
         comparison (most recent activity older than the oldest of the last
         3 sends means 3 reminders in a row with no follow-up), reminders
         are paused until fresh activity appears. This needs no extra
         "suspended" flag: it's recomputed from this log + the existing
         daily tables on every cron run, so it self-resolves the moment the
         user does anything.
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `slot` (text) — 'morning' | 'midday' | 'evening'
      - `title`, `body` (text) — exactly what was pushed, for debugging
      - `sent_at` (timestamptz)

  3. Security
    - RLS enabled. Only a SELECT policy for the owning user (own rows) —
      matches the rest of the schema's transparency-by-default stance, even
      though no UI reads this yet. Writes come exclusively from
      api/cron/reminders.ts using the service-role key (no end-user session
      exists in that context), so no INSERT/UPDATE/DELETE policy is needed
      for the `authenticated` role.
*/

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Africa/Nairobi';

CREATE TABLE IF NOT EXISTS notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slot text NOT NULL CHECK (slot IN ('morning', 'midday', 'evening')),
  title text NOT NULL,
  body text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_log_user_id_sent_at_idx ON notification_log (user_id, sent_at DESC);

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own notification log"
  ON notification_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

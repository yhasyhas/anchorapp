/*
  # Weekly review notification — one push per eligible bilan, ever

  1. Changes
    - `weekly_reviews.notification_sent_at` (timestamptz, nullable) — stamped
      by api/cron/reminders.ts (the same pg_cron-driven loop that already
      sends the 3 daily reminder slots and the future-letter nudges) the
      moment a push has been sent for that row. Idempotency key: a row is
      only ever a notification candidate while this is null, exactly the
      same shape as future_letters.reminder_sent_at.

      No new cron, no new Edge Function — this is read/written by the
      existing pg_cron-driven endpoint (see
      supabase/migrations/20260804170000_schedule_reminders_cron.sql) via
      the service-role key, same as notification_log and future_letters
      already are. The client never writes this column.

  2. Security
    - No RLS change needed: weekly_reviews' existing per-user SELECT policy
      already covers reading this new column (it's just another field on a
      row the owning user can already see); INSERT/UPDATE here always comes
      from the cron's service-role key, which bypasses RLS entirely, so no
      new policy is required for that path either.
*/

ALTER TABLE weekly_reviews ADD COLUMN IF NOT EXISTS notification_sent_at timestamptz;

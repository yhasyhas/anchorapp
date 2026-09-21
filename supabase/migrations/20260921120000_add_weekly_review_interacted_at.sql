/*
  # Weekly review interaction timestamp

  1. Changes
    - `weekly_reviews.interacted_at` (timestamptz, nullable) — stamped by the
      client (src/lib/weekly-review.ts) the moment she dismisses the review
      card or answers its goal question. Null until then, and stays null for
      reviews that are only ever pending/shown. Later interactions overwrite
      it (dismiss after answering, or vice versa), so it always holds the
      most recent one.

      Needed because weekly_reviews has no other timestamp for "she did
      something with this": created_at is when the row was generated (when
      she opened the app that day), not when she answered, and
      notification_sent_at is the cron's own push, not her action. The
      reminders circuit-breaker in api/cron/reminders.ts reads this column
      as one of its "last activity" sources — a pending/shown row is not
      activity, only an actual response is.

      Existing rows keep NULL (no backfill: the true interaction time isn't
      recoverable), which simply means they don't count as activity — the
      same as before this column existed.

  2. Security
    - No RLS change needed: weekly_reviews' existing per-user SELECT/UPDATE
      policies already cover this new column like every other field on the
      row.
*/

ALTER TABLE weekly_reviews ADD COLUMN IF NOT EXISTS interacted_at timestamptz;

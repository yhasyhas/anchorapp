/*
  # Future letters — unopened reminder

  A letter delivered but never opened dies in the archive; the moment of
  opening is the whole point of the feature, so this adds a single one-time
  nudge a few days after delivery. Same idempotency shape as `delivered_at`
  itself (see 20260807120000_create_future_letters.sql's own reasoning): a
  nullable timestamp column + a partial index for the cron's "who needs a
  nudge" scan, and once stamped a row can never match that scan again — no
  separate log table, no risk of a repeat send.

  Window/grouping/reminders_enabled-gating logic lives in
  api/cron/reminders.ts's processFutureLetterReminders — this migration
  only adds what that scan needs. No RLS/grant changes: like
  `delivered_at`, `reminder_sent_at` is only ever set by the cron
  (service-role key, bypasses RLS/grants entirely) — never by the client,
  so it isn't added to the authenticated column grants.
*/

ALTER TABLE future_letters ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

-- Partial index mirroring future_letters_undelivered_idx's own reasoning,
-- scoped to the narrower "delivered, unopened, not yet reminded" set.
CREATE INDEX IF NOT EXISTS future_letters_unopened_reminder_idx
  ON future_letters (delivered_at)
  WHERE opened_at IS NULL AND reminder_sent_at IS NULL;

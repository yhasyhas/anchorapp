/*
  # Add unique constraints for upsert support

  1. Changes
    - Add unique constraint on `mood_logs(user_id, date)` for daily mood upserts
    - Add unique constraint on `check_ins(user_id, date)` for daily check-in upserts

  2. Notes
    - These constraints enable conflict-based upserts from the client
    - Each user can only have one mood log and one check-in per day
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mood_logs_user_id_date_key'
  ) THEN
    ALTER TABLE mood_logs ADD CONSTRAINT mood_logs_user_id_date_key UNIQUE (user_id, date);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_ins_user_id_date_key'
  ) THEN
    ALTER TABLE check_ins ADD CONSTRAINT check_ins_user_id_date_key UNIQUE (user_id, date);
  END IF;
END $$;

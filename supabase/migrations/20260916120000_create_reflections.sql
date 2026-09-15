/*
  # Reflections — an optional, deeper evening reflection

  Additive alongside the existing evening check-in (check_ins) and Journal
  (journal_entries): a user who never opens this simply has no rows here,
  same "row only exists once explicitly saved" shape as user_compass.

  1. New Table
    - `reflections` — one row per user per day, upserted (UNIQUE on
      user_id, date), same shape as journal_entries/check_ins.
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `date` (date)
      - `meaningful_today` (text, default '') — "What was meaningful today?"
      - `learned_today` (text, default '') — "What did you learn?"
      - `better_tomorrow` (text, default '') — "What could be better tomorrow?"
      - `created_at` (timestamptz, default now())

  2. Security
    - Enable RLS. SELECT/INSERT/UPDATE restricted to own rows via
      `auth.uid() = user_id` — plain per-user data, not cross-user like
      Circle's tables, so this is the standard shape (see journal_entries,
      user_compass) rather than the SECURITY DEFINER pattern. No DELETE
      policy: no "delete a reflection" action, only edits.
*/

CREATE TABLE IF NOT EXISTS reflections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  meaningful_today text NOT NULL DEFAULT '',
  learned_today text NOT NULL DEFAULT '',
  better_tomorrow text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

ALTER TABLE reflections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own reflections"
  ON reflections FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own reflections"
  ON reflections FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reflections"
  ON reflections FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

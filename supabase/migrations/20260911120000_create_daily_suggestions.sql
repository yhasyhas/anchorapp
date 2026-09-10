/*
  # Daily suggestion — one gentle action offered at the top of Home

  A single suggestion per user per day, drawn from the Move pool (see
  src/lib/daily-suggestion.ts). Reopening the app the same day shows the
  same row, never a fresh pick. Additive: nothing here touches daily_anchors
  or the streak logic, and an account that never responds simply keeps a
  `pending` row.

  1. New Table
    - `daily_suggestions` — one row per user per day (UNIQUE on user_id,date),
      upserted like daily_anchors / mood_logs.
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users, ON DELETE CASCADE)
      - `date` (date, default CURRENT_DATE)
      - `source_move_item_id` (uuid, nullable) — the move_suggestions row the
        text came from, when the pick was a real DB row. NULL when it came
        from the hardcoded static pool (materializeDefaultSuggestions in
        src/lib/move-selection.ts), which has no DB row at all. Deliberately
        NOT a foreign key: the static-pool case has nothing to point at, and
        a Move entry deleted later must not cascade away the day's history.
      - `suggestion_text` (text) — snapshot of the text actually shown that
        day. The card reads this column directly, so the suggestion survives
        its source row being edited, archived, or deleted.
      - `status` (text, default 'pending') — 'pending' | 'accepted' |
        'declined' | 'snoozed'. "I'm doing it" -> accepted, "Not today" ->
        declined. 'snoozed' is reserved for a later "remind me tomorrow"
        affordance. None of these values feed the streak.
      - `responded_at` (timestamptz, nullable) — set the first time she
        answers, cleared again if she asks for another suggestion.
      - `follow_up_shown` (boolean, default false) — reserved: whether the
        next-day "did you get to it?" prompt has been shown for this row.
      - `follow_up_response` (text, nullable) — reserved: her answer to that.
      - `created_at` / `updated_at` (timestamptz, default now())

  2. Security
    - Enable RLS. SELECT / INSERT / UPDATE restricted to own rows via
      `auth.uid() = user_id` — the standard per-user shape used across this
      schema. No DELETE policy: there is no "delete a day's suggestion"
      action; account deletion is handled by the ON DELETE CASCADE.
*/

CREATE TABLE IF NOT EXISTS daily_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  source_move_item_id uuid,
  suggestion_text text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'snoozed')),
  responded_at timestamptz,
  follow_up_shown boolean NOT NULL DEFAULT false,
  follow_up_response text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

ALTER TABLE daily_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own daily suggestions"
  ON daily_suggestions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own daily suggestions"
  ON daily_suggestions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own daily suggestions"
  ON daily_suggestions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

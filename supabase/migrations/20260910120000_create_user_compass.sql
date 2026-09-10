/*
  # Compass — the user's foundations (values, vision, goals, future self)

  New optional pillar (product spec "Alignment Loop", section 3). Additive:
  no existing table or policy changes, so an account that never opens
  Compass simply has no row here.

  1. New Table
    - `user_compass` — one row per user, upserted (UNIQUE on user_id). A row
      only comes into existence the first time the user saves Compass;
      skipping it at onboarding or never opening it leaves them with none.
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users, UNIQUE) — one Compass per person
      - `value_tags` (text[], default '{}') — selected value tags. Stored as
        free-form English strings (the canonical form, same convention as
        daily_anchors.daily_intention), NOT a Postgres enum, so the offered
        list (see COMPASS_VALUES in src/lib/compass.ts) can grow without a
        migration. Named `value_tags` rather than `values` because VALUES is
        a reserved word in SQL.
      - `vision` (text, default '') — free-text answer to "what does a
        meaningful life look like for you?"
      - `goals` (jsonb, default '[]') — array of { id, text, created_at }
        objects. Kept inline rather than as a separate table: goals are only
        ever read and written together with the rest of Compass in a single
        explicit save, and each object carries its own created_at so a
        future spaced revisit prompt (spec section 3, "review goals after
        60 days") has a per-goal age to work from.
      - `future_self` (text, default '') — the one/two-sentence projection.
        Spec section 3 makes this the explicit thread with Letters (a letter
        to your future self can draw from it); that wiring is not part of
        this change.
      - `updated_at` (timestamptz, default now()) — bumped on every save.
      - `created_at` (timestamptz, default now())

  2. Security
    - Enable RLS. SELECT / INSERT / UPDATE restricted to own rows via
      `auth.uid() = user_id` — the standard per-user shape used across this
      schema (see custom_intentions, journal_entries). No DELETE policy:
      there is no "delete my Compass" action, only edits; account deletion
      is handled by the ON DELETE CASCADE on the user_id FK.
*/

CREATE TABLE IF NOT EXISTS user_compass (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  value_tags text[] NOT NULL DEFAULT '{}',
  vision text NOT NULL DEFAULT '',
  goals jsonb NOT NULL DEFAULT '[]'::jsonb,
  future_self text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_compass ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own compass"
  ON user_compass FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own compass"
  ON user_compass FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own compass"
  ON user_compass FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

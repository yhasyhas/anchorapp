/*
  # Gratitude jar

  1. New Table
    - `gratitudes` — small good things she drops in, no daily limit:
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `text` (text) — max ~140 chars, enforced client-side (see
        src/components/anchor/gratitude-drop-card.tsx)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS. SELECT/INSERT/DELETE, own rows only — the standard
      per-user shape used throughout this schema. No UPDATE policy: a
      dropped moment is a snapshot she can remove, not rewrite.
*/

CREATE TABLE IF NOT EXISTS gratitudes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gratitudes_user_created_idx ON gratitudes (user_id, created_at DESC);

ALTER TABLE gratitudes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own gratitudes"
  ON gratitudes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own gratitudes"
  ON gratitudes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own gratitudes"
  ON gratitudes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

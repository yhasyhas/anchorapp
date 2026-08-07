/*
  # Custom intentions

  1. New Table
    - `custom_intentions` — up to 3 active user-created daily intentions,
      alongside the 5 hardcoded native ones (src/lib/constants.ts):
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `label_en` (text) — canonical English form, also the value stored
        in daily_anchors.daily_intention when this intention is picked
        (same convention as native intentions, which store their English
        word) — this is what keeps every existing frequency/grouping
        computation working unchanged for customs.
      - `label_sw` (text) — Swahili display form, auto-translated via Groq
        at creation time (see src/lib/ai-service.ts's translateCustomIntention),
        editable afterwards.
      - `is_archived` (boolean) — archived, not deleted: keeps historical
        daily_anchors rows, weekly letters, and Wrapped cards resolvable.
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS. SELECT/INSERT/UPDATE, own rows only — the standard
      per-user shape used throughout this schema. No DELETE policy:
      archiving replaces deleting for this table (see is_archived above).
*/

CREATE TABLE IF NOT EXISTS custom_intentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label_en text NOT NULL,
  label_sw text NOT NULL,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS custom_intentions_user_active_idx ON custom_intentions (user_id, is_archived, created_at);

ALTER TABLE custom_intentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own custom intentions"
  ON custom_intentions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own custom intentions"
  ON custom_intentions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own custom intentions"
  ON custom_intentions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

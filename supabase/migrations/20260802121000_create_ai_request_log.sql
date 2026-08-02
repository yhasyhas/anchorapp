/*
  # AI request log (rate limiting for /api/insights)

  1. New Tables
    - `ai_request_log` — one row per authenticated call to the /api/insights
      Edge Function, used to enforce a per-user rate limit (30 requests/hour)
      and protect the Groq API quota from abuse.
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS. Users can only read/insert their own log rows — same
      pattern as every other table in this schema. The Edge Function
      authenticates as the calling user (their own JWT) to read/write this
      table, so no service-role key is required to enforce the limit.

  3. Notes
    - Append-only, grows unbounded over time. A periodic cleanup (e.g. delete
      rows older than a day) is not implemented here and should be added if
      row count becomes a concern.
*/

CREATE TABLE IF NOT EXISTS ai_request_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_request_log_user_id_created_at_idx
  ON ai_request_log (user_id, created_at);

ALTER TABLE ai_request_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own request log"
  ON ai_request_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own request log"
  ON ai_request_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

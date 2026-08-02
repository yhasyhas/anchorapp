/*
  # Allow self-cleanup of ai_request_log

  1. Changes
    - Adds a DELETE policy so a user can remove their own old rate-limit log
      rows. The /api/insights Edge Function uses this to opportunistically
      delete its own entries older than the rate-limit window (1h) on every
      call, so the table stays bounded without a cron job or a service-role
      key — consistent with how the rest of this table is only ever touched
      with the calling user's own JWT.

  2. Security
    - Same pattern as every other table here: scoped to `auth.uid() = user_id`.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_request_log'
      AND policyname = 'Users can delete own request log'
  ) THEN
    CREATE POLICY "Users can delete own request log"
      ON ai_request_log FOR DELETE
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

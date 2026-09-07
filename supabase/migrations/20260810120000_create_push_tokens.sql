/*
  # Native push tokens (Capacitor/FCM)

  1. New Tables
    - `push_tokens` — one row per native app install's FCM registration
      token. Separate from `push_subscriptions` (Web Push) rather than a
      shared table: a Web Push subscription is `{ endpoint, keys }` while
      an FCM token is a single opaque string, and mixing the two shapes
      into one nullable-columns table would break the schema's existing
      one-clean-shape-per-table convention. Only the native Android/iOS
      build (via @capacitor/push-notifications) ever writes here — the
      web/PWA build never references this table.
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `platform` (text, `'ios'` or `'android'`)
      - `token` (text, unique) — device/install-scoped, same reasoning as
        `push_subscriptions.endpoint` being unique rather than per-user.
      - `created_at`, `updated_at` (timestamptz)

  2. Security
    - RLS enabled, own-rows-only — identical pattern to
      `push_subscriptions` (20260802140000_create_push_notifications.sql),
      including the UPDATE policy needed for
      `upsert(..., { onConflict: "token" })` to work when a device
      re-registers (e.g. after a token refresh).
    - `api/send-push.ts` reads this table with the Supabase service-role
      key (server-to-server, no end-user JWT), so RLS here protects
      client-side access only.
*/

CREATE TABLE IF NOT EXISTS push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_tokens_user_id_idx ON push_tokens (user_id);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own push tokens"
  ON push_tokens FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own push tokens"
  ON push_tokens FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own push tokens"
  ON push_tokens FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own push tokens"
  ON push_tokens FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

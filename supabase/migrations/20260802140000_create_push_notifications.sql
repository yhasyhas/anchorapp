/*
  # Push notifications: subscriptions + reminder preferences

  1. New Tables
    - `push_subscriptions` — one row per browser/device Web Push subscription.
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `endpoint` (text, unique) — the push service URL for this device;
        unique because a subscription is a device/browser-scoped resource,
        not an app-scoped one. Re-subscribing on the same device upserts by
        endpoint rather than accumulating duplicates.
      - `keys` (jsonb) — `{ p256dh, auth }`, needed to encrypt push payloads.
      - `user_agent` (text) — informational only, helps a user recognise
        which device a subscription belongs to.
      - `created_at`, `updated_at` (timestamptz)
    - `notification_preferences` — one row per user (singleton, like
      `profiles`), the three reminder moments the app can send.
      - `user_id` (uuid, primary key, references auth.users)
      - `reminders_enabled` (boolean) — master switch.
      - `morning_enabled`, `midday_enabled`, `evening_enabled` (boolean)
      - `updated_at` (timestamptz)

  2. Security
    - RLS enabled on both tables, own-rows-only — same pattern as the rest
      of the schema.
    - `push_subscriptions` gets SELECT/INSERT/UPDATE/DELETE for the owning
      user. UPDATE isn't in the original ask (SELECT/INSERT/DELETE) but is
      required for `upsert(..., { onConflict: "endpoint" })` to work when a
      device re-subscribes (e.g. after a subscription rotation) — without it
      Postgres RLS rejects the ON CONFLICT DO UPDATE branch even though the
      row already belongs to the same user.
    - `notification_preferences` gets SELECT/INSERT/UPDATE (no DELETE — the
      row is toggled off via `reminders_enabled = false`, never removed
      independently of the account).
    - The `send-push` Edge Function reads `push_subscriptions` with the
      Supabase service-role key (server-to-server, no end-user JWT in that
      context), so RLS here protects client-side access only — it does not
      need to special-case the Edge Function.
*/

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  keys jsonb NOT NULL,
  user_agent text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON push_subscriptions (user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own push subscriptions"
  ON push_subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own push subscriptions"
  ON push_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own push subscriptions"
  ON push_subscriptions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own push subscriptions"
  ON push_subscriptions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Notification preferences table
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  reminders_enabled boolean NOT NULL DEFAULT false,
  morning_enabled boolean NOT NULL DEFAULT true,
  midday_enabled boolean NOT NULL DEFAULT true,
  evening_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own notification preferences"
  ON notification_preferences FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own notification preferences"
  ON notification_preferences FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own notification preferences"
  ON notification_preferences FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

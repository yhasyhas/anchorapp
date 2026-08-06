/*
  # Action rate log (rate limiting for server-to-server /api endpoints)

  1. New Tables
    - `action_rate_log` — one row per rate-limited call to an /api endpoint
      that has no per-user JWT-scoped table to lean on (circle notify/invite
      routes, send-push, delete-account). Distinct from `ai_request_log`
      (which tracks the Groq/AI quota specifically) since these endpoints
      track a different kind of abuse (invite/push/deletion spam), not AI
      spend, and are queried with the service-role key rather than the
      caller's own JWT (these routes already use service-role for every
      other read/write, e.g. api/circle/notify-invite.ts).
      - `id` (uuid, primary key)
      - `action` (text) — a short tag identifying the endpoint/quota, e.g.
        'invite-email', 'notify-sos', 'push'.
      - `subject` (text) — the entity being throttled: usually the calling
        user's id, but for api/send-push.ts (which has no caller JWT, only
        a shared secret) it's the target user_id instead.
      - `created_at` (timestamptz)

  2. Security
    - RLS enabled, no policies granted to `authenticated` — every one of
      these endpoints already authenticates with the Supabase service-role
      key (which bypasses RLS) for its other reads/writes, so this table is
      never touched by an end-user session. Same shape as `notification_log`,
      whose writes are also service-role-only.
*/

CREATE TABLE IF NOT EXISTS action_rate_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS action_rate_log_action_subject_created_at_idx
  ON action_rate_log (action, subject, created_at);

ALTER TABLE action_rate_log ENABLE ROW LEVEL SECURITY;

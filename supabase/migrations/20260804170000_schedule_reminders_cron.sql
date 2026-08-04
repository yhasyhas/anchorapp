/*
  # Schedule api/cron/reminders via pg_cron (Vercel Hobby workaround)

  1. Problem
    Vercel's native Cron Jobs feature only allows daily invocation
    frequency on the Hobby plan. api/cron/reminders.ts's matching logic
    (matchSlot, WINDOW_MINUTES = 15) was already built to run every ~15
    minutes and catch each user's own local morning/midday/evening slot
    via profiles.timezone — it just wasn't being invoked often enough.
    vercel.json worked around this with 3 fixed UTC times tuned for
    Africa/Nairobi, so only users in/near that timezone got correctly
    timed reminders; everyone else (e.g. a user in China) had their
    "morning" reminder land at their local mid-afternoon or later.

  2. Fix
    pg_cron + pg_net call the exact same endpoint every 15 minutes from
    inside Supabase's own Postgres instance instead — no Vercel plan
    change, no code change to the endpoint itself (see the updated
    comment in api/cron/reminders.ts). The three slot times (9:00, 15:00,
    19:30) all fall on the standard :00/:15/:30/:45 cron grid, so a
    15-minute tick always lands inside each slot's matching window.

  3. Secrets — deliberately NOT inlined here (this file is committed to
     git). Both are read at run-time from Supabase Vault. Before this job
     can fire successfully, run once in the SQL editor (never commit
     these — they carry the real secret value):

       select vault.create_secret(
         'https://your-production-domain/api/cron/reminders',
         'anchor_cron_reminders_url'
       );
       select vault.create_secret(
         'the same value as CRON_SECRET in Vercel env vars',
         'anchor_cron_secret'
       );

     If/when a custom domain replaces the *.vercel.app one, update the
     URL secret in place — no new migration, no redeploy:

       select vault.update_secret(
         (select id from vault.secrets where name = 'anchor_cron_reminders_url'),
         'https://new-domain.com/api/cron/reminders'
       );

  4. Idempotency: unschedules any prior job with this name first so
     re-running this migration updates the existing job instead of
     creating a duplicate — same "DROP ... IF EXISTS before CREATE"
     convention used elsewhere in this schema (see the voice-notes bucket
     migration's storage policies).
*/

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'anchor-reminders-tick') then
    perform cron.unschedule('anchor-reminders-tick');
  end if;
end $$;

select cron.schedule(
  'anchor-reminders-tick',
  '*/15 * * * *',
  $cron$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'anchor_cron_reminders_url'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anchor_cron_secret')
    ),
    timeout_milliseconds := 20000
  );
  $cron$
);

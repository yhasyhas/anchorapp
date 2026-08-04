/*
  # Fix pg_cron / pg_net extension schema clauses

  20260804170000_schedule_reminders_cron.sql enabled these extensions with
  `WITH SCHEMA pg_catalog` (pg_cron) and `WITH SCHEMA extensions` (pg_net).
  Both are non-relocatable — each hardcodes its own dedicated schema
  (`cron` and `net` respectively) in its control file, so an explicit
  WITH SCHEMA clause naming anything else can raise "extension must be
  installed in schema ..." on a project where it isn't already enabled.
  Supabase's own docs enable both with no schema clause at all.

  That migration likely didn't error only because pg_cron/pg_net were
  already enabled on this project before it ran — CREATE EXTENSION IF NOT
  EXISTS silently skips (schema clause and all) whenever the extension
  already exists under any schema. This corrects the statements to the
  schema-less form so a fresh project, or a local `supabase db reset`
  replaying every migration from scratch, doesn't hit the error. The
  cron.schedule() call in that migration already succeeded and needs no
  changes — this migration only touches the two CREATE EXTENSION lines.
*/

create extension if not exists pg_cron;
create extension if not exists pg_net;

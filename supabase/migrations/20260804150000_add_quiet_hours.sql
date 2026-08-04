-- Quiet hours: a do-not-disturb window layered on top of the existing
-- morning/midday/evening reminder slots (see api/cron/reminders.ts). Not
-- fully custom per-slot send times — the cron only fires at 3 fixed UTC
-- instants/day on the current Vercel plan (see that file's own comments) —
-- just a window during which no reminder of any slot is sent.

alter table notification_preferences add column quiet_hours_enabled boolean not null default false;
-- Hour-of-day, 0-23. start > end means the window wraps midnight (e.g. 21 -> 8).
alter table notification_preferences add column quiet_hours_start integer not null default 21;
alter table notification_preferences add column quiet_hours_end integer not null default 8;

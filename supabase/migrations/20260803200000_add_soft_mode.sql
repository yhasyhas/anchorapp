-- Soft Mode: when she's going through a hard stretch, the app lightens its own
-- expectations (1 anchor instead of 3, 1 check-in question instead of 3, gentler
-- AI tone, fewer reminders) instead of letting guilt build. Proposed automatically
-- (3 consecutive low/stressed mood days, or a 4+ day absence followed by a return)
-- or toggled manually in Settings.

alter table profiles add column soft_mode boolean not null default false;
alter table profiles add column soft_mode_since timestamptz null;

-- Stamped true whenever a daily_anchors row is saved while soft mode is active —
-- lets the anchor streak treat 1/3 completed as a full day for that date, even
-- after she later exits soft mode (streak history must stay correct in retrospect).
alter table daily_anchors add column soft_mode_day boolean not null default false;

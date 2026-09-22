/*
  # Companion — generated_text on companion_observations

  Adds the one field the generation step (src/lib/companion-generation.ts,
  api/insights.ts's "companion_observation" type) writes: the actual message
  text for a detected-but-not-yet-shown observation, filled in exactly once
  and never regenerated. NULL until then — a later UI prompt reads this
  column (not `payload`) to display the observation.

  companion_weekly_checkins deliberately does NOT get an equivalent new
  column here: its own original migration already reserved `summary` for
  precisely this ("filled in at real generation time, not here" — see
  20260922120000_create_companion_tables.sql). Adding a second generated_text
  column there would just duplicate that field under a different name.
*/

ALTER TABLE companion_observations ADD COLUMN IF NOT EXISTS generated_text text;

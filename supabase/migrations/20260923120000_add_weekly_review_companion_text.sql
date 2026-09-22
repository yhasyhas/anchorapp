/*
  # Weekly review — companion_text (consolidation with companion_weekly_checkins)

  Consolidates the two independent "weekly row" systems (weekly_reviews and
  companion_weekly_checkins) that were found to duplicate the same Sunday
  trigger, the same week boundaries, and — worse — could independently
  surface the same stale Compass goal to the same user the same week with
  neither system aware of the other.

  `weekly_reviews.companion_text` (nullable) is where the Companion's
  generated take on the week now goes — read from `summary_snapshot`
  (already computed: accepted/declined counts, dominant values, the stale
  goal already asked about) rather than recomputing anything, and written by
  src/lib/companion-generation.ts once ai_enabled + tenure gate it. NULL
  until generated; a later UI prompt shows it in place of the rule-based
  text when present.

  companion_weekly_checkins is deliberately NOT dropped or altered here —
  nothing in the code writes to it anymore as of this migration's commit,
  but the table stays in place for now (no data loss, easy to revisit).
*/

ALTER TABLE weekly_reviews ADD COLUMN IF NOT EXISTS companion_text text;

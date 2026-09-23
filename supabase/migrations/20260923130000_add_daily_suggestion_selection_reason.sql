/*
  # Daily suggestion — selection_reason (deliberate exploration ratio)

  Product feedback on "Project Anchor Alignment": the learned accept/decline
  bias (src/lib/daily-suggestion.ts's LEARNED_BIAS_* section) only ever
  reinforces categories she's already accepted, contradicting the
  document's own "sometimes the best recommendation is deliberately
  unfamiliar" principle, and its "explain why a recommendation appeared"
  guardrail. Roughly 1 day in 4 (once the same learned-bias sample-size
  gate is met), the pick deliberately ignores Compass/learned bias and
  favors an under-tried category instead — see isExplorationDay /
  pickByExploration in daily-suggestion.ts.

  `selection_reason` records which path produced that day's pick, so the
  card can show a small "why this" hint on exploration days and usage can
  be measured later. NULL on any row written before this column existed
  (no backfill — those days simply have no recorded reason, same
  "additive, nothing recomputed retroactively" approach as this schema's
  other nullable additions).
*/

ALTER TABLE daily_suggestions
  ADD COLUMN IF NOT EXISTS selection_reason text
    CHECK (selection_reason IN ('familiar', 'exploration'));

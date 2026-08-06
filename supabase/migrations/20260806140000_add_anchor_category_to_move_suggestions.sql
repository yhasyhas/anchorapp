/*
  # Move suggestions: mandatory anchor_category (future | mindbody | life)

  1. Changes
    - `move_suggestions.anchor_category` (text, NOT NULL) — ties every move
      to exactly ONE of the app's 3 daily anchor types, so suggestions can
      be filtered/scoped to the right anchor card (see
      src/lib/move-selection.ts, the Home "Move of the day" card, and the
      new per-anchor planning picker). Distinct from the existing `category`
      column, which is the ACTIVITY taxonomy (physical/social/mindful/
      novelty/creative/rest) — a move now carries both: what kind of
      activity it is, and which anchor it's meant to fill.
    - Backfilled for every existing row (customs + past AI batches) from
      activity category, since no anchor-category signal existed before
      this migration:
        physical, mindful, rest -> mindbody (body / rest / care)
        social, novelty         -> life     (connection / outside world)
        creative                -> future   (growth / creation / goals)
      Same mapping used going forward for AI-generated suggestions that
      don't specify one (see api/insights.ts) and as the smart default in
      the custom-move creation form (see src/lib/move-selection.ts's
      `defaultAnchorCategoryForActivity`).
    - CHECK constraint enforces exactly one of the 3 values, NOT NULL so no
      row can exist without a mapping going forward.

  2. Notes
    - The AI move-suggestions prompt (api/insights.ts) and the custom-move
      creation form (src/pages/move.tsx) are updated in the same change to
      always supply this column going forward.
*/

ALTER TABLE move_suggestions ADD COLUMN IF NOT EXISTS anchor_category text;

UPDATE move_suggestions SET anchor_category = CASE
  WHEN category IN ('physical', 'mindful', 'rest') THEN 'mindbody'
  WHEN category IN ('social', 'novelty') THEN 'life'
  WHEN category = 'creative' THEN 'future'
  ELSE 'mindbody'
END
WHERE anchor_category IS NULL;

ALTER TABLE move_suggestions ALTER COLUMN anchor_category SET NOT NULL;

ALTER TABLE move_suggestions
  ADD CONSTRAINT move_suggestions_anchor_category_check
  CHECK (anchor_category IN ('future', 'mindbody', 'life'));

CREATE INDEX IF NOT EXISTS move_suggestions_user_anchor_category_idx
  ON move_suggestions (user_id, anchor_category);

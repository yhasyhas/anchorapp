/*
  # Circle weekly ritual — history excludes the current (already-live) week

  circle_get_weekly_ritual_history's original definition (20260915120000)
  returned every fully-revealed week including the current one, which would
  duplicate what the live card at the top of the page already shows once
  revealed. "History" per the spec means PREVIOUS weeks — this excludes the
  current week_key so a revealed current week appears exactly once.
*/

CREATE OR REPLACE FUNCTION circle_get_weekly_ritual_history(p_friend_id uuid)
RETURNS TABLE (week_key text, prompt_key text, my_response text, friend_response text, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    p.week_key,
    p.prompt_key,
    mine.response AS my_response,
    theirs.response AS friend_response,
    p.created_at
  FROM circle_weekly_prompts p
  JOIN circle_weekly_responses mine ON mine.circle_prompt_id = p.id AND mine.user_id = auth.uid()
  JOIN circle_weekly_responses theirs ON theirs.circle_prompt_id = p.id AND theirs.user_id = p_friend_id
  WHERE ((p.user_a = auth.uid() AND p.user_b = p_friend_id) OR (p.user_a = p_friend_id AND p.user_b = auth.uid()))
    AND p.week_key <> to_char(CURRENT_DATE, 'IYYY-"W"IW')
  ORDER BY p.week_key DESC
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION circle_get_weekly_ritual_history(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circle_get_weekly_ritual_history(uuid) TO authenticated;

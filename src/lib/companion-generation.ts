// Fetch -> safety-filter -> generate -> store for the Companion's
// already-detected, not-yet-shown observations (the pure detection rules
// live in src/lib/companion-triggers.ts; the fetch/detect/insert orchestrator
// that creates these rows in the first place is src/lib/companion-detection.ts
// — this module only ever reads rows that already exist and are still
// ungenerated). Runs client-side on Home open, same as companion-detection.ts
// — no server cron. Generation and storage only: nothing here renders
// anything or marks a row `shown_at` — that's a later, separate prompt.
//
// The one hard rule this file exists to enforce: companion-distress-filter.ts
// runs BEFORE any network call, for every generation pass. If it fires, the
// model is never called — not for this observation, not for any other
// pending one in the same pass — and every pending row gets the fixed
// SAFETY_FALLBACK_TEXT instead. See that file for why this can't be the
// model's job.
import { supabase } from "@/lib/supabase"
import { getAuthHeader } from "@/lib/ai-service"
import { getCompass } from "@/lib/compass"
import { goalKeywords } from "@/lib/goal-matching"
import { filterByKeywords } from "@/lib/daily-suggestion"
import { WEEKLY_CHECKIN_MIN_TENURE_DAYS } from "@/lib/companion-triggers"
import { weekStartStr } from "@/lib/week-dates"
import i18n from "@/lib/i18n"
import { hasDistressSignal, SAFETY_FALLBACK_TEXT } from "@/lib/companion-distress-filter"
import { runOncePerPeriod } from "@/lib/once-per-period"
import { localDateStr } from "@/lib/utils"
import type { CompanionObservation, WeeklyReview } from "@/types"

// How far back Journal/Jar entries are read — both for the safety filter
// (wants a generous, conservative window) and as the pool excerpts get
// selected from. 30 days, same order of magnitude as the other AI-context
// windows in this app (HISTORY_DAYS in companion-detection.ts, the 30-day
// window fetchInsightsWithFallback's callers use).
const CONTEXT_WINDOW_DAYS = 30

const MAX_EXCERPTS = 3
const MAX_EXCERPT_LENGTH = 200
const MAX_COMPASS_ITEMS = 8

const RAN_KEY_BASE = "anchor_companion_generation_ran"

function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + delta)
  return dt.toISOString().slice(0, 10)
}

// compass.value_tags stores canonical English strings (see COMPASS_VALUES in
// src/lib/compass.ts — display-translated, store-English, same convention as
// daily_intention). Sending the raw English tag into a Swahili-targeted
// prompt would hand the model an English word it then has to translate or
// leave untranslated mid-sentence, so this resolves each tag through the
// same "compass.values.<lowercased>" i18n key the rest of the app already
// uses to display them — falling back to the raw tag if a value somehow
// isn't in the table (never for the 12 COMPASS_VALUES themselves, only a
// defensive fallback).
function translateCompassValues(values: string[], language: "en" | "sw"): string[] {
  const t = i18n.getFixedT(language)
  return values.map((v) => {
    const translated = t(`compass.values.${v.toLowerCase()}`)
    return translated && translated !== `compass.values.${v.toLowerCase()}` ? String(translated) : v
  })
}

function timeOfDay(now: Date): "morning" | "afternoon" | "evening" | "night" {
  const h = now.getHours()
  if (h < 5) return "night"
  if (h < 12) return "morning"
  if (h < 17) return "afternoon"
  if (h < 21) return "evening"
  return "night"
}

interface JournalRow {
  sentence: string
}
interface GratitudeRow {
  text: string
}

// Journal entries with the goal's own words for 'gap' (the one observation
// type that already names a specific thing to look for), otherwise just the
// most recent entries — there's no single anchor to match against for a
// mood pattern, a streak, or a first-time acceptance, and recency is a
// reasonable stand-in for relevance there.
function selectExcerpts(
  observationType: string,
  payload: Record<string, unknown>,
  journal: JournalRow[],
  gratitude: GratitudeRow[]
): string[] {
  const cap = (s: string) => (s.length > MAX_EXCERPT_LENGTH ? s.slice(0, MAX_EXCERPT_LENGTH) : s)

  if (observationType === "gap" && typeof payload.goalText === "string") {
    const keywords = goalKeywords(payload.goalText)
    if (keywords.length > 0) {
      const pool = [
        ...journal.map((j) => ({ title: j.sentence })),
        ...gratitude.map((g) => ({ title: g.text })),
      ]
      const matches = filterByKeywords(pool, keywords)
      if (matches.length > 0) return matches.slice(0, MAX_EXCERPTS).map((m) => cap(m.title))
    }
  }

  const recent = [...journal.slice(0, 2).map((j) => j.sentence), ...gratitude.slice(0, 1).map((g) => g.text)]
  return recent.slice(0, MAX_EXCERPTS).map(cap)
}

export interface CompanionGenerationSubject {
  userId: string
  aiEnabled: boolean
  language: "en" | "sw"
  // profiles.created_at — gates the weekly companion_text enrichment (below)
  // to WEEKLY_CHECKIN_MIN_TENURE_DAYS, the same tenure bar the old
  // standalone companion_weekly_checkins ritual used before it was folded
  // into weekly_reviews. Not required for per-observation generation, which
  // has no tenure gate of its own.
  profileCreatedAt: string
}

export interface CompanionGenerationResult {
  generated: number
  safetyFallbackUsed: boolean
}

const NOTHING_GENERATED: CompanionGenerationResult = { generated: 0, safetyFallbackUsed: false }

// One full generation pass: fills generated_text on every pending
// companion_observations row, and — separately — companion_text on THIS
// week's weekly_reviews row, if one already exists (created by the
// existing weekly-review.ts flow, which already validated minimum weekly
// activity; this module never creates a weekly_reviews row itself) and the
// account is old enough. Throws if a core read/update fails, mirroring
// runCompanionDetection's contract, so the caller can leave the once-a-day
// flag unset and retry next session. An individual failed *generation* call
// (Anthropic down, bad key, timeout) is NOT thrown — it's caught and that
// one row is simply left for next session (see the per-row try/catch
// below), exactly per anchor-companion-design.md section 6.
export async function runCompanionObservationGeneration(
  subject: CompanionGenerationSubject,
  now: Date = new Date()
): Promise<CompanionGenerationResult> {
  if (!subject.aiEnabled) return NOTHING_GENERATED

  const { userId, language, profileCreatedAt } = subject

  const tenureMs = now.getTime() - new Date(profileCreatedAt).getTime()
  const tenureEligible = tenureMs >= WEEKLY_CHECKIN_MIN_TENURE_DAYS * 86400000

  const [obsRes, weeklyReviewRes, journalRes, gratitudeRes, compass] = await Promise.all([
    supabase.from("companion_observations").select("*").eq("user_id", userId).is("generated_text", null),
    // Only queried once the (cheap) tenure check already passed — an
    // account too young for the weekly enrichment skips this read entirely,
    // same "cheap gates before a query" shape the old planWeeklyCheckin had.
    tenureEligible
      ? supabase
          .from("weekly_reviews")
          .select("*")
          .eq("user_id", userId)
          .eq("week_start", weekStartStr(now))
          .is("companion_text", null)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("journal_entries")
      .select("sentence,date")
      .eq("user_id", userId)
      .gte("date", addDays(localDateStr(now), -CONTEXT_WINDOW_DAYS))
      .order("date", { ascending: false }),
    supabase
      .from("gratitudes")
      .select("text,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
    getCompass(userId),
  ])
  for (const res of [obsRes, weeklyReviewRes, journalRes, gratitudeRes]) {
    if (res.error) throw res.error
  }

  const pendingObservations = (obsRes.data ?? []) as CompanionObservation[]
  // At most one — this week's row, if it exists, is old enough, and
  // doesn't already have companion_text. Never created here.
  const pendingWeeklyReview = (weeklyReviewRes.data ?? null) as WeeklyReview | null
  if (pendingObservations.length === 0 && !pendingWeeklyReview) return NOTHING_GENERATED

  const journal = (journalRes.data ?? []) as JournalRow[]
  const gratitude = (gratitudeRes.data ?? []) as GratitudeRow[]

  // ---- Safety gate: deterministic, runs before ANY model call. ----
  if (
    hasDistressSignal({
      journalSentences: journal.map((j) => j.sentence),
      gratitudeTexts: gratitude.map((g) => g.text),
    })
  ) {
    const fallback = SAFETY_FALLBACK_TEXT[language]
    await Promise.all([
      ...pendingObservations.map((o) =>
        supabase.from("companion_observations").update({ generated_text: fallback }).eq("id", o.id)
      ),
      ...(pendingWeeklyReview
        ? [supabase.from("weekly_reviews").update({ companion_text: fallback }).eq("id", pendingWeeklyReview.id)]
        : []),
    ])
    return { generated: pendingObservations.length + (pendingWeeklyReview ? 1 : 0), safetyFallbackUsed: true }
  }

  const compassValues = translateCompassValues((compass?.value_tags ?? []).slice(0, MAX_COMPASS_ITEMS), language)
  const compassGoals = (compass?.goals ?? []).map((g) => g.text).slice(0, MAX_COMPASS_ITEMS)
  const localDate = localDateStr(now)
  const timeBucket = timeOfDay(now)

  let generated = 0

  for (const obs of pendingObservations) {
    try {
      const excerpts = selectExcerpts(obs.type, obs.payload, journal, gratitude)
      const message = await requestCompanionObservationText({
        observationType: obs.type,
        payload: obs.payload,
        compassValues,
        compassGoals,
        excerpts,
        language,
        localDate,
        timeOfDay: timeBucket,
      })
      if (!message) continue // Anthropic call failed — leave NULL, retried next session.
      const { error } = await supabase.from("companion_observations").update({ generated_text: message }).eq("id", obs.id)
      if (!error) generated++
    } catch (err) {
      console.error("Companion observation generation failed:", err)
    }
  }

  if (pendingWeeklyReview) {
    try {
      const snapshot = pendingWeeklyReview.summary_snapshot
      // Anchoring facts come from summary_snapshot — already computed by
      // weekly-review.ts's own flow (accepted/declined counts, dominant
      // values, the one stale goal it already asked about) — NOT the raw
      // Compass value_tags/goals every other observation type gets, per
      // the consolidation: this is the more precise, already-validated
      // weekly signal, not a second guess at it.
      const excerpts = selectExcerpts("weekly_checkin", {}, journal, gratitude)
      const message = await requestCompanionObservationText({
        observationType: "weekly_checkin",
        payload: {
          weekStart: snapshot.weekStart,
          acceptedCount: snapshot.acceptedCount,
          declinedCount: snapshot.declinedCount,
          dominantValues: snapshot.dominantValues,
          goalPromptedText: snapshot.goalPromptedText,
        },
        compassValues: [],
        compassGoals: [],
        excerpts,
        language,
        localDate,
        timeOfDay: timeBucket,
      })
      if (message) {
        // Anthropic call failed — leave NULL, retried next session (same
        // "just don't write anything" outcome the observations loop's
        // `if (!message) continue` gets, no loop to continue here).
        const { error } = await supabase
          .from("weekly_reviews")
          .update({ companion_text: message })
          .eq("id", pendingWeeklyReview.id)
        if (!error) generated++
      }
    } catch (err) {
      console.error("Companion weekly review generation failed:", err)
    }
  }

  return { generated, safetyFallbackUsed: false }
}

interface CompanionObservationRequest {
  observationType: string
  payload: Record<string, unknown>
  compassValues: string[]
  compassGoals: string[]
  excerpts: string[]
  language: "en" | "sw"
  localDate: string
  timeOfDay: "morning" | "afternoon" | "evening" | "night"
}

// Prod-only by design, no dev fallback — same reasoning as
// generateFollowUpQuestion/generateMoveSuggestions in ai-service.ts: there's
// no local fallback text for a generated Companion message (unlike the
// morning greeting), so a non-prod environment just yields null, and the
// caller already treats null as "not generated yet, retry later". Network/
// HTTP failures are swallowed here (never thrown) so one bad call can't take
// down the rest of the generation pass.
//
// SWAHILI DISABLED IN PRODUCTION (temporary): a quality review found real
// translation-fidelity issues specific to Swahili generation — a mood-run
// duration once rendered as "saba" (seven) instead of the actual 3-day
// count, and English few-shot examples teaching the "explicit way out" rule
// didn't reliably transfer until a dedicated Swahili example was added. The
// literal-token substitution added since (see buildLiteralTokens /
// substituteLiteralTokens in api/insights.ts) structurally prevents digit
// mistranslation, but a native-speaker review of a real generated sample is
// still planned and hasn't happened yet — see this file's git history (the
// commit "feat: companion text generation (Claude Haiku 4.5, deterministic
// distress filter, English only for now)") and CLAUDE.md's AI insights
// section for the full trail. Handled exactly like a missing/invalid
// Anthropic API key: no network call, null returned, the row's
// generated_text simply stays NULL and is retried next session — nothing
// visible breaks. Detection (companion-detection.ts) is NOT gated by this
// and keeps running for every language; only text generation is paused.
// Do not remove this gate without a human reviewing a real Swahili sample.
async function requestCompanionObservationText(body: CompanionObservationRequest): Promise<string | null> {
  if (import.meta.env.DEV) return null
  if (body.language === "sw") return null

  try {
    const response = await fetch("/api/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
      body: JSON.stringify({ type: "companion_observation", ...body }),
    })
    if (!response.ok) return null
    const json = await response.json()
    return typeof json.message === "string" && json.message.trim() ? json.message.trim() : null
  } catch {
    return null
  }
}

// Runs generation at most once per user per local day — the shared
// once-per-period guard (src/lib/once-per-period.ts), same mechanism
// runCompanionDetectionOncePerDay and weekly-review.ts's own once-per-week
// check use.
export async function runCompanionObservationGenerationOncePerDay(
  subject: CompanionGenerationSubject,
  now: Date = new Date()
): Promise<CompanionGenerationResult | null> {
  if (!subject.aiEnabled) return null

  return runOncePerPeriod(RAN_KEY_BASE, subject.userId, localDateStr(now), () =>
    runCompanionObservationGeneration(subject, now)
  )
}

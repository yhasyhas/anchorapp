// The Wrapped — a monthly, Spotify-Wrapped-style recap. Generated lazily,
// client-side, the first time she opens the app in a new month (rather than
// a server cron like weekly letters/progress stories): see
// ensureWrappedGenerated, called once from src/pages/home.tsx on mount.
import type { TFunction } from "i18next"
import { supabase } from "@/lib/supabase"
import { isOnline } from "@/lib/offline-sync"
import { getUserLocalData, setUserLocalData } from "@/lib/user-storage"
import { getAuthHeader } from "@/lib/ai-service"
import { calculateBestStreakFromDates, calculateBestAnchorStreakWithGrace, isAnchorDayComplete } from "@/lib/streaks"
import { moodToValue } from "@/lib/constants"
import { monthBounds } from "@/lib/pdf/data"
import type { User } from "@supabase/supabase-js"
import type { DailyAnchor, JournalEntry, MonthlyRecap, MoodLog, Profile, Tone, WrappedMoodTrend, WrappedStats } from "@/types"

export const MIN_WRAPPED_DAYS = 8

function monthIsoOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function addMonthsIso(monthIso: string, delta: number): string {
  const [y, m] = monthIso.split("-").map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return monthIsoOf(d)
}

// "YYYY-MM" for the month immediately before the current one — the month
// ensureWrappedGenerated tries to recap.
export function lastCompletedMonthIso(today: Date = new Date()): string {
  return addMonthsIso(monthIsoOf(today), -1)
}

interface WrappedRawData {
  monthStart: string
  monthEnd: string
  moods: MoodLog[]
  anchors: DailyAnchor[]
  journalEntries: JournalEntry[]
  gratitudes: { text: string; created_at: string }[]
  prevMonthMoods: MoodLog[]
}

async function fetchWrappedData(userId: string, monthIso: string): Promise<WrappedRawData> {
  const { monthStart, monthEnd } = monthBounds(monthIso)
  const { monthStart: prevStart, monthEnd: prevEnd } = monthBounds(addMonthsIso(monthIso, -1))

  const [moodsRes, anchorsRes, journalRes, gratitudesRes, prevMoodsRes] = await Promise.all([
    supabase.from("mood_logs").select("*").eq("user_id", userId).gte("date", monthStart).lte("date", monthEnd),
    supabase.from("daily_anchors").select("*").eq("user_id", userId).gte("date", monthStart).lte("date", monthEnd),
    supabase.from("journal_entries").select("*").eq("user_id", userId).gte("date", monthStart).lte("date", monthEnd),
    supabase
      .from("gratitudes")
      .select("text, created_at")
      .eq("user_id", userId)
      .gte("created_at", `${monthStart}T00:00:00.000Z`)
      .lte("created_at", `${monthEnd}T23:59:59.999Z`),
    supabase.from("mood_logs").select("*").eq("user_id", userId).gte("date", prevStart).lte("date", prevEnd),
  ])

  return {
    monthStart,
    monthEnd,
    moods: (moodsRes.data as MoodLog[]) || [],
    anchors: (anchorsRes.data as DailyAnchor[]) || [],
    journalEntries: (journalRes.data as JournalEntry[]) || [],
    gratitudes: gratitudesRes.data || [],
    prevMonthMoods: (prevMoodsRes.data as MoodLog[]) || [],
  }
}

function avgMoodValue(moods: { mood: string }[]): number | null {
  if (moods.length === 0) return null
  const sum = moods.reduce((total, m) => total + (moodToValue[m.mood] ?? 0), 0)
  return sum / moods.length
}

// Dominant daily_intention among anchors in the first vs second half of the
// month — feeds the "started X, ended Y" evolution sentence below.
function halfMonthDominantIntention(
  anchors: DailyAnchor[],
  monthStart: string,
  monthEnd: string,
  half: "first" | "second"
): string | null {
  const [y, m] = monthStart.split("-").map(Number)
  const lastDay = Number(monthEnd.split("-")[2])
  const midDay = Math.ceil(lastDay / 2)
  const pad = (n: number) => String(n).padStart(2, "0")
  const cutoff = `${y}-${pad(m)}-${pad(midDay)}`

  const freq: Record<string, number> = {}
  for (const a of anchors) {
    if (!a.daily_intention) continue
    const inHalf = half === "first" ? a.date <= cutoff : a.date > cutoff
    if (!inHalf) continue
    freq[a.daily_intention] = (freq[a.daily_intention] || 0) + 1
  }
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]
  return top ? top[0] : null
}

function computeWrappedStats(data: WrappedRawData): WrappedStats {
  const presentDates = new Set<string>()
  for (const m of data.moods) presentDates.add(m.date)
  for (const a of data.anchors) presentDates.add(a.date)
  for (const j of data.journalEntries) presentDates.add(j.date)

  const intentionFreq: Record<string, number> = {}
  for (const a of data.anchors) {
    if (!a.daily_intention) continue
    intentionFreq[a.daily_intention] = (intentionFreq[a.daily_intention] || 0) + 1
  }
  const topIntention = Object.entries(intentionFreq).sort((a, b) => b[1] - a[1])[0]

  // Soft-mode aware (see isAnchorDayComplete): a 1/3-completed soft mode day
  // counts as a full anchor day, same as Home's own streak display — the PDF
  // export's computeMonthStats doesn't do this yet, out of scope here.
  const completedAnchorDates = data.anchors.filter(isAnchorDayComplete).map((a) => a.date)

  let journalHighlight: WrappedStats["journalHighlight"] = null
  for (const j of data.journalEntries) {
    if (!j.sentence) continue
    if (!journalHighlight || j.sentence.length > journalHighlight.sentence.length) {
      journalHighlight = { date: j.date, sentence: j.sentence }
    }
  }

  const moodTrend: WrappedMoodTrend = {
    thisMonthAvg: avgMoodValue(data.moods),
    prevMonthAvg: avgMoodValue(data.prevMonthMoods),
  }

  return {
    daysPresent: presentDates.size,
    dominantIntention: topIntention ? topIntention[0] : null,
    dominantIntentionDays: topIntention ? topIntention[1] : 0,
    bestMoodStreak: calculateBestStreakFromDates(data.moods.map((m) => m.date)),
    bestAnchorStreak: calculateBestAnchorStreakWithGrace(completedAnchorDates),
    gratitudeCount: data.gratitudes.length,
    journalHighlight,
    moodTrend,
    startIntention: halfMonthDominantIntention(data.anchors, data.monthStart, data.monthEnd, "first"),
    endIntention: halfMonthDominantIntention(data.anchors, data.monthStart, data.monthEnd, "second"),
  }
}

// ==================== EVOLUTION SENTENCE ====================

// Raw daily_intention values are stored in English — duplicated small
// translation map, same per-module convention already used in
// src/lib/ai-service.ts / api/insights.ts / api/cron/weekly-letter.ts.
const INTENTION_TRANSLATIONS: Record<string, { en: string; sw: string }> = {
  clarity: { en: "clarity", sw: "uwazi" },
  courage: { en: "courage", sw: "ujasiri" },
  love: { en: "love", sw: "upendo" },
  abundance: { en: "abundance", sw: "wingi" },
  peace: { en: "peace", sw: "amani" },
}

function translateIntention(intention: string, language: "en" | "sw"): string {
  return INTENTION_TRANSLATIONS[intention.toLowerCase()]?.[language] ?? intention
}

function getLocalEvolutionFallback(stats: WrappedStats, language: "en" | "sw"): string {
  if (stats.startIntention && stats.endIntention && stats.startIntention !== stats.endIntention) {
    const start = translateIntention(stats.startIntention, language)
    const end = translateIntention(stats.endIntention, language)
    return language === "sw"
      ? `Ulianza mwezi ukitafuta ${start}. Uliumaliza ukichagua ${end}.`
      : `You started the month seeking ${start}. You ended it choosing ${end}.`
  }
  return language === "sw"
    ? `Siku ${stats.daysPresent} mwezi huu, uliendelea kujitokeza kwa ajili yako mwenyewe.`
    : `${stats.daysPresent} days this month, you kept showing up for yourself.`
}

// Same dev/prod/offline/consent shape as generateCompanionMessage in this
// same file: prod calls the shared /api/insights edge function, dev and any
// failure/opt-out path fall back to the static line above — real data only,
// nothing invented.
export async function generateWrappedEvolution(
  aiEnabled: boolean,
  stats: WrappedStats,
  language: "en" | "sw" = "en",
  tone: Tone = "gentle"
): Promise<string> {
  if (!isOnline() || !aiEnabled) {
    return getLocalEvolutionFallback(stats, language)
  }

  if (!import.meta.env.DEV) {
    try {
      const response = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
        body: JSON.stringify({
          type: "wrapped_evolution",
          startIntention: stats.startIntention,
          endIntention: stats.endIntention,
          moodTrend: stats.moodTrend,
          bestAnchorStreak: stats.bestAnchorStreak,
          daysPresent: stats.daysPresent,
          language,
          tone,
        }),
      })
      if (!response.ok) throw new Error("wrapped_evolution_failed")
      const json = await response.json()
      return typeof json.message === "string" && json.message.trim() ? json.message : getLocalEvolutionFallback(stats, language)
    } catch {
      return getLocalEvolutionFallback(stats, language)
    }
  }

  return getLocalEvolutionFallback(stats, language)
}

// ==================== GENERATION ORCHESTRATION ====================

const WRAPPED_CHECKED_KEY_BASE = "anchor_wrapped_checked"

// Called once per session from src/pages/home.tsx (fire-and-forget, same
// "badge dot" pattern as checkUnreadLetter there). Idempotent and cheap on
// repeat calls: a localStorage flag (per user, per month) short-circuits
// everything after the first successful check for a given closed month —
// closed months never change, so there's nothing to re-derive.
export async function ensureWrappedGenerated(user: User, profile: Profile | null): Promise<void> {
  if (!isOnline()) return

  const monthIso = lastCompletedMonthIso()
  const checkedKey = `${WRAPPED_CHECKED_KEY_BASE}_${monthIso}`
  if (getUserLocalData<boolean>(checkedKey, user.id)) return

  try {
    const { monthStart } = monthBounds(monthIso)
    const { data: existing } = await supabase
      .from("monthly_recaps")
      .select("id")
      .eq("user_id", user.id)
      .eq("month_start", monthStart)
      .maybeSingle()

    if (existing) {
      setUserLocalData(checkedKey, user.id, true)
      return
    }

    const raw = await fetchWrappedData(user.id, monthIso)
    const stats = computeWrappedStats(raw)

    // Gating: a quiet month gets graceful silence, never an empty Wrapped —
    // no row is written, and nothing will ever prompt her about this month again.
    if (stats.daysPresent < MIN_WRAPPED_DAYS) {
      setUserLocalData(checkedKey, user.id, true)
      return
    }

    const language: "en" | "sw" = profile?.preferred_language === "sw" ? "sw" : "en"
    const evolutionSentence = await generateWrappedEvolution(profile?.ai_enabled ?? false, stats, language, profile?.tone ?? "gentle")

    const { error } = await supabase.from("monthly_recaps").upsert(
      {
        user_id: user.id,
        month_start: raw.monthStart,
        month_end: raw.monthEnd,
        evolution_sentence: evolutionSentence,
        stats,
      },
      { onConflict: "user_id,month_start" }
    )
    if (error) throw error

    setUserLocalData(checkedKey, user.id, true)
  } catch (err) {
    console.error("Failed to generate monthly Wrapped:", err)
    // Best-effort — checkedKey is only ever set on the success paths above,
    // so a transient failure (offline mid-flight, etc.) just retries next session.
  }
}

// ==================== STORY CARDS ====================
// One flexible shape covers every card kind (a shared "hero stat + caption"
// template, Spotify-Wrapped-style) rather than a strict per-kind payload —
// both the on-screen viewer (src/pages/wrapped.tsx) and the canvas share
// renderer (src/lib/wrapped-share.ts) read from this same shape.

export type WrappedCardKind = "cover" | "days" | "intention" | "streaks" | "mood_trend" | "treasures" | "closing"

export interface WrappedCard {
  kind: WrappedCardKind
  eyebrow: string
  title: string
  subtitle: string
  // Second stat tile — only the "streaks" card uses these (mood + anchor streak side by side).
  title2?: string
  subtitle2?: string
  // Longer supporting text — the journal quote (treasures) or the evolution sentence (closing).
  body?: string
  // Small closing line — only the "closing" card's tagline.
  footer?: string
}

function moodTrendEmoji(trend: WrappedMoodTrend): string {
  if (trend.thisMonthAvg == null) return "\u{1F324}️"
  if (trend.prevMonthAvg == null) return "\u{1F331}"
  const diff = trend.thisMonthAvg - trend.prevMonthAvg
  if (diff > 0.3) return "☀️"
  if (diff < -0.3) return "\u{1F327}️"
  return "\u{1F324}️"
}

function moodTrendKey(trend: WrappedMoodTrend): string {
  if (trend.thisMonthAvg == null) return "wrapped.card_mood_trend_no_data"
  if (trend.prevMonthAvg == null) return "wrapped.card_mood_trend_first_month"
  const diff = trend.thisMonthAvg - trend.prevMonthAvg
  if (diff > 0.3) return "wrapped.card_mood_trend_lighter"
  if (diff < -0.3) return "wrapped.card_mood_trend_heavier"
  return "wrapped.card_mood_trend_steady"
}

// Builds the dynamic 5-7 card list from a stored recap — always: cover,
// days, streaks, mood trend, closing; only when real data exists: intention,
// treasures (gratitudes/journal). Pure function of already-stored data, so
// re-reading a recap always reproduces the exact same cards.
export function buildWrappedCards(recap: MonthlyRecap, t: TFunction, lang: "en" | "sw"): WrappedCard[] {
  const s = recap.stats
  const locale = lang === "sw" ? "sw-TZ" : "en-US"
  const monthLabel = new Date(`${recap.month_start}T00:00:00`).toLocaleDateString(locale, { month: "long", year: "numeric" })

  const cards: WrappedCard[] = []

  cards.push({
    kind: "cover",
    eyebrow: t("wrapped.card_cover_eyebrow"),
    title: monthLabel,
    subtitle: t("wrapped.card_cover_subtitle"),
  })

  cards.push({
    kind: "days",
    eyebrow: t("wrapped.card_days_eyebrow"),
    title: String(s.daysPresent),
    subtitle: t("wrapped.card_days_subtitle"),
  })

  if (s.dominantIntention) {
    cards.push({
      kind: "intention",
      eyebrow: t("wrapped.card_intention_eyebrow"),
      title: t(`intentions.${s.dominantIntention.toLowerCase()}`),
      subtitle: t("wrapped.card_intention_subtitle", {
        count: s.dominantIntentionDays,
        plural: s.dominantIntentionDays === 1 ? "" : "s",
      }),
    })
  }

  cards.push({
    kind: "streaks",
    eyebrow: t("wrapped.card_streaks_eyebrow"),
    title: String(s.bestMoodStreak),
    subtitle: t("wrapped.card_streaks_mood_subtitle"),
    title2: String(s.bestAnchorStreak),
    subtitle2: t("wrapped.card_streaks_anchor_subtitle"),
  })

  cards.push({
    kind: "mood_trend",
    eyebrow: t("wrapped.card_mood_trend_eyebrow"),
    title: moodTrendEmoji(s.moodTrend),
    subtitle: t(moodTrendKey(s.moodTrend)),
  })

  if (s.gratitudeCount > 0 || s.journalHighlight) {
    cards.push({
      kind: "treasures",
      eyebrow: t("wrapped.card_treasures_eyebrow"),
      title: s.gratitudeCount > 0 ? String(s.gratitudeCount) : "✨",
      subtitle: s.gratitudeCount > 0 ? t("wrapped.card_treasures_subtitle") : t("wrapped.card_treasures_subtitle_journal_only"),
      body: s.journalHighlight ? `“${s.journalHighlight.sentence}”` : undefined,
    })
  }

  cards.push({
    kind: "closing",
    eyebrow: t("wrapped.card_closing_eyebrow"),
    title: t("wrapped.card_closing_title"),
    subtitle: "",
    body: recap.evolution_sentence,
    footer: t("wrapped.card_closing_tagline"),
  })

  return cards
}

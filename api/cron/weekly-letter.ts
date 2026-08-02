import { timingSafeEqual } from "node:crypto"
import { sendPushToUser } from "../send-push.js"

// Same reasoning as api/send-push.ts / api/cron/reminders.ts: web-push
// (pulled in transitively via sendPushToUser) needs Node's crypto/https,
// unavailable on Vercel's Edge Runtime.
export const config = {
  runtime: "nodejs",
}

type Language = "en" | "sw"

// Target: Sunday, 20:00 local time — see api/cron/reminders.ts for the full
// explanation of why this is a fixed-UTC-time approximation rather than a
// true per-timezone trigger (Vercel Hobby only allows daily-or-sparser cron
// entries, so vercel.json fires this once a week at the UTC instant that
// currently lines up with 20:00 in Africa/Nairobi, the app's default and
// current userbase). Users in other timezones simply won't have this land
// at their own 8pm until either upgraded to Pro (single `*/15 * * * *`
// entry) or more fixed-time entries are added to cover them.
const TARGET_WEEKDAY = 0 // Sunday (Date#getDay() convention)
const TARGET_HOUR = 20
const WINDOW_MINUTES = 30
const MIN_ACTIVE_DAYS = 3

const LETTER_PUSH: Record<Language, { title: string; body: string }> = {
  en: { title: "Your letter is here 💌", body: "A little something written just for your week." },
  sw: { title: "Barua yako iko hapa 💌", body: "Kitu kidogo kilichoandikwa kwa ajili ya wiki yako." },
}

// Raw daily_intention values (stored in English, see src/lib/constants.ts)
// translated for both the Swahili static fallback and the Groq prompt
// context. Duplicated from src/lib/ai-service.ts's INTENTION_TRANSLATIONS
// (not imported — this function is bundled separately, same reasoning as
// calculateBestStreakFromDates duplication in api/insights.ts).
const INTENTION_LABELS: Record<Language, Record<string, string>> = {
  en: { clarity: "clarity", courage: "courage", love: "love", abundance: "abundance", peace: "peace" },
  sw: { clarity: "uwazi", courage: "ujasiri", love: "upendo", abundance: "wingi", peace: "amani" },
}

function translateIntention(raw: string | null, language: Language): string | null {
  if (!raw) return null
  return INTENTION_LABELS[language][raw.toLowerCase()] ?? raw.toLowerCase()
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

// Local wall-clock date/weekday/hour/minute for a given IANA timezone, no
// external deps — same technique as api/cron/reminders.ts.
function getLocalParts(timezone: string, now: Date): { dateStr: string; weekday: number; hour: number; minute: number } {
  const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
  const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
  const dateStr = dateFmt.format(now) // YYYY-MM-DD
  const [hour, minute] = timeFmt.format(now).split(":").map(Number)
  const [y, m, d] = dateStr.split("-").map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return { dateStr, weekday, hour, minute }
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

function isDueForWeeklyLetter(timezone: string, now: Date): { due: boolean; localDate: string } {
  const { dateStr, weekday, hour, minute } = getLocalParts(timezone, now)
  const nowMinutes = hour * 60 + minute
  const targetMinutes = TARGET_HOUR * 60
  const due = weekday === TARGET_WEEKDAY && nowMinutes >= targetMinutes && nowMinutes < targetMinutes + WINDOW_MINUTES
  return { due, localDate: dateStr }
}

// Simple consecutive-day streak ending on `weekEnd`, computed only from
// dates present in `dates` (this week's window) — no grace day here,
// deliberately simpler than src/lib/streaks.ts's anchor grace logic. This
// is a "how consistent were you this week" figure for the letter, not the
// authoritative multi-week streak shown on Home.
function streakEndingOn(dates: string[], weekEnd: string): number {
  const set = new Set(dates)
  let streak = 0
  let cursor = weekEnd
  while (set.has(cursor)) {
    streak++
    cursor = addDays(cursor, -1)
  }
  return streak
}

interface RestConfig {
  url: string
  serviceRoleKey: string
}

async function restGet<T>(rest: RestConfig, path: string): Promise<T[]> {
  const res = await fetch(`${rest.url}/rest/v1/${path}`, {
    headers: { Authorization: `Bearer ${rest.serviceRoleKey}`, apikey: rest.serviceRoleKey },
  })
  if (!res.ok) throw new Error(`Supabase REST GET failed (${res.status}): ${path}`)
  return (await res.json()) as T[]
}

async function restInsert(rest: RestConfig, path: string, body: unknown): Promise<void> {
  const res = await fetch(`${rest.url}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${rest.serviceRoleKey}`,
      apikey: rest.serviceRoleKey,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Supabase REST INSERT failed (${res.status}): ${path}`)
}

interface ProfileRow {
  id: string
  full_name: string
  preferred_language: Language
  timezone: string
}

interface MoodLogRow {
  user_id: string
  date: string
  mood: string
}

interface AnchorRow {
  user_id: string
  date: string
  future_task: string
  mindbody_task: string
  life_task: string
  future_completed: boolean
  mindbody_completed: boolean
  life_completed: boolean
  daily_intention: string
}

interface CheckInRow {
  user_id: string
  date: string
  evening_mood: string | null
  what_felt_real: string
}

interface JournalRow {
  user_id: string
  date: string
  sentence: string
}

interface ExistingLetterRow {
  user_id: string
  week_start: string
}

function groupBy<T extends { user_id: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const list = map.get(row.user_id)
    if (list) list.push(row)
    else map.set(row.user_id, [row])
  }
  return map
}

interface Highlights {
  dominantIntention: string | null
  moodCounts: Record<string, number>
  anchorsCompletedDays: number
  totalDaysLogged: number
  anchorStreakThisWeek: number
  bestJournalSentence: string | null
  bestJournalDate: string | null
}

function buildHighlights(params: {
  weekEnd: string
  moods: MoodLogRow[]
  anchors: AnchorRow[]
  checkIns: CheckInRow[]
  journal: JournalRow[]
}): Highlights {
  const { weekEnd, moods, anchors, checkIns, journal } = params

  const moodCounts: Record<string, number> = {}
  for (const m of moods) moodCounts[m.mood] = (moodCounts[m.mood] || 0) + 1
  for (const c of checkIns) if (c.evening_mood) moodCounts[c.evening_mood] = (moodCounts[c.evening_mood] || 0) + 1

  const intentionFreq: Record<string, number> = {}
  for (const a of anchors) if (a.daily_intention) intentionFreq[a.daily_intention] = (intentionFreq[a.daily_intention] || 0) + 1
  const dominantIntention = Object.entries(intentionFreq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  const completedDates = anchors
    .filter((a) => a.future_completed && a.mindbody_completed && a.life_completed)
    .map((a) => a.date)
  const anchorsCompletedDays = completedDates.length
  const anchorStreakThisWeek = streakEndingOn(completedDates, weekEnd)

  const activeDates = new Set<string>()
  for (const m of moods) activeDates.add(m.date)
  for (const a of anchors) if (a.future_task || a.mindbody_task || a.life_task) activeDates.add(a.date)
  for (const c of checkIns) activeDates.add(c.date)
  for (const j of journal) activeDates.add(j.date)

  let bestJournalSentence: string | null = null
  let bestJournalDate: string | null = null
  for (const j of journal) {
    if (!j.sentence) continue
    if (!bestJournalSentence || j.sentence.length > bestJournalSentence.length) {
      bestJournalSentence = j.sentence
      bestJournalDate = j.date
    }
  }

  return {
    dominantIntention,
    moodCounts,
    anchorsCompletedDays,
    totalDaysLogged: activeDates.size,
    anchorStreakThisWeek,
    bestJournalSentence,
    bestJournalDate,
  }
}

// Backstop for the 180-word target: manual review of the reminders prompt
// (see api/cron/reminders.ts) showed the model doesn't reliably count its
// own words — trim deterministically rather than trust the instruction.
const MAX_WORDS = 210
function capWords(text: string): string {
  const words = text.split(/\s+/)
  if (words.length <= MAX_WORDS) return text
  return words.slice(0, MAX_WORDS).join(" ").replace(/[,;:]$/, "") + "…"
}

// English only — buildLetterText never calls this for Swahili (see its own
// comment below), so there's no language parameter to thread through here.
async function generateLetterWithGroq(params: {
  firstName: string
  highlights: Highlights
  groqApiKey: string
}): Promise<string> {
  const { firstName, highlights, groqApiKey } = params

  const intentionLabel = translateIntention(highlights.dominantIntention, "en")
  const moodSummary = Object.entries(highlights.moodCounts)
    .map(([mood, count]) => `${mood} x${count}`)
    .join(", ")

  const contextLines = [
    `Name: ${firstName || "friend"}`,
    intentionLabel ? `Intention she kept returning to this week: ${intentionLabel}` : null,
    moodSummary ? `Moods logged this week: ${moodSummary}` : null,
    highlights.anchorsCompletedDays > 0 ? `Fully completed all 3 daily anchors on ${highlights.anchorsCompletedDays} day(s) this week` : null,
    highlights.anchorStreakThisWeek >= 2 ? `Currently on a ${highlights.anchorStreakThisWeek}-day anchor streak ending today` : null,
    highlights.bestJournalSentence ? `Something she wrote in her journal this week: "${highlights.bestJournalSentence}"` : null,
  ].filter(Boolean)

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: `You are Anchor, writing a short personal weekly letter to a woman who has been quietly showing up for herself this week.

Rules:
- Address her directly, second person. Start with "Hi ${firstName || "love"},".
- 120-180 words. Warm, reflective, spiritual but not religious — the tone of a
  wise, loving friend writing by hand, never a coach or a progress report.
- Weave in AT LEAST TWO of the real details given below, naturally — not as
  a bullet list, not mechanically restated.
- If the data shows quiet, low-mood, or lighter days, honor that too: rest is
  also alignment. NEVER guilt-trip, never say "you should have" or "you
  missed" or "you could do better".
- NEVER invent specific details (task names, events, people, places) beyond
  what's given below. Stay general about anything not explicitly provided.
- End on a note of quiet pride — she should feel seen, not evaluated.
- Write in English.
- Return ONLY the letter body text. No title, no quotation marks, no
  signature line (the app adds "— your Anchor" separately).`,
        },
        { role: "user", content: contextLines.join("\n") },
      ],
      temperature: 0.75,
      max_tokens: 400,
    }),
  })

  if (!response.ok) throw new Error(`Groq error: ${response.status}`)

  const json = (await response.json()) as any
  const text = json.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error("Empty Groq response")
  return capWords(text.replace(/^["']|["']$/g, ""))
}

function buildStaticLetter(language: Language, firstName: string, highlights: Highlights): string {
  const intention = translateIntention(highlights.dominantIntention, language)

  if (language === "sw") {
    const name = firstName || "mpendwa"
    const introLine = intention
      ? `Wiki hii, uliendelea kurudi kwenye ${intention} — katika maamuzi madogo, hata yale ya kimya kimya.`
      : `Wiki hii, uliendelea kujitokeza kwa ajili yako mwenyewe — katika maamuzi madogo, hata yale ya kimya kimya.`
    const streakLine =
      highlights.anchorStreakThisWeek >= 3
        ? `Ulishikilia nanga zako kwa siku ${highlights.anchorStreakThisWeek} mfululizo. Hiyo si kitu kidogo — ni kujitolea.`
        : highlights.anchorsCompletedDays > 0
          ? `Ulikamilisha nanga zako siku ${highlights.anchorsCompletedDays} wiki hii, na kila siku ilikuwa na maana.`
          : `Siku nyingine ulienda polepole, na hiyo nayo ni sawa — kupumzika nako ni uwiano.`
    const journalLine = highlights.bestJournalSentence
      ? `Jambo moja ulilolisandika linasema yote: "${highlights.bestJournalSentence}"`
      : `Hata siku ambazo hukuandika, bado ilitokea, na bado ilikuwa na maana.`

    return `Habari ${name},\n\n${introLine} ${streakLine}\n\n${journalLine}\n\nSio tu unajaribu. Unakuwa. Endelea kuamini mchakato huu.\n\nNinakuona, na ninajivunia sana kwako.`
  }

  const name = firstName || "love"
  const introLine = intention
    ? `This week, you kept coming back to ${intention} — in the small choices, in the quiet ones too.`
    : `This week, you kept showing up for yourself — in the small choices, in the quiet ones too.`
  const streakLine =
    highlights.anchorStreakThisWeek >= 3
      ? `You held your anchors steady for ${highlights.anchorStreakThisWeek} days in a row. That's not nothing — that's devotion.`
      : highlights.anchorsCompletedDays > 0
        ? `You completed your anchors ${highlights.anchorsCompletedDays} day${highlights.anchorsCompletedDays > 1 ? "s" : ""} this week, and every one of them counted.`
        : `Some days you moved slowly, and that's alright too — rest is also alignment.`
  const journalLine = highlights.bestJournalSentence
    ? `One moment you wrote down says it all: "${highlights.bestJournalSentence}"`
    : `Even on the days you didn't write it down, it still happened, and it still mattered.`

  return `Hi ${name},\n\n${introLine} ${streakLine}\n\n${journalLine}\n\nYou're not just trying. You're becoming. Keep trusting the process.\n\nI see you, and I'm so proud of you.`
}

// llama-3.1-8b-instant's Swahili is noticeably less fluent than its English
// (verified by hand, see api/cron/reminders.ts) — for a single push-notification
// line that's a minor risk, but for a multi-sentence letter a shaky
// generation would be far more visible and undermine the whole feature. The
// hand-written Swahili template is more reliably warm and correct, so
// Swahili always uses it rather than calling Groq at all.
async function buildLetterText(params: {
  language: Language
  firstName: string
  highlights: Highlights
  groqApiKey: string | undefined
}): Promise<string> {
  const { language, firstName, highlights, groqApiKey } = params

  if (language === "sw" || !groqApiKey) {
    return buildStaticLetter(language, firstName, highlights)
  }

  try {
    return await generateLetterWithGroq({ firstName, highlights, groqApiKey })
  } catch {
    return buildStaticLetter(language, firstName, highlights)
  }
}

// Vercel invokes Cron Jobs via GET, and — on the Node.js runtime specifically
// — only a named export matching the HTTP method is treated as a real
// Fetch-style handler. See the same note in api/send-push.ts / api/cron/reminders.ts.
export async function GET(request: Request): Promise<Response> {
  const CRON_SECRET = process.env.CRON_SECRET
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  const GROQ_API_KEY = process.env.GROQ_API_KEY

  if (!CRON_SECRET || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Server misconfigured" }, 500)
  }

  const authHeader = request.headers.get("authorization") || ""
  if (!safeEqual(authHeader, `Bearer ${CRON_SECRET}`)) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  const rest: RestConfig = { url: SUPABASE_URL, serviceRoleKey: SERVICE_ROLE_KEY }
  const now = new Date()

  const profiles = await restGet<ProfileRow>(rest, "profiles?select=id,full_name,preferred_language,timezone")
  if (profiles.length === 0) {
    return jsonResponse({ processed: 0, generated: 0 }, 200)
  }

  // Which users have their Sunday-8pm window open right now, in their own
  // local time — same per-user timezone approach as api/cron/reminders.ts.
  const due = new Map<string, { profile: ProfileRow; weekStart: string; weekEnd: string }>()
  for (const profile of profiles) {
    const { due: isDue, localDate } = isDueForWeeklyLetter(profile.timezone || "Africa/Nairobi", now)
    if (!isDue) continue
    due.set(profile.id, { profile, weekStart: addDays(localDate, -6), weekEnd: localDate })
  }

  if (due.size === 0) {
    return jsonResponse({ processed: 0, generated: 0 }, 200)
  }

  const dueIds = [...due.keys()]
  const dueIdList = dueIds.join(",")
  // All due users share the same target weekday, so their week_start values
  // only ever differ by the ±1 day a timezone offset can shift a calendar
  // date — comfortably covered by a single floor a few days earlier.
  const earliestWeekStart = dueIds.reduce(
    (min, id) => (due.get(id)!.weekStart < min ? due.get(id)!.weekStart : min),
    due.get(dueIds[0])!.weekStart
  )

  const [existingLetters, moodLogs, anchors, checkIns, journal] = await Promise.all([
    restGet<ExistingLetterRow>(rest, `weekly_letters?user_id=in.(${dueIdList})&select=user_id,week_start`),
    restGet<MoodLogRow>(rest, `mood_logs?user_id=in.(${dueIdList})&date=gte.${earliestWeekStart}&select=user_id,date,mood`),
    restGet<AnchorRow>(
      rest,
      `daily_anchors?user_id=in.(${dueIdList})&date=gte.${earliestWeekStart}&select=user_id,date,future_task,mindbody_task,life_task,future_completed,mindbody_completed,life_completed,daily_intention`
    ),
    restGet<CheckInRow>(rest, `check_ins?user_id=in.(${dueIdList})&date=gte.${earliestWeekStart}&select=user_id,date,evening_mood,what_felt_real`),
    restGet<JournalRow>(rest, `journal_entries?user_id=in.(${dueIdList})&date=gte.${earliestWeekStart}&select=user_id,date,sentence`),
  ])

  const existingByUser = new Set(existingLetters.map((l) => `${l.user_id}:${l.week_start}`))
  const moodByUser = groupBy(moodLogs)
  const anchorsByUser = groupBy(anchors)
  const checkInsByUser = groupBy(checkIns)
  const journalByUser = groupBy(journal)

  let generated = 0
  let skipped = 0

  await Promise.all(
    dueIds.map(async (userId) => {
      const { profile, weekStart, weekEnd } = due.get(userId)!

      // Idempotency: never regenerate a letter that already exists for this
      // (user, week_start) — the DB's UNIQUE constraint backs this up too.
      if (existingByUser.has(`${userId}:${weekStart}`)) {
        skipped++
        return
      }

      const userMoods = (moodByUser.get(userId) || []).filter((m) => m.date >= weekStart && m.date <= weekEnd)
      const userAnchors = (anchorsByUser.get(userId) || []).filter((a) => a.date >= weekStart && a.date <= weekEnd)
      const userCheckIns = (checkInsByUser.get(userId) || []).filter((c) => c.date >= weekStart && c.date <= weekEnd)
      const userJournal = (journalByUser.get(userId) || []).filter((j) => j.date >= weekStart && j.date <= weekEnd)

      const highlights = buildHighlights({ weekEnd, moods: userMoods, anchors: userAnchors, checkIns: userCheckIns, journal: userJournal })

      // Quiet week: no letter, no push, no reproach — silence is the kind
      // response here, not a "you didn't do enough" notification.
      if (highlights.totalDaysLogged < MIN_ACTIVE_DAYS) {
        skipped++
        return
      }

      const language: Language = profile.preferred_language === "sw" ? "sw" : "en"
      const firstName = (profile.full_name || "").trim().split(/\s+/)[0] || ""

      const letterText = await buildLetterText({ language, firstName, highlights, groqApiKey: GROQ_API_KEY })

      try {
        await restInsert(rest, "weekly_letters", {
          user_id: userId,
          week_start: weekStart,
          week_end: weekEnd,
          letter_text: letterText,
          highlights,
        })
      } catch {
        // Insert failed (e.g. a concurrent run beat us to the UNIQUE
        // constraint) — don't push a notification for a letter that isn't
        // actually stored.
        skipped++
        return
      }

      generated++

      try {
        const push = LETTER_PUSH[language]
        await sendPushToUser({ userId, title: push.title, body: push.body, url: `/letters/${weekStart}` })
      } catch {
        // Letter is saved regardless — she'll find it next time she opens
        // the app even if the push itself failed to deliver.
      }
    })
  )

  return jsonResponse({ processed: dueIds.length, generated, skipped }, 200)
}

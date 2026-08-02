import { timingSafeEqual } from "node:crypto"
import { sendPushToUser } from "../send-push.js"

// Same reasoning as api/send-push.ts: web-push (pulled in transitively via
// sendPushToUser) needs Node's crypto/https, unavailable on Vercel's Edge
// Runtime.
export const config = {
  runtime: "nodejs",
}

type Slot = "morning" | "midday" | "evening"
type Language = "en" | "sw"
type Tone = "gentle" | "direct" | "poetic"

// Style only — the safety rules below (never guilt-trip, never invent specifics) stay
// identical across all three tones. "gentle" matches the app's original wording verbatim,
// so the default tone changes nothing for existing behavior. Duplicated from
// api/insights.ts / api/cron/weekly-letter.ts — each Vercel function is bundled separately.
const TONE_INSTRUCTIONS: Record<Tone, string> = {
  gentle: "warm, spiritual but not religious, like a caring friend — never a taskmaster",
  direct: "direct and motivating — short, energizing, active verbs, like a coach who believes in her — still warm, never a taskmaster",
  poetic: "poetic and lyrical — a touch of natural imagery, unhurried — still warm, never a taskmaster",
}

function normalizeTone(tone: unknown): Tone {
  return tone === "direct" || tone === "poetic" ? tone : "gentle"
}

interface SlotDef {
  key: Slot
  hour: number
  minute: number
}

// Each slot's local trigger time is matched against a [hour:minute, +WINDOW)
// bucket at whatever moment the cron actually fires — this is genuinely
// timezone-aware per user via profiles.timezone, not hardcoded to Nairobi.
//
// BUT: the ideal design (a single cron every ~15 min, catching every
// timezone's exact local slot) needs Vercel Pro — Hobby plans only allow
// cron jobs that fire once per day (see vercel.json, which currently has 3
// fixed-UTC-time entries: 06:00 / 12:00 / 16:30 UTC, i.e. exactly 9:00 /
// 15:00 / 19:30 in Africa/Nairobi, the app's default and current userbase).
// On Hobby, only users whose local time matches one of those 3 fixed UTC
// moments (in practice, Africa/Nairobi) get correctly-timed reminders — a
// user in a different timezone simply won't have a cron firing at their
// 9am. If/when the userbase spans more timezones, either upgrade to Pro and
// switch vercel.json back to a single `*/15 * * * *` entry, or add more
// fixed-time cron entries for the other timezones you need to cover.
const SLOTS: SlotDef[] = [
  { key: "morning", hour: 9, minute: 0 },
  { key: "midday", hour: 15, minute: 0 },
  { key: "evening", hour: 19, minute: 30 },
]
const WINDOW_MINUTES = 15
const HISTORY_DAYS = 14

const TITLES: Record<Slot, Record<Language, string>> = {
  morning: { en: "Good morning ☀️", sw: "Habari za asubuhi ☀️" },
  midday: { en: "A gentle nudge 🌿", sw: "Ukumbusho mwororo 🌿" },
  evening: { en: "Evening check-in 🌙", sw: "Kujiangalia jioni 🌙" },
}

const SLOT_URLS: Record<Slot, string> = {
  morning: "/",
  midday: "/",
  evening: "/checkin",
}

const STATIC_FALLBACKS: Record<Slot, Record<Language, string[]>> = {
  morning: {
    en: [
      "Hey beautiful, how was your morning? 🌻",
      "Just a reminder that you matter. No rush.",
      "A gentle nudge: how are you feeling today?",
      "No pressure — just curious how you're doing this morning.",
    ],
    sw: [
      "Habari yako mzuri, asubuhi yako ikoje? 🌻",
      "Ukumbusho tu kwamba una thamani. Bila haraka.",
      "Ukumbusho mwororo: unahisije leo?",
      "Bila shinikizo — tu nauliza asubuhi yako ikoje.",
    ],
  },
  midday: {
    en: [
      "Your anchors are still waiting for you today — no pressure. 🌿",
      "Small steps count. Maybe one anchor today?",
      "Just checking in — your day is still yours to shape.",
      "Whenever you're ready, your anchors will be there. 🌿",
    ],
    sw: [
      "Nanga zako bado zinakusubiri leo — bila shinikizo. 🌿",
      "Hatua ndogo zina maana. Labda nanga moja leo?",
      "Ninaangalia tu — siku yako bado ni yako kuiunda.",
      "Utakapokuwa tayari, nanga zako zitakuwa hapo. 🌿",
    ],
  },
  evening: {
    en: [
      "Proud of you for showing up. Even small steps count.",
      "Tonight's a good night to let go of what's not yours to carry.",
      "How was today? A few words are enough.",
      "A quiet moment for yourself, whenever you're ready tonight.",
    ],
    sw: [
      "Nimejivunia kwa kujitokeza kwako. Hata hatua ndogo zina maana.",
      "Leo usiku ni mzuri wa kuachilia usichopaswa kubeba.",
      "Siku ya leo ilikuwaje? Maneno machache yanatosha.",
      "Muda tulivu kwa ajili yako, utakapokuwa tayari leo usiku.",
    ],
  },
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// Backstop for the 15-word limit: manual review showed the model doesn't
// reliably count its own words (several samples came back at 17-19) — an
// instruction alone isn't enough, so trim deterministically rather than
// trust it. Static fallbacks are already well within budget; this only ever
// touches AI output.
const MAX_WORDS = 16
function capWords(text: string): string {
  const words = text.split(/\s+/)
  if (words.length <= MAX_WORDS) return text
  return words.slice(0, MAX_WORDS).join(" ").replace(/[,;:]$/, "") + "…"
}

// Local wall-clock date/hour/minute for a given IANA timezone, no external deps.
function getLocalParts(timezone: string, now: Date): { dateStr: string; hour: number; minute: number } {
  const dateFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const timeFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
  const dateStr = dateFmt.format(now) // YYYY-MM-DD
  const [hour, minute] = timeFmt.format(now).split(":").map(Number)
  return { dateStr, hour, minute }
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

function dayIndex(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000)
}

// Current streak of "great"/"okay" mood days ending yesterday (today isn't
// counted yet — the whole point of the morning reminder is that it isn't
// logged yet). Same date-continuity logic as calculateBestStreakFromDates in
// api/insights.ts, duplicated rather than imported (each Vercel function is
// bundled separately — see that file's own comment on this).
function currentStreakEndingYesterday(moodDates: string[], todayStr: string): number {
  const goodDates = new Set(moodDates)
  let streak = 0
  let cursor = addDays(todayStr, -1)
  while (goodDates.has(cursor)) {
    streak++
    cursor = addDays(cursor, -1)
  }
  return streak
}

function matchSlot(hour: number, minute: number): SlotDef | null {
  const nowMinutes = hour * 60 + minute
  for (const slot of SLOTS) {
    const slotMinutes = slot.hour * 60 + slot.minute
    if (nowMinutes >= slotMinutes && nowMinutes < slotMinutes + WINDOW_MINUTES) return slot
  }
  return null
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
  await fetch(`${rest.url}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${rest.serviceRoleKey}`,
      apikey: rest.serviceRoleKey,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  }).catch(() => {})
}

interface ProfileRow {
  id: string
  full_name: string
  preferred_language: Language
  timezone: string
  tone: Tone
}

interface PrefsRow {
  user_id: string
  morning_enabled: boolean
  midday_enabled: boolean
  evening_enabled: boolean
}

interface MoodLogRow {
  user_id: string
  date: string
  mood: string
  timestamp: string
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
  created_at: string
}

interface CheckInRow {
  user_id: string
  date: string
  created_at: string
}

interface LogRow {
  user_id: string
  slot: Slot
  sent_at: string
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

// One entry per (slot, language, coarse context bucket) within this single
// cron invocation — several users sharing the same slot/streak-bucket get
// the same AI-generated line instead of paying for a Groq call each,
// per the "mutualiser les générations quand c'est pertinent" requirement.
const messageCache = new Map<string, { title: string; body: string }>()

function streakBucket(streak: number): string {
  if (streak === 0) return "0"
  if (streak < 3) return "low"
  if (streak < 7) return "mid"
  return "high"
}

async function buildMessage(params: {
  slot: Slot
  language: Language
  tone: Tone
  firstName: string
  moodStreak: number
  yesterdayMood: string | null
  hasIntention: boolean
  groqApiKey: string | undefined
}): Promise<{ title: string; body: string }> {
  const { slot, language, tone, firstName, moodStreak, yesterdayMood, hasIntention, groqApiKey } = params
  const title = TITLES[slot][language]

  // Poor context (brand-new or long-dormant user, nothing to personalize
  // with) — a generic AI call isn't worth the cost, go straight to a static
  // line picked at random so repeat visits don't feel copy-pasted. Static
  // fallbacks don't vary by tone (same fluency-risk reasoning as Swahili below
  // — not worth a shaky generation just to color one push-notification line).
  const poorContext = moodStreak === 0 && !yesterdayMood && !hasIntention

  // llama-3.1-8b-instant's Swahili is noticeably less fluent than its
  // English (verified by hand: grammatically broken output in manual
  // review — see conversation history). Hand-written fallbacks are more
  // reliably warm and correct than a shaky AI generation, so Swahili always
  // uses them rather than risking a sentence that reads as broken or odd to
  // a native speaker.
  if (poorContext || !groqApiKey || language === "sw") {
    return { title, body: pick(STATIC_FALLBACKS[slot][language]) }
  }

  const cacheKey = `${slot}:${language}:${tone}:${streakBucket(moodStreak)}:${hasIntention ? 1 : 0}:${yesterdayMood || "none"}`
  const cached = messageCache.get(cacheKey)
  if (cached) return { title, body: cached.body }

  try {
    const raw = await generateWithGroq({ slot, language, tone, firstName, moodStreak, yesterdayMood, hasIntention, groqApiKey })
    const result = { title, body: capWords(raw) }
    messageCache.set(cacheKey, result)
    return result
  } catch {
    return { title, body: pick(STATIC_FALLBACKS[slot][language]) }
  }
}

function slotInstruction(slot: Slot): string {
  if (slot === "morning") {
    return "Invite her to log her mood and set one small intention for today. She hasn't done either yet."
  }
  if (slot === "midday") {
    return "Invite her back to her 3 small daily anchors (tasks), which are set but not yet done. Don't pressure her."
  }
  return "Invite her to her evening check-in — a few minutes to reflect and release what she doesn't need to carry."
}

async function generateWithGroq(params: {
  slot: Slot
  language: Language
  tone: Tone
  firstName: string
  moodStreak: number
  yesterdayMood: string | null
  hasIntention: boolean
  groqApiKey: string
}): Promise<string> {
  const { slot, language, tone, firstName, moodStreak, yesterdayMood, hasIntention, groqApiKey } = params

  const contextLines = [
    `Name: ${firstName || "friend"}`,
    moodStreak > 0 ? `Current gentle-mood streak: ${moodStreak} day(s)` : null,
    yesterdayMood ? `Yesterday's mood: ${yesterdayMood}` : null,
    hasIntention ? "She already set an intention today" : null,
  ].filter(Boolean)

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: `You are Anchor, a gentle wellness companion sending a short push notification.

Rules:
- ONE sentence, max 15 words.
- Tone: ${TONE_INSTRUCTIONS[tone]}.
- Never guilt-trip, never say "you should" or "you haven't". Supportive, not demanding.
- Weave in the given context ONLY if it fits naturally in one short sentence — otherwise keep it simple and warm.
- NEVER invent specific details (task names, activities, plans) that aren't in
  the context below — you don't know what her anchors actually say. Stay
  general ("your anchors", "today") rather than naming anything specific.
- Respond in ${language === "sw" ? "Swahili" : "English"}.
- Return ONLY the sentence, no quotes, no explanation.

${slotInstruction(slot)}`,
        },
        { role: "user", content: contextLines.join("\n") },
      ],
      temperature: 0.6,
      max_tokens: 60,
    }),
  })

  if (!response.ok) throw new Error(`Groq error: ${response.status}`)

  const json = (await response.json()) as any
  const text = json.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error("Empty Groq response")
  return text.replace(/^["']|["']$/g, "")
}

// Vercel invokes Cron Jobs via GET, and — on the Node.js runtime specifically
// (unlike Edge) — only a named export matching the HTTP method is treated as
// a real Fetch-style handler; `export default` here silently drops the
// Response and the request object isn't a real Request either (no
// `.headers.get()`). Confirmed via Vercel's function logs after the first
// deploy hung on every invocation. See the same note in api/send-push.ts.
export async function GET(request: Request): Promise<Response> {
  const CRON_SECRET = process.env.CRON_SECRET
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  const GROQ_API_KEY = process.env.GROQ_API_KEY

  if (!CRON_SECRET || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Server misconfigured" }, 500)
  }

  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when
  // CRON_SECRET is set as an env var — this rejects anyone else hitting the
  // route directly.
  const authHeader = request.headers.get("authorization") || ""
  if (!safeEqual(authHeader, `Bearer ${CRON_SECRET}`)) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  const rest: RestConfig = { url: SUPABASE_URL, serviceRoleKey: SERVICE_ROLE_KEY }
  const now = new Date()

  const prefsRows = await restGet<PrefsRow>(
    rest,
    "notification_preferences?reminders_enabled=eq.true&select=user_id,morning_enabled,midday_enabled,evening_enabled"
  )
  if (prefsRows.length === 0) {
    return jsonResponse({ processed: 0, sent: 0 }, 200)
  }

  const userIds = prefsRows.map((p) => p.user_id)
  const idList = userIds.join(",")

  const profiles = await restGet<ProfileRow>(
    rest,
    `profiles?id=in.(${idList})&select=id,full_name,preferred_language,timezone,tone`
  )
  const profileById = new Map(profiles.map((p) => [p.id, p]))
  const prefsByUser = new Map(prefsRows.map((p) => [p.user_id, p]))

  // Which users actually have a slot due right now, in their own local time.
  const dueToday = new Map<string, { profile: ProfileRow; slot: SlotDef; localDate: string }>()
  for (const userId of userIds) {
    const profile = profileById.get(userId)
    if (!profile) continue
    const { dateStr, hour, minute } = getLocalParts(profile.timezone || "Africa/Nairobi", now)
    const slot = matchSlot(hour, minute)
    if (!slot) continue
    dueToday.set(userId, { profile, slot, localDate: dateStr })
  }

  if (dueToday.size === 0) {
    return jsonResponse({ processed: 0, sent: 0 }, 200)
  }

  const dueIds = [...dueToday.keys()]
  const dueIdList = dueIds.join(",")
  const historyFloor = addDays(new Date().toISOString().slice(0, 10), -HISTORY_DAYS)

  const [moodLogs, anchors, checkIns, logs] = await Promise.all([
    restGet<MoodLogRow>(
      rest,
      `mood_logs?user_id=in.(${dueIdList})&date=gte.${historyFloor}&select=user_id,date,mood,timestamp&order=date.asc`
    ),
    restGet<AnchorRow>(
      rest,
      `daily_anchors?user_id=in.(${dueIdList})&date=gte.${historyFloor}&select=user_id,date,future_task,mindbody_task,life_task,future_completed,mindbody_completed,life_completed,daily_intention,created_at&order=date.asc`
    ),
    restGet<CheckInRow>(
      rest,
      `check_ins?user_id=in.(${dueIdList})&date=gte.${historyFloor}&select=user_id,date,created_at&order=date.asc`
    ),
    restGet<LogRow>(
      rest,
      `notification_log?user_id=in.(${dueIdList})&select=user_id,slot,sent_at&order=sent_at.desc&limit=1000`
    ),
  ])

  const moodByUser = groupBy(moodLogs)
  const anchorsByUser = groupBy(anchors)
  const checkInsByUser = groupBy(checkIns)
  const logsByUser = groupBy(logs)

  let sent = 0
  let skipped = 0

  await Promise.all(
    dueIds.map(async (userId) => {
      const { profile, slot, localDate } = dueToday.get(userId)!
      const prefs = prefsByUser.get(userId)!
      const slotEnabled =
        slot.key === "morning" ? prefs.morning_enabled : slot.key === "midday" ? prefs.midday_enabled : prefs.evening_enabled
      if (!slotEnabled) {
        skipped++
        return
      }

      const userLogs = (logsByUser.get(userId) || []).sort(
        (a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime()
      )

      // Idempotency: never more than one reminder per slot per local day.
      const alreadySentToday = userLogs.some(
        (l) => l.slot === slot.key && getLocalParts(profile.timezone || "Africa/Nairobi", new Date(l.sent_at)).dateStr === localDate
      )
      if (alreadySentToday) {
        skipped++
        return
      }

      const userMoods = moodByUser.get(userId) || []
      const userAnchors = anchorsByUser.get(userId) || []
      const userCheckIns = checkInsByUser.get(userId) || []

      // 3-strikes circuit breaker: if the last 3 reminders sent (any slot)
      // all predate the user's most recent activity of any kind, she hasn't
      // engaged since — pause. No stored "suspended" flag: this is
      // recomputed every run, so it self-clears the moment fresh activity
      // (a new mood/anchor/check-in row) shows up.
      if (userLogs.length >= 3) {
        const last3 = userLogs.slice(0, 3)
        const oldestOfLast3 = Math.min(...last3.map((l) => new Date(l.sent_at).getTime()))
        const lastActivity = Math.max(
          0,
          ...userMoods.map((m) => new Date(m.timestamp).getTime()),
          ...userAnchors.map((a) => new Date(a.created_at).getTime()),
          ...userCheckIns.map((c) => new Date(c.created_at).getTime())
        )
        if (lastActivity < oldestOfLast3) {
          skipped++
          return
        }
      }

      const todayMood = userMoods.find((m) => m.date === localDate)
      const todayAnchor = userAnchors.find((a) => a.date === localDate)
      const todayCheckIn = userCheckIns.find((c) => c.date === localDate)

      let needed = false
      if (slot.key === "morning") {
        needed = !todayMood || !todayAnchor?.daily_intention
      } else if (slot.key === "midday") {
        const hasAnyTask = !!(todayAnchor?.future_task || todayAnchor?.mindbody_task || todayAnchor?.life_task)
        const allDone = !!(todayAnchor?.future_completed && todayAnchor?.mindbody_completed && todayAnchor?.life_completed)
        needed = !!todayAnchor && hasAnyTask && !allDone
      } else {
        needed = !todayCheckIn
      }

      if (!needed) {
        skipped++
        return
      }

      const yesterdayDate = addDays(localDate, -1)
      const moodStreak = currentStreakEndingYesterday(
        userMoods.filter((m) => m.mood === "great" || m.mood === "okay").map((m) => m.date),
        localDate
      )
      const yesterdayMood = userMoods.find((m) => m.date === yesterdayDate)?.mood || null
      const firstName = (profile.full_name || "").trim().split(/\s+/)[0] || ""

      const { title, body } = await buildMessage({
        slot: slot.key,
        language: profile.preferred_language === "sw" ? "sw" : "en",
        tone: normalizeTone(profile.tone),
        firstName,
        moodStreak,
        yesterdayMood,
        hasIntention: !!todayAnchor?.daily_intention,
        groqApiKey: GROQ_API_KEY,
      })

      try {
        await sendPushToUser({ userId, title, body, url: SLOT_URLS[slot.key] })
        sent++
      } catch {
        // Nothing to clean up here — sendPushToUser already prunes expired
        // subscriptions itself; a failed send just means no log entry below,
        // so it isn't treated as "already handled" for idempotency.
        return
      }

      await restInsert(rest, "notification_log", { user_id: userId, slot: slot.key, title, body })
    })
  )

  return jsonResponse({ processed: dueIds.length, sent, skipped }, 200)
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useTranslation } from "react-i18next"
import { getISOWeek } from "date-fns"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { addToSyncQueue, isOnline, getLocalData, setLocalData } from "@/lib/offline-sync"
import { getCompassValueTags } from "@/lib/compass"
import {
  buildVisibleSuggestions,
  materializeDefaultSuggestions,
  getRecentlyUsedTitles,
} from "@/lib/move-selection"
import { pickDailySuggestion } from "@/lib/daily-suggestion"
import { todayStr, localDateStr } from "@/lib/utils"
import type { DailyAnchor, DailySuggestion, DailySuggestionStatus, MoveSuggestion } from "@/types"

// The single source of truth for the daily suggestion, shared by Home's
// card and the dedicated /anchor screen so a response given on one is
// immediately reflected on the other. Mounted once in AppLayout (above the
// routes), so it survives navigation between the two views without a
// refetch or a reload flash. Also owns the 7-day history and the J+2
// follow-up on accepted suggestions.

// How many days after an accepted suggestion the "how did that feel?"
// follow-up becomes eligible. Fixed value (spec allows 2-3).
export const FOLLOW_UP_DELAY_DAYS = 2
const HISTORY_DAYS = 7
// Fetch window: enough to cover the 7-day history plus older accepted
// suggestions whose follow-up hasn't been shown yet.
const FETCH_WINDOW_DAYS = 21

export type FollowUpResponse = "better" | "neutral" | "prefer_not"

export interface DailySuggestionContextValue {
  suggestion: DailySuggestion | null
  loading: boolean
  busy: boolean
  accept: () => void
  decline: () => void
  another: () => void
  // Last HISTORY_DAYS days of suggestions (most recent first), today included.
  history: DailySuggestion[]
  // The single eligible follow-up card to show right now, or null. Already
  // filtered to "most recent eligible" and hidden once seen this session.
  followUp: DailySuggestion | null
  // Called when the follow-up card mounts — marks follow_up_shown = true in
  // all cases so it never reappears, without hiding it mid-interaction.
  markFollowUpSeen: () => void
  respondFollowUp: (response: FollowUpResponse) => void
  dismissFollowUp: () => void
}

const DailySuggestionContext = createContext<DailySuggestionContextValue | null>(null)

function cacheKey(userId: string): string {
  return `daily_suggestion_${userId}_${todayStr()}`
}

function norm(title: string): string {
  return title.trim().toLowerCase()
}

// Same format as getWeekKey() in src/lib/ai-service.ts ("2026-W37") — used
// only to keep buildVisibleSuggestions' "this week's AI move batch" filter
// in sync. Inlined here rather than imported so this provider (eager, via
// AppLayout) doesn't pull all of ai-service into the initial bundle.
function currentWeekKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-W${getISOWeek(now)}`
}

function daysAgo(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number)
  const then = new Date(y, m - 1, d)
  then.setHours(0, 0, 0, 0)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.round((now.getTime() - then.getTime()) / 86400000)
}

function isFollowUpEligible(row: DailySuggestion): boolean {
  return row.status === "accepted" && !row.follow_up_shown && daysAgo(row.date) >= FOLLOW_UP_DELAY_DAYS
}

export function DailySuggestionProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const { user } = useAuth()

  const [suggestion, setSuggestion] = useState<DailySuggestion | null>(
    () => (user && getLocalData<DailySuggestion>(cacheKey(user.id))) || null
  )
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [windowRows, setWindowRows] = useState<DailySuggestion[]>([])
  const [followUpRow, setFollowUpRow] = useState<DailySuggestion | null>(null)
  const [followUpCleared, setFollowUpCleared] = useState(false)

  // Resolved once per load, reused by "another suggestion".
  const poolRef = useRef<MoveSuggestion[]>([])
  const valuesRef = useRef<string[]>([])
  const recentTitlesRef = useRef<Set<string>>(new Set())
  // Everything already shown today this session (current pick + every
  // "another" tap) — hard-excluded from the next pick.
  const seenTitlesRef = useRef<Set<string>>(new Set())
  const creatingRef = useRef(false)
  const followUpSeenRef = useRef(false)

  const seed = user ? `${user.id}:${todayStr()}` : ""

  function persistToday(row: DailySuggestion) {
    setSuggestion(row)
    setLocalData(cacheKey(row.user_id), row)
    setWindowRows((prev) => {
      const rest = prev.filter((r) => r.date !== row.date)
      return [row, ...rest].sort((a, b) => b.date.localeCompare(a.date))
    })
  }

  const write = useCallback(
    async (record: Record<string, unknown>) => {
      if (!user) return
      try {
        if (isOnline()) {
          const { error } = await supabase
            .from("daily_suggestions")
            .upsert(record, { onConflict: "user_id,date" })
          if (error) throw error
        } else {
          addToSyncQueue(user.id, {
            table: "daily_suggestions",
            action: "upsert",
            data: record,
            conflictKey: "user_id,date",
          })
        }
      } catch (err) {
        console.error("Failed to save daily suggestion:", err)
      }
    },
    [user]
  )

  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }
    let cancelled = false

    async function load() {
      const cached = getLocalData<DailySuggestion>(cacheKey(user!.id))
      if (cached && cached.date === todayStr()) setSuggestion(cached)

      const anchorCutoff = new Date()
      anchorCutoff.setDate(anchorCutoff.getDate() - 4)
      const windowCutoff = new Date()
      windowCutoff.setDate(windowCutoff.getDate() - FETCH_WINDOW_DAYS)

      const [values, moveRes, anchorRes, windowRes] = await Promise.all([
        getCompassValueTags(user!.id),
        isOnline()
          ? supabase.from("move_suggestions").select("*").eq("user_id", user!.id)
          : Promise.resolve({ data: null }),
        isOnline()
          ? supabase
              .from("daily_anchors")
              .select("date,future_task,mindbody_task,life_task")
              .eq("user_id", user!.id)
              .gte("date", localDateStr(anchorCutoff))
          : Promise.resolve({ data: null }),
        isOnline()
          ? supabase
              .from("daily_suggestions")
              .select("*")
              .eq("user_id", user!.id)
              .gte("date", localDateStr(windowCutoff))
              .order("date", { ascending: false })
          : Promise.resolve({ data: null }),
      ])
      if (cancelled) return

      valuesRef.current = values
      const moveRows = (moveRes?.data as MoveSuggestion[] | null) ?? []
      poolRef.current = buildVisibleSuggestions(moveRows, currentWeekKey(), materializeDefaultSuggestions(t))

      const anchorRows = (anchorRes?.data as DailyAnchor[] | null) ?? []
      const recent = new Set<string>(getRecentlyUsedTitles(anchorRows, 3))
      const allWindow = (windowRes?.data as DailySuggestion[] | null) ?? []
      for (const r of allWindow) {
        if (r.date < todayStr() && daysAgo(r.date) <= 4 && r.suggestion_text) {
          recent.add(norm(r.suggestion_text))
        }
      }
      recentTitlesRef.current = recent
      setWindowRows(allWindow)

      // Follow-up: most recent eligible past accepted suggestion (allWindow
      // is already newest-first). Resolved once here so marking it seen
      // doesn't make the card vanish mid-interaction.
      if (!followUpSeenRef.current) {
        setFollowUpRow(allWindow.find(isFollowUpEligible) ?? null)
      }

      let todayRow: DailySuggestion | null = null
      if (isOnline()) {
        todayRow = allWindow.find((r) => r.date === todayStr()) ?? null
      } else {
        todayRow = cached && cached.date === todayStr() ? cached : null
      }

      if (todayRow) {
        seenTitlesRef.current = new Set([norm(todayRow.suggestion_text)])
        setSuggestion(todayRow)
        setLocalData(cacheKey(user!.id), todayRow)
        setLoading(false)
        return
      }

      if (creatingRef.current) return
      creatingRef.current = true

      const pick = pickDailySuggestion({
        pool: poolRef.current,
        values: valuesRef.current,
        seed: `${user!.id}:${todayStr()}`,
        recentTitles: recentTitlesRef.current,
      })
      if (!pick) {
        creatingRef.current = false
        setLoading(false)
        return
      }

      const now = new Date().toISOString()
      const record = {
        user_id: user!.id,
        date: todayStr(),
        source_move_item_id: pick.sourceMoveItemId,
        suggestion_text: pick.text,
        status: "pending" as DailySuggestionStatus,
      }
      seenTitlesRef.current = new Set([norm(pick.text)])
      persistToday({
        id: "",
        ...record,
        responded_at: null,
        follow_up_shown: false,
        follow_up_response: null,
        created_at: now,
        updated_at: now,
      })
      setLoading(false)

      await write(record)
      if (cancelled) return
      if (isOnline()) {
        const { data } = await supabase
          .from("daily_suggestions")
          .select("*")
          .eq("user_id", user!.id)
          .eq("date", todayStr())
          .maybeSingle()
        if (!cancelled && data) persistToday(data as DailySuggestion)
      }
      creatingRef.current = false
    }

    load().catch((err) => {
      console.error("Daily suggestion load failed:", err)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const respond = useCallback(
    async (status: "accepted" | "declined") => {
      if (!user || !suggestion) return
      setBusy(true)
      const respondedAt = new Date().toISOString()
      persistToday({ ...suggestion, status, responded_at: respondedAt, updated_at: respondedAt })
      await write({
        user_id: user.id,
        date: todayStr(),
        source_move_item_id: suggestion.source_move_item_id,
        suggestion_text: suggestion.suggestion_text,
        status,
        responded_at: respondedAt,
      })
      setBusy(false)
    },
    // persistToday is a stable-enough closure over setstate setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, suggestion, write]
  )

  const another = useCallback(async () => {
    if (!user || !suggestion) return
    setBusy(true)

    seenTitlesRef.current.add(norm(suggestion.suggestion_text))
    let pick = pickDailySuggestion({
      pool: poolRef.current,
      values: valuesRef.current,
      seed,
      recentTitles: recentTitlesRef.current,
      excludeTitles: seenTitlesRef.current,
    })
    if (!pick) {
      seenTitlesRef.current = new Set([norm(suggestion.suggestion_text)])
      pick = pickDailySuggestion({
        pool: poolRef.current,
        values: valuesRef.current,
        seed,
        excludeTitles: seenTitlesRef.current,
      })
    }
    if (!pick) {
      setBusy(false)
      return
    }

    const now = new Date().toISOString()
    persistToday({
      ...suggestion,
      source_move_item_id: pick.sourceMoveItemId,
      suggestion_text: pick.text,
      status: "pending",
      responded_at: null,
      updated_at: now,
    })
    await write({
      user_id: user.id,
      date: todayStr(),
      source_move_item_id: pick.sourceMoveItemId,
      suggestion_text: pick.text,
      status: "pending",
      responded_at: null,
    })
    setBusy(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, suggestion, seed, write])

  const writeFollowUp = useCallback(
    (response: FollowUpResponse | null) => {
      const row = followUpRow
      if (!user || !row) return
      const now = new Date().toISOString()
      const { id: _id, created_at: _created, ...rest } = row
      write({
        ...rest,
        follow_up_shown: true,
        follow_up_response: response ?? row.follow_up_response,
        updated_at: now,
      })
    },
    [user, followUpRow, write]
  )

  const markFollowUpSeen = useCallback(() => {
    if (followUpSeenRef.current || !followUpRow) return
    followUpSeenRef.current = true
    writeFollowUp(null)
  }, [followUpRow, writeFollowUp])

  const respondFollowUp = useCallback(
    (response: FollowUpResponse) => {
      writeFollowUp(response)
      setFollowUpCleared(true)
    },
    [writeFollowUp]
  )

  const dismissFollowUp = useCallback(() => {
    writeFollowUp(null)
    setFollowUpCleared(true)
  }, [writeFollowUp])

  const history = useMemo(
    () => windowRows.filter((r) => daysAgo(r.date) < HISTORY_DAYS).sort((a, b) => b.date.localeCompare(a.date)),
    [windowRows]
  )

  const value: DailySuggestionContextValue = {
    suggestion,
    loading,
    busy,
    accept: () => respond("accepted"),
    decline: () => respond("declined"),
    another,
    history,
    followUp: followUpCleared ? null : followUpRow,
    markFollowUpSeen,
    respondFollowUp,
    dismissFollowUp,
  }

  return <DailySuggestionContext.Provider value={value}>{children}</DailySuggestionContext.Provider>
}

// Consumed by Home's card and the /anchor screen — both read and write the
// same row through this one provider, so responses stay in sync.
export function useDailySuggestion(): DailySuggestionContextValue {
  const ctx = useContext(DailySuggestionContext)
  if (!ctx) throw new Error("useDailySuggestion must be used within DailySuggestionProvider")
  return ctx
}

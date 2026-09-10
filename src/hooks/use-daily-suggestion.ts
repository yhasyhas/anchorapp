import { useCallback, useEffect, useRef, useState } from "react"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { addToSyncQueue, isOnline, getLocalData, setLocalData } from "@/lib/offline-sync"
import { getCompassValueTags } from "@/lib/compass"
import { getRecentlyUsedTitles } from "@/lib/move-selection"
import { pickDailySuggestion } from "@/lib/daily-suggestion"
import { todayStr, localDateStr } from "@/lib/utils"
import type { DailyAnchor, DailySuggestion, DailySuggestionStatus, MoveSuggestion } from "@/types"

// One suggestion per user per day, at the top of Home. Owns: loading (or
// creating, once) today's daily_suggestions row, the three no-friction
// responses, and the "another suggestion" rotation. Deliberately separate
// from useDailyCycle — it reads that hook's already-built Move pool and
// recent anchors but never writes an anchor or touches the streak.
export interface UseDailySuggestionResult {
  suggestion: DailySuggestion | null
  loading: boolean
  busy: boolean
  accept: () => void
  decline: () => void
  another: () => void
}

function cacheKey(userId: string): string {
  return `daily_suggestion_${userId}_${todayStr()}`
}

function norm(title: string): string {
  return title.trim().toLowerCase()
}

export function useDailySuggestion(
  user: User | null,
  movePool: MoveSuggestion[],
  recentAnchors: DailyAnchor[]
): UseDailySuggestionResult {
  const [suggestion, setSuggestion] = useState<DailySuggestion | null>(
    () => (user && getLocalData<DailySuggestion>(cacheKey(user.id))) || null
  )
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // The pool and recent anchors change identity on every Home render (fresh
  // arrays), and the create/rotate paths are async — refs keep them current
  // without re-triggering the load effect or going stale in a closure.
  const poolRef = useRef(movePool)
  poolRef.current = movePool
  const recentAnchorsRef = useRef(recentAnchors)
  recentAnchorsRef.current = recentAnchors

  // Compass values + the titles seen in the last few days — resolved once
  // per mount alongside the row, then reused by "another suggestion".
  const valuesRef = useRef<string[]>([])
  const recentTitlesRef = useRef<Set<string>>(new Set())
  // Everything already shown today (the current pick + every earlier
  // "another suggestion" this session) — hard-excluded from the next pick.
  const seenTitlesRef = useRef<Set<string>>(new Set())
  const creatingRef = useRef(false)

  const seed = user ? `${user.id}:${todayStr()}` : ""

  function persist(row: DailySuggestion) {
    setSuggestion(row)
    setLocalData(cacheKey(row.user_id), row)
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
      const key = cacheKey(user!.id)
      const cached = getLocalData<DailySuggestion>(key)
      if (cached && cached.date === todayStr()) setSuggestion(cached)

      // Recent context — value tags, and titles surfaced over the last 4
      // days (as suggestions or in her anchors) to soft-avoid repeats.
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 4)
      const [values, recentRows] = await Promise.all([
        getCompassValueTags(user!.id),
        isOnline()
          ? supabase
              .from("daily_suggestions")
              .select("suggestion_text,date")
              .eq("user_id", user!.id)
              .gte("date", localDateStr(cutoff))
              .lt("date", todayStr())
          : Promise.resolve({ data: null }),
      ])
      if (cancelled) return
      valuesRef.current = values
      const recent = new Set<string>(getRecentlyUsedTitles(recentAnchorsRef.current, 3))
      for (const r of (recentRows?.data as { suggestion_text: string }[] | null) ?? []) {
        if (r.suggestion_text) recent.add(norm(r.suggestion_text))
      }
      recentTitlesRef.current = recent

      let row: DailySuggestion | null = null
      if (isOnline()) {
        const { data, error } = await supabase
          .from("daily_suggestions")
          .select("*")
          .eq("user_id", user!.id)
          .eq("date", todayStr())
          .maybeSingle()
        if (cancelled) return
        if (error) console.error("Failed to load daily suggestion:", error)
        row = (data as DailySuggestion | null) ?? null
      } else {
        row = cached && cached.date === todayStr() ? cached : null
      }

      if (row) {
        seenTitlesRef.current = new Set([norm(row.suggestion_text)])
        persist(row)
        setLoading(false)
        return
      }

      // No row for today yet — make the pick once and store it.
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

      const optimistic: DailySuggestion = {
        id: "",
        ...record,
        responded_at: null,
        follow_up_shown: false,
        follow_up_response: null,
        created_at: now,
        updated_at: now,
      }
      seenTitlesRef.current = new Set([norm(pick.text)])
      persist(optimistic)
      setLoading(false)

      await write(record)
      if (cancelled) return
      // Re-read so the row carries its real id/timestamps for later updates.
      if (isOnline()) {
        const { data } = await supabase
          .from("daily_suggestions")
          .select("*")
          .eq("user_id", user!.id)
          .eq("date", todayStr())
          .maybeSingle()
        if (!cancelled && data) persist(data as DailySuggestion)
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
      persist({ ...suggestion, status, responded_at: respondedAt, updated_at: respondedAt })
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
    // Pool exhausted — every entry has been seen. Start over, excluding only
    // the one on screen, and drop the soft "recent" filter so there's always
    // something to offer (no dead end, no limit on tries — per spec).
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
    persist({
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
  }, [user, suggestion, seed, write])

  return {
    suggestion,
    loading,
    busy,
    accept: () => respond("accepted"),
    decline: () => respond("declined"),
    another,
  }
}

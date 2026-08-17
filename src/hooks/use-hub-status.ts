import { useEffect, useState } from "react"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { countGratitudes } from "@/lib/gratitude"
import { listMemberships } from "@/lib/circle"

export interface UseHubStatusResult {
  lettersCount: number | null
  circleMemberCount: number | null
  jarCount: number | null
  /** ISO `month_start` of the most recent generated Wrapped recap, or null if none exist yet. */
  wrappedLatestMonth: string | null
}

// Feeds the short contextual status line on each tile of the "More" hub
// modal (web mobile port of feature/capacitor-mobile's Hub) — same
// "one independent fetch-and-forget effect per concern" shape as
// use-home-badges.ts. `refreshKey` (AppLayout passes the route pathname)
// keeps counts fresh across in-app navigation, same reasoning as
// use-home-badges.
export function useHubStatus(user: User | null, refreshKey?: string): UseHubStatusResult {
  const [lettersCount, setLettersCount] = useState<number | null>(null)
  const [circleMemberCount, setCircleMemberCount] = useState<number | null>(null)
  const [jarCount, setJarCount] = useState<number | null>(null)
  const [wrappedLatestMonth, setWrappedLatestMonth] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    supabase
      .from("weekly_letters")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .then(({ count }) => {
        if (!cancelled) setLettersCount(count ?? 0)
      })
    return () => {
      cancelled = true
    }
  }, [user, refreshKey])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    listMemberships()
      .then((memberships) => {
        if (!cancelled) setCircleMemberCount(memberships.filter((m) => m.status === "active").length)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user, refreshKey])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    countGratitudes()
      .then((count) => {
        if (!cancelled) setJarCount(count)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user, refreshKey])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    supabase
      .from("monthly_recaps")
      .select("month_start")
      .eq("user_id", user.id)
      .order("month_start", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setWrappedLatestMonth(data?.month_start ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [user, refreshKey])

  return { lettersCount, circleMemberCount, jarCount, wrappedLatestMonth }
}

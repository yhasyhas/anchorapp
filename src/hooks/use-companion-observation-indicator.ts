import { useEffect, useState } from "react"
import type { User } from "@supabase/supabase-js"
import { hasUnshownObservation } from "@/lib/companion-observations"

// Cheap existence check driving the Companion entry button's dot — same
// "fetch on mount/nav, nothing to show unless it finds something" shape as
// use-home-badges.ts's three badges, but kept separate (different table,
// nothing else in common). Never mutates anything: the actual list, and the
// shown_at/acknowledged writes, live in CompanionPanel, only while it's
// actually open. Pass `user: null` (e.g. when profiles.ai_enabled is off)
// to skip the check entirely.
export function useCompanionObservationIndicator(user: User | null, refreshKey?: string): boolean {
  const [hasPending, setHasPending] = useState(false)

  useEffect(() => {
    if (!user) {
      setHasPending(false)
      return
    }
    let cancelled = false
    hasUnshownObservation(user.id)
      .then((pending) => {
        if (!cancelled) setHasPending(pending)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user, refreshKey])

  return hasPending
}

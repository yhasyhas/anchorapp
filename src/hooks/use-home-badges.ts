import { useEffect, useState } from "react"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { getLastSeenLetterWeek } from "@/lib/letters"
import { listPendingReceivedInvites, listReceivedEncouragements } from "@/lib/circle"
import { ensureWrappedGenerated } from "@/lib/wrapped"
import type { Profile } from "@/types"

export interface UseHomeBadgesResult {
  hasUnreadLetter: boolean
  hasPendingCircleInvite: boolean
  hasUnreadEncouragement: boolean
}

// Extracted from src/pages/home.tsx: three independent header-icon badge
// dots, each its own fetch-on-mount-and-forget effect, plus the Wrapped
// fire-and-forget generation check — all share the same shape ("nothing to
// show for it unless it finds something") and none feed into the daily
// cycle, so they're grouped here rather than in useDailyCycle.
export function useHomeBadges(user: User | null, profile: Profile | null): UseHomeBadgesResult {
  const [hasUnreadLetter, setHasUnreadLetter] = useState(false)
  const [hasPendingCircleInvite, setHasPendingCircleInvite] = useState(false)
  const [hasUnreadEncouragement, setHasUnreadEncouragement] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    checkUnreadLetter(user.id).then((unread) => {
      if (!cancelled) setHasUnreadLetter(unread)
    })
    return () => {
      cancelled = true
    }
  }, [user])

  // Fire-and-forget, same "nothing to show for it unless it finds something"
  // pattern as checkUnreadLetter above — generates last month's Wrapped the
  // first time she opens the app in a new month (see src/lib/wrapped.ts).
  useEffect(() => {
    if (user) ensureWrappedGenerated(user, profile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Drives only the Settings icon's badge dot — the nudge card itself
  // (CircleInviteNudge, rendered separately) does its own independent fetch
  // of the same data, same pattern as PushNudge fetching its own push state.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    listPendingReceivedInvites(user.id)
      .then((invites) => {
        if (!cancelled) setHasPendingCircleInvite(invites.length > 0)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user])

  // Same badge-dot pattern — the /circle page itself marks encouragements
  // read as soon as it's opened, so this only ever reflects "not yet seen".
  useEffect(() => {
    if (!user) return
    let cancelled = false
    listReceivedEncouragements()
      .then((received) => {
        if (!cancelled) setHasUnreadEncouragement(received.some((e) => !e.read_at))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user])

  return { hasUnreadLetter, hasPendingCircleInvite, hasUnreadEncouragement }
}

async function checkUnreadLetter(userId: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("weekly_letters")
      .select("week_start")
      .eq("user_id", userId)
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle()

    const latest = data?.week_start
    if (!latest) return false
    const lastSeen = getLastSeenLetterWeek(userId)
    return !lastSeen || latest > lastSeen
  } catch {
    // Badge is a nice-to-have — not worth surfacing an error toast for.
    return false
  }
}

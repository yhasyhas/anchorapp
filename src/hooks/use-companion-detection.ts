import { useEffect } from "react"
import { useAuth } from "@/lib/auth-context"
import { runCompanionDetectionOncePerDay } from "@/lib/companion-detection"
import { isOnline } from "@/lib/offline-sync"

// Silent, data-only: records Companion observations in the background when
// Home mounts (see src/lib/companion-detection.ts). Renders nothing and
// never surfaces an error to her. The effect only re-runs when the user (or
// account age) changes, and runCompanionDetectionOncePerDay collapses every
// other call — StrictMode double-effects, Home remounts, a second session
// the same day — into a no-op, so this is not a per-render recompute.
export function useCompanionDetection(): void {
  const { user, profile } = useAuth()
  const userId = user?.id
  const profileCreatedAt = profile?.created_at

  useEffect(() => {
    if (!userId || !profileCreatedAt || !isOnline()) return
    runCompanionDetectionOncePerDay(userId, profileCreatedAt).catch((err) => {
      console.error("Companion detection failed:", err)
    })
  }, [userId, profileCreatedAt])
}

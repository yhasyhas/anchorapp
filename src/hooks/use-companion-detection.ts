import { useEffect } from "react"
import { useAuth } from "@/lib/auth-context"
import { runCompanionDetectionOncePerDay } from "@/lib/companion-detection"
import { isOnline } from "@/lib/offline-sync"

// Silent, data-only: records Companion observations in the background when
// Home mounts (see src/lib/companion-detection.ts). Renders nothing and
// never surfaces an error to her. The effect only re-runs when the user or
// the AI toggle changes, and runCompanionDetectionOncePerDay collapses
// every other call — StrictMode double-effects, Home remounts, a second
// session the same day — into a no-op, so this is not a per-render
// recompute. Does nothing at all while "Enable AI insights" is off.
export function useCompanionDetection(): void {
  const { user, profile } = useAuth()
  const userId = user?.id
  // Settings' "Enable AI insights" (profiles.ai_enabled, off by default).
  const aiEnabled = profile?.ai_enabled ?? false

  useEffect(() => {
    if (!userId || !aiEnabled || !isOnline()) return
    runCompanionDetectionOncePerDay({ userId, aiEnabled }).catch((err) => {
      console.error("Companion detection failed:", err)
    })
    // aiEnabled is a dep so switching the toggle on while Home is mounted
    // starts a run; switching it off never does (the guard returns early).
  }, [userId, aiEnabled])
}

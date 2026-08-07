import { useCallback, useEffect, useState } from "react"
import { listCustomIntentions } from "@/lib/custom-intentions"
import type { CustomIntention } from "@/types"

export interface UseCustomIntentionsResult {
  customIntentions: CustomIntention[]
  loading: boolean
  refetch: () => Promise<void>
}

// Loads the signed-in user's active custom intentions once on mount — small list (max 3,
// see MAX_ACTIVE_CUSTOM_INTENTIONS), so a plain refetch-after-write is simpler than wiring
// this into the offline-sync cache used for the daily anchors/mood/check-in write path.
export function useCustomIntentions(userId: string | undefined): UseCustomIntentionsResult {
  const [customIntentions, setCustomIntentions] = useState<CustomIntention[]>([])
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    if (!userId) {
      setCustomIntentions([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const data = await listCustomIntentions(userId)
      setCustomIntentions(data)
    } catch {
      setCustomIntentions([])
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { customIntentions, loading, refetch }
}

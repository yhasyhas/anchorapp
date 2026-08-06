import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ConfettiBurst } from "@/components/anchor/confetti"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { isOnline, addToSyncQueue, getLocalData, setLocalData } from "@/lib/offline-sync"
import { todayStr } from "@/lib/utils"
import type { DailyAnchor } from "@/types"

interface PauseFocusSessionProps {
  onClose: () => void
}

const DURATION_OPTIONS_MIN = [15, 25] as const

// Point 4b: a 15/25 min timer over today's Future anchor. The countdown is
// timestamp-based (elapsed = now - startedAt, recomputed every tick) rather
// than a naive decrementing counter, so it stays correct even if the PWA
// gets backgrounded/throttled by the OS mid-session and the tick interval
// falls behind — it just catches up to the right remaining time (or "done")
// the next time it fires, instead of drifting. No push notification on
// completion by design (see Point 4 discussion): a chunk of iOS users would
// never receive it anyway (Web Push there requires an installed PWA), and
// it would misrepresent a feature that only really works while the app is
// open in the foreground.
export function PauseFocusSession({ onClose }: PauseFocusSessionProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [futureTask, setFutureTask] = useState<string | null>(null)
  const [alreadyCompleted, setAlreadyCompleted] = useState(false)
  const [durationMin, setDurationMin] = useState<number | null>(null)
  const [remainingMs, setRemainingMs] = useState(0)
  const [ended, setEnded] = useState(false)
  const [markedDone, setMarkedDone] = useState(false)
  const startedAtRef = useRef<number | null>(null)

  // Independent read of today's anchor row — same read-cache key
  // (`anchor_${userId}_${date}`) src/hooks/use-daily-cycle.ts already
  // populates from Home, so this works offline too without a new cache
  // mechanism. Deliberately not sharing useDailyCycle's instance/state:
  // that hook is only ever mounted once, on Home, and this button lives in
  // AppLayout (every route) — mounting a second instance here would double
  // every fetch it does (moods/anchors/companion message/etc.) just to read
  // one field.
  useEffect(() => {
    if (!user) return
    const userId = user.id
    const cacheKey = `anchor_${userId}_${todayStr()}`

    async function load() {
      const cached = getLocalData<DailyAnchor>(cacheKey)
      if (cached) {
        setFutureTask(cached.future_task || null)
        setAlreadyCompleted(cached.future_completed)
      }
      if (!isOnline()) return
      try {
        const { data } = await supabase
          .from("daily_anchors")
          .select("*")
          .eq("user_id", userId)
          .eq("date", todayStr())
          .maybeSingle()
        if (data) {
          const anchor = data as DailyAnchor
          setLocalData(cacheKey, anchor)
          setFutureTask(anchor.future_task || null)
          setAlreadyCompleted(anchor.future_completed)
        }
      } catch {
        // keep whatever the cache already gave us
      }
    }
    load()
  }, [user])

  useEffect(() => {
    if (!durationMin || startedAtRef.current === null) return
    const totalMs = durationMin * 60000

    const tick = () => {
      const elapsed = Date.now() - startedAtRef.current!
      const remaining = totalMs - elapsed
      if (remaining <= 0) {
        setRemainingMs(0)
        setEnded(true)
      } else {
        setRemainingMs(remaining)
      }
    }

    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [durationMin])

  function pickDuration(min: number) {
    setDurationMin(min)
    startedAtRef.current = Date.now()
    setRemainingMs(min * 60000)
  }

  async function markFutureDone() {
    if (!user) return
    setMarkedDone(true)
    const record = { user_id: user.id, date: todayStr(), future_completed: true }
    try {
      if (isOnline()) {
        await supabase.from("daily_anchors").upsert(record, { onConflict: "user_id,date" })
      } else {
        addToSyncQueue(user.id, { table: "daily_anchors", action: "upsert", data: record, conflictKey: "user_id,date" })
      }
    } catch {
      // best-effort — she can still check it off normally on Home if this fails
    }
  }

  if (durationMin === null) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-background/98 p-6 text-center backdrop-blur-md">
        <p className="font-heading text-xl font-medium text-foreground">{t("pause.focus_pick_duration")}</p>
        <div className="flex gap-3">
          {DURATION_OPTIONS_MIN.map((min) => (
            <Button key={min} variant="outline" onClick={() => pickDuration(min)} className="px-6">
              {t("pause.duration_minutes", { count: min })}
            </Button>
          ))}
        </div>
        <Button variant="ghost" className="text-muted-foreground" onClick={onClose}>
          {t("pause.not_now")}
        </Button>
      </div>
    )
  }

  const totalMs = durationMin * 60000
  const progressPct = Math.min(100, Math.round(((totalMs - remainingMs) / totalMs) * 100))
  const minutesLeft = Math.floor(remainingMs / 60000)
  const secondsLeft = Math.floor((remainingMs % 60000) / 1000)

  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-8 bg-background/98 p-6 text-center backdrop-blur-md">
      <ConfettiBurst active={ended} />

      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("pause.focus_label")}</p>
        <p className="mt-2 max-w-xs font-heading text-lg font-semibold text-foreground">
          {futureTask || t("pause.focus_no_task")}
        </p>
      </div>

      {!ended ? (
        <>
          <p className="font-heading text-5xl font-bold tabular-nums text-foreground">
            {minutesLeft}:{secondsLeft.toString().padStart(2, "0")}
          </p>
          <Progress value={progressPct} className="w-48" />
          <div className="flex flex-col items-center gap-2">
            <Button variant="ghost" className="text-muted-foreground" onClick={onClose}>
              {t("pause.focus_end_early")}
            </Button>
            <p className="text-xs italic text-muted-foreground">{t("pause.focus_no_guilt")}</p>
          </div>
        </>
      ) : (
        <>
          <p className="font-heading text-2xl font-semibold text-primary">{t("pause.focus_done")}</p>
          <div className="flex flex-col gap-3">
            {futureTask && !alreadyCompleted && !markedDone && (
              <Button onClick={markFutureDone}>{t("pause.focus_mark_done")}</Button>
            )}
            <Button variant="ghost" className="text-muted-foreground" onClick={onClose}>
              {t("pause.focus_close")}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

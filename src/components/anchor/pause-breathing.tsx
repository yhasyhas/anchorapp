import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { BreathingSession } from "@/components/anchor/breathing-session"

interface PauseBreathingProps {
  onClose: () => void
}

const DURATION_OPTIONS_MIN = [1, 2, 3] as const
// Same phase durations as the morning ritual's engine (4s inhale + 2s hold
// + 4s exhale = 10s/cycle) — picking a duration just picks how many cycles
// to run, not a different rhythm.
const CYCLE_SECONDS = 10

// Point 4a: a duration picker (1-3 min) in front of the shared breathing
// engine, skippable at any point — see breathing-session.tsx.
export function PauseBreathing({ onClose }: PauseBreathingProps) {
  const { t } = useTranslation()
  const [durationMin, setDurationMin] = useState<number | null>(null)

  if (durationMin !== null) {
    const cycles = Math.max(1, Math.round((durationMin * 60) / CYCLE_SECONDS))
    return (
      <BreathingSession
        cycles={cycles}
        texts={{
          inhale: t("ritual.inhale"),
          hold: t("ritual.hold"),
          exhale: t("ritual.exhale"),
          done: t("pause.breathing_done"),
          cycleLabel: t("ritual.cycle"),
        }}
        skipLabel={t("pause.skip")}
        onComplete={onClose}
        onSkip={onClose}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-background/98 p-6 text-center backdrop-blur-md">
      <p className="font-heading text-xl font-medium text-foreground">{t("pause.breathing_pick_duration")}</p>
      <div className="flex gap-3">
        {DURATION_OPTIONS_MIN.map((min) => (
          <Button key={min} variant="outline" onClick={() => setDurationMin(min)} className="px-6">
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

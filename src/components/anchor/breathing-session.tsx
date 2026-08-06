import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"

export interface BreathingSessionTexts {
  inhale: string
  hold: string
  exhale: string
  done: string
  cycleLabel: string
}

export interface BreathingSessionProps {
  cycles: number
  inhaleMs?: number
  holdMs?: number
  exhaleMs?: number
  texts: BreathingSessionTexts
  skipLabel: string
  onComplete: () => void
  onSkip: () => void
}

const DEFAULT_INHALE_MS = 4000
const DEFAULT_HOLD_MS = 2000
const DEFAULT_EXHALE_MS = 4000

// Generic inhale -> hold -> exhale -> done cycle engine, full-screen,
// dark-mode aware (CSS vars only, no hardcoded colors). Extracted from what
// used to be inline in MorningRitual (see that component for the "once per
// day" gating this engine deliberately does NOT own) so the Pause menu's
// "Guided breathing" option (src/components/anchor/pause-breathing.tsx) can
// reuse the exact same mechanism with a configurable cycle count instead of
// duplicating it. Text/labels are passed in rather than read from i18n here
// directly, since the two callers use different copy ("You are anchored"
// only makes sense for the morning ritual, not a daytime pause).
export function BreathingSession({
  cycles,
  inhaleMs = DEFAULT_INHALE_MS,
  holdMs = DEFAULT_HOLD_MS,
  exhaleMs = DEFAULT_EXHALE_MS,
  texts,
  skipLabel,
  onComplete,
  onSkip,
}: BreathingSessionProps) {
  const [phase, setPhase] = useState<"inhale" | "hold" | "exhale" | "done">("inhale")
  const [cycle, setCycle] = useState(0)

  useEffect(() => {
    const phases: ("inhale" | "hold" | "exhale")[] = ["inhale", "hold", "exhale"]
    const durations = { inhale: inhaleMs, hold: holdMs, exhale: exhaleMs }
    let currentCycle = 0
    let currentPhase = 0
    let timer: ReturnType<typeof setTimeout>

    const runPhase = () => {
      if (currentCycle >= cycles) {
        setPhase("done")
        timer = setTimeout(onComplete, 1500)
        return
      }

      setPhase(phases[currentPhase])
      const duration = durations[phases[currentPhase]]

      currentPhase++
      if (currentPhase >= phases.length) {
        currentPhase = 0
        currentCycle++
        setCycle(currentCycle)
      }

      timer = setTimeout(runPhase, duration)
    }

    timer = setTimeout(runPhase, 500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycles, inhaleMs, holdMs, exhaleMs])

  const phaseTexts = { inhale: texts.inhale, hold: texts.hold, exhale: texts.exhale, done: texts.done }
  const scale = phase === "inhale" ? "scale-150" : phase === "hold" ? "scale-150" : "scale-100"

  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-background/98 backdrop-blur-md p-6">
      <div className="relative flex flex-col items-center">
        <div
          className={`h-40 w-40 rounded-full bg-sage-light/60 transition-transform duration-[4000ms] ease-in-out ${scale}`}
        />
        <div className="absolute inset-0 flex h-40 w-40 items-center justify-center">
          <div className="h-32 w-32 rounded-full bg-primary/10" />
        </div>

        <p className="mt-10 font-heading text-xl font-medium text-foreground animate-pulse">{phaseTexts[phase]}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {texts.cycleLabel} {Math.min(cycle + 1, cycles)} / {cycles}
        </p>
      </div>

      <Button variant="ghost" className="mt-12 text-muted-foreground hover:text-foreground" onClick={onSkip}>
        {skipLabel}
      </Button>
    </div>
  )
}

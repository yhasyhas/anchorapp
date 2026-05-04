import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"

const RITUAL_KEY = "anchor_morning_ritual_done"

interface MorningRitualProps {
  onComplete: () => void
}

export function MorningRitual({ onComplete }: MorningRitualProps) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<"inhale" | "hold" | "exhale" | "done">("inhale")
  const [cycle, setCycle] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const today = new Date().toISOString().split("T")[0]
    const done = localStorage.getItem(RITUAL_KEY)
    if (done !== today) setVisible(true)
  }, [])

  useEffect(() => {
    if (!visible) return

    const phases: ("inhale" | "hold" | "exhale")[] = ["inhale", "hold", "exhale"]
    let currentCycle = 0
    let currentPhase = 0

    const runPhase = () => {
      if (currentCycle >= 3) {
        setPhase("done")
        const today = new Date().toISOString().split("T")[0]
        localStorage.setItem(RITUAL_KEY, today)
        setTimeout(() => {
          setVisible(false)
          onComplete()
        }, 1500)
        return
      }

      setPhase(phases[currentPhase])
      const duration = phases[currentPhase] === "hold" ? 2000 : 4000

      currentPhase++
      if (currentPhase >= phases.length) {
        currentPhase = 0
        currentCycle++
        setCycle(currentCycle)
      }

      setTimeout(runPhase, duration)
    }

    const timer = setTimeout(runPhase, 500)
    return () => clearTimeout(timer)
  }, [visible, onComplete])

  if (!visible) return null

  const texts = {
    inhale: t("ritual.inhale"),
    hold: t("ritual.hold"),
    exhale: t("ritual.exhale"),
    done: t("ritual.done"),
  }

  const scale = phase === "inhale" ? "scale-150" : phase === "hold" ? "scale-150" : "scale-100"

  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-background/98 backdrop-blur-md p-6">
      <div className="relative flex flex-col items-center">
        {/* Cercle de respiration */}
        <div
          className={`h-40 w-40 rounded-full bg-sage-light/60 transition-transform duration-[4000ms] ease-in-out ${scale}`}
        />
        <div className="absolute inset-0 flex h-40 w-40 items-center justify-center">
          <div className="h-32 w-32 rounded-full bg-primary/10" />
        </div>

        {/* Texte */}
        <p className="mt-10 font-heading text-xl font-medium text-foreground animate-pulse">
          {texts[phase]}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("ritual.cycle")} {Math.min(cycle + 1, 3)} / 3
        </p>
      </div>

      <Button
        variant="ghost"
        className="mt-12 text-muted-foreground hover:text-foreground"
        onClick={() => {
          const today = new Date().toISOString().split("T")[0]
          localStorage.setItem(RITUAL_KEY, today)
          setVisible(false)
          onComplete()
        }}
      >
        {t("ritual.skip")}
      </Button>
    </div>
  )
}
import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { todayStr } from "@/lib/utils"
import { useAuth } from "@/lib/auth-context"
import { userKey } from "@/lib/user-storage"
import { BreathingSession } from "@/components/anchor/breathing-session"

const RITUAL_KEY_BASE = "anchor_morning_ritual_done"
const RITUAL_CYCLES = 3

interface MorningRitualProps {
  onComplete: () => void
}

export function MorningRitual({ onComplete }: MorningRitualProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!user) return
    const today = todayStr()
    const done = localStorage.getItem(userKey(RITUAL_KEY_BASE, user.id))
    if (done !== today) setVisible(true)
  }, [user])

  if (!visible) return null

  function markDoneAndClose() {
    if (user) localStorage.setItem(userKey(RITUAL_KEY_BASE, user.id), todayStr())
    setVisible(false)
    onComplete()
  }

  return (
    <BreathingSession
      cycles={RITUAL_CYCLES}
      texts={{
        inhale: t("ritual.inhale"),
        hold: t("ritual.hold"),
        exhale: t("ritual.exhale"),
        done: t("ritual.done"),
        cycleLabel: t("ritual.cycle"),
      }}
      skipLabel={t("ritual.skip")}
      onComplete={markDoneAndClose}
      onSkip={markDoneAndClose}
    />
  )
}

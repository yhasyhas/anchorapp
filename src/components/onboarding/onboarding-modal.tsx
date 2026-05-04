import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Anchor, Sun, Heart, Sparkles } from "lucide-react"

const ONBOARDING_KEY = "anchor_has_seen_onboarding"

export function OnboardingModal() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    const seen = localStorage.getItem(ONBOARDING_KEY)
    if (!seen) setOpen(true)
  }, [])

  function finish() {
    localStorage.setItem(ONBOARDING_KEY, "true")
    setOpen(false)
  }

  if (!open) return null

  const steps = [
    {
      icon: <Anchor className="h-10 w-10 text-primary" />,
      title: t("onboarding.welcome_title"),
      text: t("onboarding.welcome_text"),
      bg: "bg-sage-light/50",
    },
    {
      icon: <Sun className="h-10 w-10 text-peach" />,
      title: t("onboarding.how_title"),
      text: t("onboarding.how_text"),
      bg: "bg-peach/20",
    },
    {
      icon: <Heart className="h-10 w-10 text-rose-accent" />,
      title: t("onboarding.ritual_title"),
      text: t("onboarding.ritual_text"),
      bg: "bg-rose-accent/20",
    },
  ]

  const current = steps[step]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm p-6">
      <div className={`w-full max-w-sm rounded-3xl p-8 text-center transition-all duration-500 ${current.bg}`}>
        <div className="mb-6 flex justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
            {current.icon}
          </div>
        </div>

        <h2 className="font-heading text-2xl font-bold text-foreground mb-3">
          {current.title}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-8">
          {current.text}
        </p>

        {/* Dots */}
        <div className="flex justify-center gap-2 mb-6">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === step ? "w-6 bg-primary" : "w-2 bg-muted-foreground/30"
              }`}
            />
          ))}
        </div>

        <div className="flex gap-3">
          {step > 0 && (
            <Button variant="outline" className="flex-1" onClick={() => setStep(step - 1)}>
              {t("onboarding.back")}
            </Button>
          )}
          {step < steps.length - 1 ? (
            <Button className="flex-1" onClick={() => setStep(step + 1)}>
              {t("onboarding.next")}
            </Button>
          ) : (
            <Button className="flex-1" onClick={finish}>
              <Sparkles className="mr-2 h-4 w-4" />
              {t("onboarding.start")}
            </Button>
          )}
        </div>

        <button
          onClick={finish}
          className="mt-4 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {t("onboarding.skip")}
        </button>
      </div>
    </div>
  )
}
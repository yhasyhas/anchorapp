import { useState } from "react"
import { useNavigate, Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { computeDeliverOn, formatDeliverOn, type LetterDurationMonths } from "@/lib/future-letters"
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ArrowLeft, Mail } from "lucide-react"
import { toast } from "sonner"

const MAX_CHARS = 1000

const PLACEHOLDER_KEYS = [
  "letters.future.write_placeholder_1",
  "letters.future.write_placeholder_2",
  "letters.future.write_placeholder_3",
  "letters.future.write_placeholder_4",
]

type Step = "duration" | "writing" | "sealing" | "sealed"

// Point per MISSION 1: (a) duration choice, (b) free writing, (c) sealing.
// Content is entirely her own words — never sent to AI, never rewritten —
// only the surrounding invitation copy varies by tone picker (MISSION 4).
export function LetterFutureWritePage() {
  const { t, i18n } = useTranslation()
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const reducedMotion = usePrefersReducedMotion()

  const [step, setStep] = useState<Step>("duration")
  const [months, setMonths] = useState<LetterDurationMonths | null>(null)
  const [content, setContent] = useState("")
  const [saving, setSaving] = useState(false)
  const [deliverOn, setDeliverOn] = useState<string | null>(null)
  const [placeholderKey] = useState(() => PLACEHOLDER_KEYS[Math.floor(Math.random() * PLACEHOLDER_KEYS.length)])
  const tone = profile?.tone ?? "gentle"

  function pickDuration(m: LetterDurationMonths) {
    setMonths(m)
    setStep("writing")
  }

  async function handleSeal() {
    if (!user || !months || !content.trim() || saving) return
    setSaving(true)
    const deliver_on = computeDeliverOn(months)
    try {
      const { error } = await supabase.from("future_letters").insert({
        user_id: user.id,
        content: content.trim(),
        deliver_on,
      })
      if (error) {
        toast.error(
          error.message?.includes("max_pending_letters") ? t("letters.future.seal_error_max") : t("letters.future.seal_error_generic")
        )
        setSaving(false)
        return
      }
      setDeliverOn(deliver_on)
      setStep("sealing")
      setTimeout(() => setStep("sealed"), reducedMotion ? 150 : 1600)
    } catch {
      toast.error(t("letters.future.seal_error_generic"))
      setSaving(false)
    }
  }

  if (step === "sealing" || step === "sealed") {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 text-center">
        <div
          className={`text-6xl ${reducedMotion ? "" : "transition-all duration-[1200ms] ease-in-out"} ${
            step === "sealed" ? "scale-100 rotate-0 opacity-100" : "scale-75 -rotate-6 opacity-70"
          }`}
        >
          &#x1F48C;
        </div>
        {step === "sealed" && deliverOn && (
          <>
            <p className="font-heading text-xl font-medium text-foreground">
              {t("letters.future.sealed_message", { date: formatDeliverOn(deliverOn, i18n.language) })}
            </p>
            <Button variant="outline" onClick={() => navigate("/letters")}>
              {t("letters.back_to_list")}
            </Button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Link
        to="/letters"
        onClick={(e) => {
          if (step === "writing") {
            e.preventDefault()
            setStep("duration")
          }
        }}
        className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("letters.back_to_list")}
      </Link>

      <div>
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          <h1 className="font-heading text-2xl font-bold">{t("letters.future.write_title")}</h1>
        </div>
      </div>

      {step === "duration" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("letters.future.duration_title")}</p>
          <button onClick={() => pickDuration(1)} className="block w-full text-left">
            <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-all hover:shadow-[0_4px_15px_rgba(0,0,0,0.06)]">
              <CardContent className="flex items-center gap-4 p-5">
                <span className="text-3xl">&#x1F331;</span>
                <div>
                  <p className="font-heading text-base font-semibold text-foreground">
                    {t("letters.future.duration_one_month")}
                  </p>
                  <p className="text-xs text-muted-foreground">{t("letters.future.duration_one_month_sub")}</p>
                </div>
              </CardContent>
            </Card>
          </button>
          <button onClick={() => pickDuration(3)} className="block w-full text-left">
            <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-all hover:shadow-[0_4px_15px_rgba(0,0,0,0.06)]">
              <CardContent className="flex items-center gap-4 p-5">
                <span className="text-3xl">&#x1F333;</span>
                <div>
                  <p className="font-heading text-base font-semibold text-foreground">
                    {t("letters.future.duration_three_months")}
                  </p>
                  <p className="text-xs text-muted-foreground">{t("letters.future.duration_three_months_sub")}</p>
                </div>
              </CardContent>
            </Card>
          </button>
        </div>
      )}

      {step === "writing" && (
        <div className="space-y-3">
          <p className="text-sm italic text-muted-foreground">{t(`letters.future.write_invite.${tone}`)}</p>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value.slice(0, MAX_CHARS))}
            placeholder={t(placeholderKey)}
            maxLength={MAX_CHARS}
            rows={12}
            autoFocus
            className="resize-none border-0 bg-muted/40 text-base leading-relaxed shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
          />
          <p className={`text-right text-xs ${content.length > MAX_CHARS * 0.9 ? "text-peach" : "text-muted-foreground"}`}>
            {t("letters.future.char_count", { count: content.length, max: MAX_CHARS })}
          </p>
          <Button onClick={handleSeal} disabled={!content.trim() || saving} className="w-full" size="lg">
            <Mail className="mr-2 h-4 w-4" />
            {t("letters.future.seal_cta")}
          </Button>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { daysAgo, formatDeliverOn, isDue } from "@/lib/future-letters"
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { FutureLetter } from "@/types"

type RitualState = "loading" | "not_found" | "not_yet" | "closed" | "opening" | "open"

// MISSION 3's opening ritual: closed envelope -> tap to open -> a brief
// animation -> the typographied reading, same visual language as the
// weekly letter's detail page. Content is fetched via the
// get_future_letter_content RPC ONLY at this point (never on list load),
// which is itself gated server-side on deliver_on — see the migration.
// Revisiting an already-opened letter skips straight to the reading view
// (it's archived now, not re-ritualized every time).
export function LetterFutureDetailPage() {
  const { t, i18n } = useTranslation()
  const { user, profile } = useAuth()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const reducedMotion = usePrefersReducedMotion()

  const [letter, setLetter] = useState<FutureLetter | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [state, setState] = useState<RitualState>("loading")
  const tone = profile?.tone ?? "gentle"

  useEffect(() => {
    if (user && id) load(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, id])

  async function load(letterId: string) {
    if (!user) return
    try {
      const { data, error } = await supabase
        .from("future_letters")
        .select("id, user_id, written_at, deliver_on, delivered_at, opened_at")
        .eq("id", letterId)
        .eq("user_id", user.id)
        .maybeSingle()
      if (error) throw error
      if (!data) {
        setState("not_found")
        return
      }
      const row = data as FutureLetter
      setLetter(row)
      if (!isDue(row.deliver_on)) {
        setState("not_yet")
        return
      }
      if (row.opened_at) {
        await revealContent(letterId, row)
      } else {
        setState("closed")
      }
    } catch (err) {
      console.error("Failed to load future letter:", err)
      toast.error(t("letters.future.error_load"))
      setState("not_found")
    }
  }

  async function revealContent(letterId: string, row: FutureLetter) {
    const { data, error } = await supabase.rpc("get_future_letter_content", { p_id: letterId })
    if (error || typeof data !== "string") {
      toast.error(t("letters.future.error_load"))
      setState("not_yet")
      return
    }
    setContent(data)
    setState("open")
    if (!row.opened_at) {
      const opened_at = new Date().toISOString()
      const { error: updateError } = await supabase.from("future_letters").update({ opened_at }).eq("id", letterId)
      if (!updateError) setLetter((prev) => (prev ? { ...prev, opened_at } : prev))
    }
  }

  function handleOpen() {
    if (!letter || !id) return
    const letterId = id
    const letterRow = letter
    setState("opening")
    setTimeout(() => revealContent(letterId, letterRow), reducedMotion ? 100 : 900)
  }

  if (state === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (state === "not_found") {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="text-sm text-muted-foreground">{t("letters.future.not_found")}</p>
        <Link to="/letters" className="mt-4 inline-block text-sm text-primary underline underline-offset-4">
          {t("letters.back_to_list")}
        </Link>
      </div>
    )
  }

  if (state === "not_yet" && letter) {
    return (
      <div className="mx-auto max-w-lg space-y-3 py-16 text-center">
        <p className="text-5xl">&#x1F48C;</p>
        <p className="font-heading text-lg font-medium text-foreground">{t("letters.future.not_yet_title")}</p>
        <p className="text-sm text-muted-foreground">
          {t("letters.future.not_yet_body", { date: formatDeliverOn(letter.deliver_on, i18n.language) })}
        </p>
        <Link to="/letters" className="mt-4 inline-block text-sm text-primary underline underline-offset-4">
          {t("letters.back_to_list")}
        </Link>
      </div>
    )
  }

  if (state === "closed" || state === "opening") {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 text-center">
        <div
          className={`text-6xl ${reducedMotion ? "" : "transition-all duration-700 ease-in-out"} ${
            state === "opening" ? "scale-125 rotate-3" : "scale-100"
          }`}
        >
          &#x1F48C;
        </div>
        {state === "closed" && (
          <>
            <p className="text-sm italic text-muted-foreground">{t("letters.future.open_ritual_hint")}</p>
            <Button onClick={handleOpen} size="lg">
              {t("letters.future.open_cta")}
            </Button>
          </>
        )}
      </div>
    )
  }

  // state === "open"
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Link to="/letters" className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        {t("letters.back_to_list")}
      </Link>

      <div className="rounded-3xl bg-gradient-to-br from-sage-light/50 via-card to-lavender/20 p-8 shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">{t("letters.future.badge")}</p>
        </div>

        <div className="whitespace-pre-line font-heading text-lg italic leading-relaxed text-foreground/90">{content}</div>

        {letter && (
          <p className="mt-10 text-center font-heading text-sm italic text-primary">
            {t(`letters.future.closing_line.${tone}`, { daysAgo: daysAgo(letter.written_at) })}
          </p>
        )}
      </div>

      <Button onClick={() => navigate("/letters/future/write")} className="w-full gap-1.5">
        {t("letters.future.write_back_cta")}
      </Button>
    </div>
  )
}

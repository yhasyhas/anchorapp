import { useEffect, useMemo, useRef, useState } from "react"
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { buildWrappedCards, type WrappedCard } from "@/lib/wrapped"
import { shareWrappedCard } from "@/lib/wrapped-share"
import { Button } from "@/components/ui/button"
import { X, Share2, Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { MonthlyRecap } from "@/types"

const SWIPE_THRESHOLD_PX = 50

export function WrappedPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const { monthStart } = useParams<{ monthStart: string }>()
  const navigate = useNavigate()

  const [recap, setRecap] = useState<MonthlyRecap | null>(null)
  const [loading, setLoading] = useState(true)
  const [index, setIndex] = useState(0)
  const [sharing, setSharing] = useState(false)
  const touchStartX = useRef<number | null>(null)

  useEffect(() => {
    if (user && monthStart) loadRecap(monthStart)
  }, [user, monthStart])

  async function loadRecap(month: string) {
    if (!user) return
    try {
      const { data, error } = await supabase
        .from("monthly_recaps")
        .select("*")
        .eq("user_id", user.id)
        .eq("month_start", month)
        .maybeSingle()
      if (error) throw error
      setRecap(data as MonthlyRecap | null)
    } catch (err) {
      console.error("Failed to load Wrapped:", err)
    } finally {
      setLoading(false)
    }
  }

  const lang: "en" | "sw" = i18n.language === "sw" ? "sw" : "en"
  const cards = useMemo(() => (recap ? buildWrappedCards(recap, t, lang) : []), [recap, t, lang])
  const card = cards[index]

  function goNext() {
    setIndex((i) => (i < cards.length - 1 ? i + 1 : i))
    if (index >= cards.length - 1) navigate("/wrapped")
  }

  function goBack() {
    setIndex((i) => Math.max(0, i - 1))
  }

  function handleTap(e: ReactMouseEvent<HTMLDivElement>) {
    const isLeftZone = e.clientX < window.innerWidth * 0.3
    if (isLeftZone) goBack()
    else goNext()
  }

  function handleTouchStart(e: ReactTouchEvent) {
    touchStartX.current = e.touches[0].clientX
  }

  function handleTouchEnd(e: ReactTouchEvent) {
    if (touchStartX.current == null) return
    const delta = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return
    if (delta < 0) goNext()
    else goBack()
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight") goNext()
      else if (e.key === "ArrowLeft") goBack()
      else if (e.key === "Escape") navigate("/wrapped")
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, cards.length])

  async function handleShare(e: ReactMouseEvent) {
    e.stopPropagation()
    if (!card) return
    setSharing(true)
    try {
      const result = await shareWrappedCard(card, t("wrapped.share_title"))
      if (result === "downloaded") toast.success(t("wrapped.share_downloaded"))
      else if (result === "failed") toast.error(t("wrapped.share_failed"))
    } finally {
      setSharing(false)
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!recap || cards.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <p className="text-sm text-muted-foreground">{t("wrapped.not_found")}</p>
        <Button variant="outline" onClick={() => navigate("/wrapped")}>
          {t("wrapped.back_to_list")}
        </Button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex select-none flex-col bg-gradient-to-br from-sage-light/40 via-background to-lavender/20">
      <div className="flex gap-1 px-4 pt-4">
        {cards.map((_, i) => (
          <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full bg-primary transition-all duration-300 ${i <= index ? "w-full" : "w-0"}`} />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end px-4 py-2">
        <button
          onClick={() => navigate("/wrapped")}
          aria-label={t("wrapped.close")}
          className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden px-6"
        onClick={handleTap}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div key={index} className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-4 text-center duration-500">
          <WrappedCardView card={card} />
        </div>
      </div>

      <div className="flex justify-center pb-8 pt-2">
        <Button variant="outline" size="sm" onClick={handleShare} disabled={sharing} className="gap-1.5">
          {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
          {t("wrapped.share")}
        </Button>
      </div>
    </div>
  )
}

function WrappedCardView({ card }: { card: WrappedCard }) {
  const isSentenceCard = card.kind === "cover" || card.kind === "treasures" || card.kind === "closing"

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">{card.eyebrow}</p>

      {card.title2 !== undefined ? (
        <div className="flex justify-center gap-10">
          <div>
            <p className="font-heading text-6xl font-bold text-foreground">{card.title}</p>
            <p className="mt-2 text-sm text-muted-foreground">{card.subtitle}</p>
          </div>
          <div>
            <p className="font-heading text-6xl font-bold text-foreground">{card.title2}</p>
            <p className="mt-2 text-sm text-muted-foreground">{card.subtitle2}</p>
          </div>
        </div>
      ) : isSentenceCard ? (
        <>
          <p className="font-heading text-3xl font-semibold italic leading-snug text-foreground">{card.title}</p>
          {card.subtitle && <p className="text-sm text-muted-foreground">{card.subtitle}</p>}
          {card.body && <p className="font-heading text-xl italic leading-relaxed text-foreground/90">{card.body}</p>}
        </>
      ) : (
        <>
          <p className="font-heading text-8xl font-bold text-foreground">{card.title}</p>
          <p className="text-sm text-muted-foreground">{card.subtitle}</p>
        </>
      )}

      {card.footer && <p className="mt-6 text-sm font-medium text-primary">{card.footer}</p>}
    </div>
  )
}

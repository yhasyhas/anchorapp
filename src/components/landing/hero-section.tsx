import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Anchor } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useScrollReveal } from "@/hooks/use-scroll-reveal"

// Miniature, truthful re-creation of the Home screen's shape (mood row + 3 anchors +
// one intention pill) in plain divs, built from the same design tokens — not a captured
// screenshot (which would freeze in stale test data) and not a stock photo.
function PhoneMockup() {
  return (
    <div className="relative mx-auto w-[220px] rounded-[2.25rem] border-[6px] border-foreground/10 bg-card p-3 shadow-[0_20px_50px_rgba(0,0,0,0.12)]">
      <div className="absolute left-1/2 top-1 h-1.5 w-14 -translate-x-1/2 rounded-full bg-foreground/10" />
      <div className="space-y-3 rounded-[1.5rem] bg-background p-3 pt-5">
        <div className="flex justify-between gap-1.5">
          {["😊", "🙂", "😐", "🙁", "😣"].map((emoji, i) => (
            <div
              key={i}
              className={`flex h-8 flex-1 items-center justify-center rounded-lg text-xs ${
                i === 0 ? "bg-peach/50" : "bg-muted/60"
              }`}
            >
              {emoji}
            </div>
          ))}
        </div>
        <div className="rounded-lg bg-sage-light/70 px-2.5 py-1.5 text-[10px] font-medium text-primary">
          ✨ Clarity
        </div>
        <div className="space-y-1.5">
          <div className="rounded-lg border-l-2 border-sage bg-card px-2.5 py-2 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
            <div className="text-[10px] font-semibold text-foreground">Future</div>
            <div className="mt-1 h-1.5 w-4/5 rounded-full bg-muted" />
          </div>
          <div className="rounded-lg border-l-2 border-rose-accent bg-card px-2.5 py-2 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
            <div className="text-[10px] font-semibold text-foreground">Mind / Body</div>
            <div className="mt-1 h-1.5 w-3/5 rounded-full bg-muted" />
          </div>
          <div className="rounded-lg border-l-2 border-lavender bg-card px-2.5 py-2 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
            <div className="text-[10px] font-semibold text-foreground">Life</div>
            <div className="mt-1 h-1.5 w-2/3 rounded-full bg-muted" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function HeroSection() {
  const { t } = useTranslation()
  const { ref, revealed } = useScrollReveal<HTMLDivElement>()

  return (
    <section className="px-6 pb-16 pt-14 text-center">
      <div
        ref={ref}
        className={`mx-auto max-w-md transition-all duration-700 ${
          revealed ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
        }`}
      >
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-sage-light">
          <Anchor className="h-7 w-7 text-primary" />
        </div>
        <h1 className="font-heading text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
          {t("landing.hero_title")}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">{t("landing.hero_subtitle")}</p>

        <div className="mt-8 flex flex-col items-center gap-3">
          <Button asChild size="lg" className="w-full max-w-xs">
            <Link to="/register">{t("landing.hero_cta")}</Link>
          </Button>
          <Link to="/login" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            {t("landing.hero_login_link")}
          </Link>
        </div>

        <div className="mt-12">
          <PhoneMockup />
        </div>
      </div>
    </section>
  )
}

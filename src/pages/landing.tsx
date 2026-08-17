import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { LandingHeader } from "@/components/landing/landing-header"
import { HeroSection } from "@/components/landing/hero-section"
import { ValuesSection } from "@/components/landing/values-section"
import { FutureLetterSection } from "@/components/landing/future-letter-section"
import { QuoteSection } from "@/components/landing/quote-section"
import { LandingFooter } from "@/components/landing/landing-footer"
import { InstallPrompt } from "@/components/pwa/install-prompt"

export function LandingPage() {
  const { t } = useTranslation()

  // Lightweight per-route SEO — no react-helmet dependency for the two pages
  // (this one + privacy.tsx) that actually need a distinct title from the
  // app-wide default set in index.html. The static <meta name="description">
  // and Open Graph tags in index.html already describe this route (it's the
  // root/default page a crawler sees, since there's no server-side
  // rendering to vary them per-URL) — this just keeps the live DOM meta
  // description in sync with the title for anything that does render the
  // page (link-preview bots that execute JS, browser share sheets).
  useEffect(() => {
    document.title = t("landing.page_title")
    document.querySelector('meta[name="description"]')?.setAttribute("content", t("landing.hero_subtitle"))
  }, [t])

  return (
    <div className="min-h-svh bg-background">
      <InstallPrompt />
      <LandingHeader />
      <HeroSection />
      <ValuesSection />
      <FutureLetterSection />
      <QuoteSection />
      <LandingFooter />
    </div>
  )
}

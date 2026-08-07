import { useEffect } from "react"
import { useTranslation } from "react-i18next"
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
  // app-wide default set in index.html.
  useEffect(() => {
    document.title = t("landing.page_title")
  }, [t])

  return (
    <div className="min-h-svh bg-background">
      <InstallPrompt />
      <HeroSection />
      <ValuesSection />
      <FutureLetterSection />
      <QuoteSection />
      <LandingFooter />
    </div>
  )
}

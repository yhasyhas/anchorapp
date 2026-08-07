import { useTranslation } from "react-i18next"
import { useScrollReveal } from "@/hooks/use-scroll-reveal"

// Unattributed on purpose — a named/attributed testimonial here would misrepresent a
// real endorsement that doesn't exist. This reuses the app's own established voice
// ("Small steps still count" already lives on Home) rather than inventing a persona.
export function QuoteSection() {
  const { t } = useTranslation()
  const { ref, revealed } = useScrollReveal<HTMLDivElement>()

  return (
    <section className="px-6 py-16">
      <div
        ref={ref}
        className={`mx-auto max-w-lg text-center transition-all duration-700 ${
          revealed ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
        }`}
      >
        <p className="font-heading text-2xl italic leading-relaxed text-foreground/90 sm:text-3xl">
          &ldquo;{t("landing.quote_line")}&rdquo;
        </p>
        <p className="mt-4 text-sm text-muted-foreground">{t("landing.quote_attribution")}</p>
      </div>
    </section>
  )
}

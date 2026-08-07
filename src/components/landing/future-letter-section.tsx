import { useTranslation } from "react-i18next"
import { Mail } from "lucide-react"
import { useScrollReveal } from "@/hooks/use-scroll-reveal"

// The emotional centerpiece per the brief — a stylized envelope/paper preview, never
// implying it's a real stored letter (generic, unattributed opening line only).
export function FutureLetterSection() {
  const { t } = useTranslation()
  const { ref, revealed } = useScrollReveal<HTMLDivElement>()

  return (
    <section className="bg-sage-light/40 px-6 py-16">
      <div
        ref={ref}
        className={`mx-auto max-w-md text-center transition-all duration-700 ${
          revealed ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
        }`}
      >
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-card shadow-[0_2px_10px_rgba(0,0,0,0.06)]">
          <Mail className="h-5 w-5 text-primary" />
        </div>
        <h2 className="font-heading text-2xl font-semibold text-foreground">{t("landing.letter_title")}</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("landing.letter_subtitle")}</p>

        <div className="mx-auto mt-8 max-w-sm -rotate-1 rounded-lg bg-card p-6 text-left shadow-[0_10px_30px_rgba(0,0,0,0.1)]">
          <p className="font-heading text-base italic leading-relaxed text-foreground/90">
            {t("landing.letter_preview_line")}
          </p>
          <p className="mt-4 text-right text-xs text-muted-foreground">{t("landing.letter_preview_signoff")}</p>
        </div>
      </div>
    </section>
  )
}

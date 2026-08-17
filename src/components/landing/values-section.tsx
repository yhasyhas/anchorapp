import { useTranslation } from "react-i18next"
import { AppIcon, type AppIconSource } from "@/components/icons/app-icon"
import { Card, CardContent } from "@/components/ui/card"
import { useScrollReveal } from "@/hooks/use-scroll-reveal"

// Anchors (compass) / Jar / Letters / Circle, per anchor-web-spec.md section
// 5. Jar and Letters deliberately use the same "hub-*" icons as the sidebar
// and mobile hub (not "gratitude-jar"/"letter-sealed", which are similarly
// named but different traces — this file must stay in visual sync with
// WebSidebar/app-layout.tsx's icon choices, not just close by name).
// anchor-future has no such hub-* counterpart, it's already the single
// canonical "Anchors" icon.
const VALUES: { icon: AppIconSource; titleKey: string; descKey: string }[] = [
  { icon: "anchor-future", titleKey: "landing.value_anchors_title", descKey: "landing.value_anchors_desc" },
  { icon: "hub-jar", titleKey: "landing.value_jar_title", descKey: "landing.value_jar_desc" },
  { icon: "hub-letters", titleKey: "landing.value_letters_title", descKey: "landing.value_letters_desc" },
  { icon: "hub-circle", titleKey: "landing.value_circle_title", descKey: "landing.value_circle_desc" },
]

function ValueCard({ icon, titleKey, descKey, delayMs }: (typeof VALUES)[number] & { delayMs: number }) {
  const { t } = useTranslation()
  const { ref, revealed } = useScrollReveal<HTMLDivElement>()

  return (
    <div
      ref={ref}
      style={{ transitionDelay: revealed ? `${delayMs}ms` : "0ms" }}
      className={`transition-all duration-700 ${revealed ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}
    >
      <Card className="h-full border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="p-6 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-sage-light">
            <AppIcon icon={icon} size={24} decorative className="text-primary" />
          </div>
          <h3 className="font-heading text-lg font-semibold text-foreground">{t(titleKey)}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(descKey)}</p>
        </CardContent>
      </Card>
    </div>
  )
}

export function ValuesSection() {
  return (
    <section className="px-6 py-10">
      <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2 lg:max-w-5xl lg:grid-cols-4">
        {VALUES.map((value, i) => (
          <ValueCard key={value.titleKey} {...value} delayMs={i * 120} />
        ))}
      </div>
    </section>
  )
}

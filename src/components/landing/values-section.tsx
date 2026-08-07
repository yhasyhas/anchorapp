import { useTranslation } from "react-i18next"
import { Anchor, Mail, Heart } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { useScrollReveal } from "@/hooks/use-scroll-reveal"

const VALUES = [
  { icon: Anchor, titleKey: "landing.value_anchors_title", descKey: "landing.value_anchors_desc" },
  { icon: Mail, titleKey: "landing.value_seen_title", descKey: "landing.value_seen_desc" },
  { icon: Heart, titleKey: "landing.value_circle_title", descKey: "landing.value_circle_desc" },
] as const

function ValueCard({ icon: Icon, titleKey, descKey, delayMs }: (typeof VALUES)[number] & { delayMs: number }) {
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
            <Icon className="h-5 w-5 text-primary" />
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
      <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
        {VALUES.map((value, i) => (
          <ValueCard key={value.titleKey} {...value} delayMs={i * 120} />
        ))}
      </div>
    </section>
  )
}

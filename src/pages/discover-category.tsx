import { useEffect, useState } from "react"
import { useParams, Link, Navigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { CATEGORY_BRIDGE, DISCOVERY_BOARD_CATEGORIES, listThoughtsByCategory } from "@/lib/discovery-board"
import type { AweThought, AweThoughtCategory } from "@/types"

function isAweThoughtCategory(value: string | undefined): value is AweThoughtCategory {
  return !!value && (DISCOVERY_BOARD_CATEGORIES as string[]).includes(value)
}

// One category's bounded list (see MAX_THOUGHTS_PER_CATEGORY in
// discovery-board.ts — never a "load more", the whole point of the product
// guardrail this screen follows). Every card also suggests a related
// category to jump to next (CATEGORY_BRIDGE), the "bridges between
// categories" half of the board.
export function DiscoverCategoryPage() {
  const { t, i18n } = useTranslation()
  const lang: "en" | "sw" = i18n.language === "sw" ? "sw" : "en"
  const { category } = useParams<{ category: string }>()
  const [thoughts, setThoughts] = useState<AweThought[]>([])
  const [loading, setLoading] = useState(true)

  const validCategory = isAweThoughtCategory(category) ? category : null

  useEffect(() => {
    if (!validCategory) return
    let cancelled = false
    setLoading(true)
    listThoughtsByCategory(validCategory)
      .then((rows) => {
        if (!cancelled) setThoughts(rows)
      })
      .catch((err) => {
        console.error("Failed to load discovery board category:", err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [validCategory])

  if (!validCategory) return <Navigate to="/discover" replace />

  const bridgeCategory = CATEGORY_BRIDGE[validCategory]

  return (
    <div className="mx-auto max-w-lg space-y-6 lg:max-w-2xl lg:py-2">
      <Link
        to="/discover"
        className="flex items-center gap-1.5 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("discover.back_to_board")}
      </Link>

      <h1 className="font-heading text-2xl font-bold">{t(`awe.categories.${validCategory}`)}</h1>

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          {thoughts.map((thought) => (
            <Card key={thought.id} className="border-0 rounded-anchor-card-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
              <CardContent className="space-y-3 p-5">
                <p className="font-heading text-base italic leading-relaxed text-foreground/90">
                  {lang === "sw" ? thought.content_sw : thought.content_en}
                </p>
                {thought.source_note && <p className="text-[10px] text-muted-foreground">{thought.source_note}</p>}
                <Link
                  to={`/discover/${bridgeCategory}`}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary outline-none transition-colors hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {t("discover.bridge_cta", { category: t(`awe.categories.${bridgeCategory}`) })}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Brain, Leaf, Lightbulb, Palette, Rocket, Users, Sparkles, Loader2 } from "lucide-react"
import { AppIcon } from "@/components/icons/app-icon"
import { DISCOVERY_BOARD_CATEGORIES, listDiscoveryBoardCatalog } from "@/lib/discovery-board"
import type { AweThought, AweThoughtCategory } from "@/types"

// One icon per category, purely decorative — the tile's own text label is
// the real accessible name (see AppIcon's decorative prop below).
const CATEGORY_ICON: Record<AweThoughtCategory, typeof Brain> = {
  psychology: Brain,
  nature: Leaf,
  philosophy: Lightbulb,
  art: Palette,
  space: Rocket,
  people: Users,
}

// The Discovery Board's landing screen — 6 category tiles over the same
// awe_thoughts catalog Home's "Today's Awe" card draws one thought a day
// from (src/lib/awe-thought.ts, untouched by this screen). Reached from the
// Hub ("More" sheet), not a nav tab — see src/lib/discovery-board.ts.
export function DiscoverPage() {
  const { t } = useTranslation()
  const [catalog, setCatalog] = useState<AweThought[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    listDiscoveryBoardCatalog()
      .then((rows) => {
        if (!cancelled) setCatalog(rows)
      })
      .catch((err) => {
        console.error("Failed to load the discovery board catalog:", err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const countByCategory = new Map<AweThoughtCategory, number>()
  for (const thought of catalog) {
    countByCategory.set(thought.category, (countByCategory.get(thought.category) ?? 0) + 1)
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 lg:max-w-2xl lg:py-2">
      <div className="flex items-center gap-2">
        <Sparkles className="h-6 w-6 text-primary" aria-hidden="true" />
        <div>
          <h1 className="font-heading text-2xl font-bold">{t("discover.title")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("discover.subtitle")}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {DISCOVERY_BOARD_CATEGORIES.map((category) => {
            const count = countByCategory.get(category) ?? 0
            return (
              <Link
                key={category}
                to={`/discover/${category}`}
                className="flex flex-col items-center gap-2 rounded-anchor-card-lg border border-border bg-card p-5 text-center outline-none transition-colors hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <AppIcon icon={CATEGORY_ICON[category]} size={24} decorative className="text-foreground" />
                <span className="text-sm font-semibold text-foreground">{t(`awe.categories.${category}`)}</span>
                {count > 0 && (
                  <span className="text-xs text-muted-foreground">{t("discover.category_count", { count })}</span>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

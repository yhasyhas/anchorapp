import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Loader2 } from "lucide-react"
import { JarIcon } from "@/components/anchor/jar-icon"
import { GratitudeDropCard } from "@/components/anchor/gratitude-drop-card"
import { countGratitudes, listGratitudes } from "@/lib/gratitude"
import type { Gratitude } from "@/types"

const PAGE_SIZE = 20

function formatDate(dateStr: string, lang: string): string {
  return new Date(dateStr).toLocaleDateString(lang === "sw" ? "sw-TZ" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function JarPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const [count, setCount] = useState<number | null>(null)
  const [entries, setEntries] = useState<Gratitude[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  useEffect(() => {
    if (user) loadFirstPage()
  }, [user])

  async function loadFirstPage() {
    setLoading(true)
    try {
      const [total, firstPage] = await Promise.all([countGratitudes(), listGratitudes(PAGE_SIZE, 0)])
      setCount(total)
      setEntries(firstPage)
      setHasMore(firstPage.length < total)
    } catch (err) {
      console.error("Failed to load jar:", err)
    } finally {
      setLoading(false)
    }
  }

  async function loadMore() {
    if (loadingMore) return
    setLoadingMore(true)
    try {
      const next = await listGratitudes(PAGE_SIZE, entries.length)
      setEntries((prev) => [...prev, ...next])
      setHasMore(entries.length + next.length < (count ?? 0))
    } catch (err) {
      console.error("Failed to load more gratitudes:", err)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="flex items-center gap-2">
        <JarIcon className="h-6 w-6 text-primary" />
        <div>
          <h1 className="font-heading text-2xl font-bold">{t("jar.page_title")}</h1>
          {count !== null && count > 0 && (
            <p className="mt-0.5 text-sm text-muted-foreground">{t("jar.counter", { count })}</p>
          )}
        </div>
      </div>

      <GratitudeDropCard />

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : entries.length === 0 ? (
        <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <CardContent className="p-5">
            <EmptyState icon="seedling" titleKey="jar.empty_title" descriptionKey="jar.empty_desc" />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            {entries.map((g) => (
              <Card key={g.id} className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                <CardContent className="p-4">
                  <p className="text-sm text-foreground">{g.text}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatDate(g.created_at, i18n.language)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          {hasMore && (
            <Button variant="outline" className="w-full" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : t("jar.load_more")}
            </Button>
          )}
        </>
      )}
    </div>
  )
}

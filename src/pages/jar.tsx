import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useAuth } from "@/lib/auth-context"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Loader2, Trash2 } from "lucide-react"
import { AppIcon } from "@/components/icons/app-icon"
import { GratitudeDropCard } from "@/components/anchor/gratitude-drop-card"
import { countGratitudes, listGratitudes, deleteGratitude } from "@/lib/gratitude"
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
  const [deletingId, setDeletingId] = useState<string | null>(null)

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

  // Direct delete, no confirmation dialog — same low-friction pattern
  // src/pages/checkin.tsx already uses for deleting a voice note, rather
  // than the heavier email-confirmation flow reserved for account deletion.
  async function handleDelete(id: string) {
    if (deletingId) return
    setDeletingId(id)
    try {
      await deleteGratitude(id)
      setEntries((prev) => prev.filter((e) => e.id !== id))
      setCount((prev) => (prev !== null ? prev - 1 : prev))
      toast.success(t("jar.delete_success"))
    } catch (err) {
      console.error("Failed to delete gratitude:", err)
      toast.error(t("jar.delete_error"))
    } finally {
      setDeletingId(null)
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
    <div className="mx-auto max-w-lg space-y-6 lg:max-w-2xl lg:py-2">
      <div className="flex items-center gap-2">
        <AppIcon icon="hub-jar" decorative className="text-primary" />
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
        <Card className="border-0 rounded-anchor-card-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <CardContent className="p-5">
            <EmptyState icon="empty-jar" titleKey="jar.empty_title" descriptionKey="jar.empty_desc" />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            {entries.map((g) => (
              <Card key={g.id} className="border-0 rounded-anchor-card-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                <CardContent className="flex items-start gap-2 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{g.text}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{formatDate(g.created_at, i18n.language)}</p>
                  </div>
                  <button
                    onClick={() => handleDelete(g.id)}
                    disabled={deletingId === g.id}
                    aria-label={t("jar.delete_entry")}
                    className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  >
                    {deletingId === g.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
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

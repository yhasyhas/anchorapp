import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Loader2, Moon, Pencil } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import {
  EMPTY_REFLECTION_DRAFT,
  MAX_REFLECTION_FIELD_LENGTH,
  getReflectionHistory,
  reflectionToDraft,
  saveReflection,
  type ReflectionDraft,
} from "@/lib/reflection"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/ui/empty-state"
import type { Reflection } from "@/types"

function dateLabel(date: string, lang: string): string {
  const locale = lang === "sw" ? "sw-TZ" : "en-US"
  return new Date(`${date}T00:00:00`).toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

// A simple by-date list of past reflections, reachable from the Hub —
// consult and edit, no pagination/search per spec: one entry expands into
// the same 3-field editor at a time (editingId), the rest stay read-only.
export function ReflectionsHistoryPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const [reflections, setReflections] = useState<Reflection[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ReflectionDraft>(EMPTY_REFLECTION_DRAFT)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (user) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function load() {
    if (!user) return
    try {
      const rows = await getReflectionHistory(user.id)
      setReflections(rows)
    } catch (err) {
      console.error("Failed to load reflection history:", err)
      toast.error(t("reflection.history_error_load"))
    } finally {
      setLoading(false)
    }
  }

  function startEditing(r: Reflection) {
    setEditingId(r.id)
    setDraft(reflectionToDraft(r))
  }

  async function handleSaveEntry(r: Reflection) {
    if (!user || saving) return
    setSaving(true)
    try {
      const saved = await saveReflection(user.id, r.date, draft)
      setReflections((prev) => prev.map((x) => (x.id === r.id ? saved : x)))
      setEditingId(null)
    } catch (err) {
      console.error("Failed to save reflection:", err)
      toast.error(t("reflection.error_save"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 lg:max-w-2xl lg:py-2">
      <div className="flex items-center gap-2">
        <Moon className="h-5 w-5 text-primary" />
        <div>
          <h1 className="font-heading text-2xl font-bold">{t("reflection.history_title")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("reflection.history_subtitle")}</p>
        </div>
      </div>

      {loading ? (
        <Card className="border-0 rounded-anchor-card-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <CardContent className="p-5">
            <div className="flex items-center justify-center gap-2 py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{t("reflection.loading")}</span>
            </div>
          </CardContent>
        </Card>
      ) : reflections.length > 0 ? (
        <div className="space-y-3">
          {reflections.map((r) => {
            const editing = editingId === r.id
            return (
              <Card key={r.id} className="border-0 rounded-anchor-card-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {dateLabel(r.date, i18n.language)}
                    </p>
                    {!editing && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => startEditing(r)}
                        className="gap-1.5 text-xs text-muted-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {t("reflection.edit")}
                      </Button>
                    )}
                  </div>

                  {editing ? (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label className="text-sm font-normal text-foreground">
                          {t("reflection.meaningful_label")}
                        </Label>
                        <Textarea
                          value={draft.meaningful_today}
                          onChange={(e) => setDraft((d) => ({ ...d, meaningful_today: e.target.value }))}
                          placeholder={t("reflection.meaningful_placeholder")}
                          maxLength={MAX_REFLECTION_FIELD_LENGTH}
                          rows={2}
                          className="rounded-anchor-input placeholder:font-heading placeholder:italic"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm font-normal text-foreground">
                          {t("reflection.learned_label")}
                        </Label>
                        <Textarea
                          value={draft.learned_today}
                          onChange={(e) => setDraft((d) => ({ ...d, learned_today: e.target.value }))}
                          placeholder={t("reflection.learned_placeholder")}
                          maxLength={MAX_REFLECTION_FIELD_LENGTH}
                          rows={2}
                          className="rounded-anchor-input placeholder:font-heading placeholder:italic"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm font-normal text-foreground">
                          {t("reflection.better_label")}
                        </Label>
                        <Textarea
                          value={draft.better_tomorrow}
                          onChange={(e) => setDraft((d) => ({ ...d, better_tomorrow: e.target.value }))}
                          placeholder={t("reflection.better_placeholder")}
                          maxLength={MAX_REFLECTION_FIELD_LENGTH}
                          rows={2}
                          className="rounded-anchor-input placeholder:font-heading placeholder:italic"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingId(null)}
                          disabled={saving}
                          className="text-muted-foreground"
                        >
                          {t("reflection.cancel")}
                        </Button>
                        <Button size="sm" onClick={() => handleSaveEntry(r)} disabled={saving} className="flex-1">
                          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("reflection.save")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <div>
                        <p className="text-xs text-muted-foreground">{t("reflection.meaningful_label")}</p>
                        <p className="text-sm text-foreground/90">{r.meaningful_today || "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{t("reflection.learned_label")}</p>
                        <p className="text-sm text-foreground/90">{r.learned_today || "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{t("reflection.better_label")}</p>
                        <p className="text-sm text-foreground/90">{r.better_tomorrow || "—"}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : (
        <Card className="border-0 rounded-anchor-card-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <CardContent className="p-5">
            <EmptyState icon="moon" titleKey="reflection.history_empty" descriptionKey="reflection.history_empty_sub" />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

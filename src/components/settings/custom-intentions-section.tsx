import { useEffect, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Sparkles, Loader2, Pencil, Check, X } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  listCustomIntentions,
  createCustomIntention,
  updateCustomIntentionLabels,
  archiveCustomIntention,
  CustomIntentionValidationError,
  MAX_ACTIVE_CUSTOM_INTENTIONS,
} from "@/lib/custom-intentions"
import type { CustomIntention } from "@/types"

const VALIDATION_ERROR_KEY: Record<string, string> = {
  empty: "settings.custom_intentions_error_empty",
  too_long: "settings.custom_intentions_error_too_long",
  max_reached: "settings.custom_intentions_max_reached",
}

export function CustomIntentionsSection() {
  const { t, i18n } = useTranslation()
  const { user, profile } = useAuth()
  const language: "en" | "sw" = i18n.language === "sw" ? "sw" : "en"
  const aiEnabled = profile?.ai_enabled ?? false

  const [customIntentions, setCustomIntentions] = useState<CustomIntention[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState("")
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editEn, setEditEn] = useState("")
  const [editSw, setEditSw] = useState("")

  useEffect(() => {
    if (user) load()
  }, [user])

  async function load() {
    if (!user) return
    try {
      const data = await listCustomIntentions(user.id)
      setCustomIntentions(data)
    } catch (err) {
      console.error("Failed to load custom intentions:", err)
    } finally {
      setLoading(false)
    }
  }

  function reportError(err: unknown) {
    const code = err instanceof CustomIntentionValidationError ? err.message : "generic"
    toast.error(t(VALIDATION_ERROR_KEY[code] ?? "settings.custom_intentions_error_generic"))
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!user || !text.trim() || creating) return
    setCreating(true)
    try {
      await createCustomIntention(user.id, text, language, aiEnabled)
      setText("")
      toast.success(t("settings.custom_intentions_create_success"))
      await load()
    } catch (err) {
      reportError(err)
    } finally {
      setCreating(false)
    }
  }

  async function handleArchive(id: string) {
    setBusyId(id)
    try {
      await archiveCustomIntention(id)
      toast.success(t("settings.custom_intentions_archive_success"))
      await load()
    } catch (err) {
      reportError(err)
    } finally {
      setBusyId(null)
    }
  }

  function startEdit(intention: CustomIntention) {
    setEditingId(intention.id)
    setEditEn(intention.label_en)
    setEditSw(intention.label_sw)
  }

  async function handleSaveEdit(id: string) {
    setBusyId(id)
    try {
      await updateCustomIntentionLabels(id, { label_en: editEn, label_sw: editSw })
      toast.success(t("settings.custom_intentions_edit_success"))
      setEditingId(null)
      await load()
    } catch (err) {
      reportError(err)
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return null

  const atMax = customIntentions.length >= MAX_ACTIVE_CUSTOM_INTENTIONS

  return (
    <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">{t("settings.custom_intentions_title")}</p>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{t("settings.custom_intentions_subtitle")}</p>

        {customIntentions.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("settings.custom_intentions_empty")}</p>
        ) : (
          <ul className="space-y-2">
            {customIntentions.map((intention) => (
              <li key={intention.id} className="rounded-lg bg-muted/40 px-3 py-2">
                {editingId === intention.id ? (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label htmlFor={`edit-en-${intention.id}`} className="text-xs text-muted-foreground">
                        {t("settings.custom_intentions_label_en")}
                      </Label>
                      <Input
                        id={`edit-en-${intention.id}`}
                        value={editEn}
                        onChange={(e) => setEditEn(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`edit-sw-${intention.id}`} className="text-xs text-muted-foreground">
                        {t("settings.custom_intentions_label_sw")}
                      </Label>
                      <Input
                        id={`edit-sw-${intention.id}`}
                        value={editSw}
                        onChange={(e) => setEditSw(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleSaveEdit(intention.id)} disabled={busyId === intention.id}>
                        {busyId === intention.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                        {t("settings.custom_intentions_save_button")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                        <X className="h-4 w-4" />
                        {t("settings.custom_intentions_cancel_button")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-foreground">
                      ✨ {language === "sw" ? intention.label_sw : intention.label_en}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => startEdit(intention)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleArchive(intention.id)}
                        disabled={busyId === intention.id}
                      >
                        {t("settings.custom_intentions_archive_button")}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {atMax ? (
          <p className="text-xs text-muted-foreground">{t("settings.custom_intentions_max_reached")}</p>
        ) : (
          <form onSubmit={handleCreate} className="flex gap-2">
            <Input
              placeholder={t("settings.custom_intentions_placeholder")}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={30}
              required
            />
            <Button type="submit" size="sm" disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : t("settings.custom_intentions_add_button")}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

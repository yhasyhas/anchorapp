import { useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Check, Loader2, Plus, Trash2 } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { AppIcon } from "@/components/icons/app-icon"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  COMPASS_VALUES,
  MAX_VISION_LENGTH,
  MAX_GOAL_LENGTH,
  MAX_FUTURE_SELF_LENGTH,
  EMPTY_COMPASS_DRAFT,
  compassToDraft,
  getCompass,
  saveCompass,
  newGoal,
  type CompassDraft,
} from "@/lib/compass"
import type { Compass } from "@/types"

export function CompassPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // Reached straight from the onboarding invitation (vs. opened later from
  // the hub / Settings to edit) — changes the intro copy and sends the user
  // on to Home after the first save instead of leaving them on this screen.
  const fromOnboarding = params.get("start") === "1"

  const [compass, setCompass] = useState<Compass | null>(null)
  const [draft, setDraft] = useState<CompassDraft>(EMPTY_COMPASS_DRAFT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    getCompass(user.id)
      .then((row) => {
        if (cancelled) return
        setCompass(row)
        setDraft(compassToDraft(row))
      })
      .catch((err) => {
        console.error("Failed to load compass:", err)
        toast.error(t("compass.load_error"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user, t])

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(compassToDraft(compass)),
    [draft, compass]
  )

  function toggleValue(value: string) {
    setDraft((d) => ({
      ...d,
      value_tags: d.value_tags.includes(value)
        ? d.value_tags.filter((v) => v !== value)
        : [...d.value_tags, value],
    }))
  }

  function addGoal() {
    setDraft((d) => ({ ...d, goals: [...d.goals, newGoal("")] }))
  }

  function updateGoal(id: string, text: string) {
    setDraft((d) => ({
      ...d,
      goals: d.goals.map((g) => (g.id === id ? { ...g, text } : g)),
    }))
  }

  function removeGoal(id: string) {
    setDraft((d) => ({ ...d, goals: d.goals.filter((g) => g.id !== id) }))
  }

  async function handleSave() {
    if (!user || saving) return
    setSaving(true)
    try {
      const saved = await saveCompass(user.id, draft)
      setCompass(saved)
      setDraft(compassToDraft(saved))
      if (fromOnboarding) {
        toast.success(t("compass.save_success"))
        navigate("/", { replace: true })
        return
      }
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 2000)
    } catch (err) {
      console.error("Failed to save compass:", err)
      toast.error(t("compass.save_error"))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 lg:max-w-2xl lg:py-2">
      <div className="flex items-center gap-2">
        <AppIcon icon="hub-compass" decorative className="text-primary" />
        <div>
          <h1 className="font-heading text-2xl font-bold">{t("compass.page_title")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {fromOnboarding ? t("compass.onboarding_subtitle") : t("compass.page_subtitle")}
          </p>
        </div>
      </div>

      {/* Values */}
      <Card className="border-0 rounded-anchor-card-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="space-y-3 p-5">
          <div>
            <h2 id="compass-values-title" className="font-heading text-lg font-semibold">
              {t("compass.values_title")}
            </h2>
            <p id="compass-values-help" className="mt-1 text-sm text-muted-foreground">
              {t("compass.values_prompt")}
            </p>
          </div>
          <div
            role="group"
            aria-labelledby="compass-values-title"
            aria-describedby="compass-values-help"
            className="flex flex-wrap gap-2"
          >
            {COMPASS_VALUES.map((value) => {
              const selected = draft.value_tags.includes(value)
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleValue(value)}
                  className={`min-h-11 rounded-full px-4 py-1.5 text-sm outline-none transition-all duration-200 focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                    selected
                      ? "bg-primary text-primary-foreground shadow-md"
                      : "bg-muted text-foreground hover:bg-accent"
                  }`}
                >
                  {t(`compass.values.${value.toLowerCase()}`)}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Vision */}
      <Card className="border-0 rounded-anchor-card-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="space-y-3 p-5">
          <h2 className="font-heading text-lg font-semibold">{t("compass.vision_title")}</h2>
          <Label htmlFor="compass-vision" className="text-sm font-normal text-muted-foreground">
            {t("compass.vision_prompt")}
          </Label>
          <Textarea
            id="compass-vision"
            value={draft.vision}
            onChange={(e) => setDraft((d) => ({ ...d, vision: e.target.value }))}
            maxLength={MAX_VISION_LENGTH}
            rows={4}
            className="rounded-anchor-input"
          />
        </CardContent>
      </Card>

      {/* Goals */}
      <Card className="border-0 rounded-anchor-card-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="space-y-3 p-5">
          <div>
            <h2 className="font-heading text-lg font-semibold">{t("compass.goals_title")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("compass.goals_prompt")}</p>
          </div>

          {draft.goals.length > 0 && (
            <ul className="space-y-2">
              {draft.goals.map((goal, i) => (
                <li key={goal.id} className="flex items-center gap-2">
                  <Label htmlFor={`compass-goal-${goal.id}`} className="sr-only">
                    {t("compass.goal_label", { n: i + 1 })}
                  </Label>
                  <Input
                    id={`compass-goal-${goal.id}`}
                    value={goal.text}
                    onChange={(e) => updateGoal(goal.id, e.target.value)}
                    maxLength={MAX_GOAL_LENGTH}
                    placeholder={t("compass.goal_placeholder")}
                    className="rounded-anchor-input"
                  />
                  <button
                    type="button"
                    onClick={() => removeGoal(goal.id)}
                    aria-label={t("compass.goal_remove", { n: i + 1 })}
                    className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <Button type="button" variant="outline" onClick={addGoal} className="w-full gap-1.5">
            <Plus className="h-4 w-4" />
            {t("compass.goal_add")}
          </Button>
        </CardContent>
      </Card>

      {/* Future self */}
      <Card className="border-0 rounded-anchor-card-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="space-y-3 p-5">
          <h2 className="font-heading text-lg font-semibold">{t("compass.future_self_title")}</h2>
          <Label htmlFor="compass-future-self" className="text-sm font-normal text-muted-foreground">
            {t("compass.future_self_prompt")}
          </Label>
          <Textarea
            id="compass-future-self"
            value={draft.future_self}
            onChange={(e) => setDraft((d) => ({ ...d, future_self: e.target.value }))}
            maxLength={MAX_FUTURE_SELF_LENGTH}
            rows={3}
            className="rounded-anchor-input"
          />
        </CardContent>
      </Card>

      <div className="space-y-2">
        <Button
          onClick={handleSave}
          disabled={saving || (!dirty && !justSaved)}
          className="min-h-12 w-full rounded-anchor-card-lg"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : justSaved ? (
            <span className="flex items-center gap-1.5">
              <Check className="h-4 w-4" /> {t("compass.saved")}
            </span>
          ) : (
            t("compass.save")
          )}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          {fromOnboarding ? t("compass.onboarding_hint") : t("compass.edit_hint")}
        </p>
      </div>
    </div>
  )
}

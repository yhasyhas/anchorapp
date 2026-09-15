import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Check, Loader2 } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { todayStr } from "@/lib/utils"
import {
  EMPTY_REFLECTION_DRAFT,
  MAX_REFLECTION_FIELD_LENGTH,
  getReflection,
  reflectionToDraft,
  saveReflection,
  type ReflectionDraft,
} from "@/lib/reflection"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { Reflection } from "@/types"

interface ReflectionCardProps {
  // Today's evening mood, if the check-in has set one — drives the small
  // contextual reminder above the 3 questions. Null/empty hides it.
  mood: string | null
  // Gate: the whole card renders nothing until today's regular check-in has
  // actually been saved (see checkin.tsx) — Reflection is offered AFTER the
  // usual check-in, never before it and never as an extra required step.
  hasCheckedInToday: boolean
}

type Stage = "loading" | "offer" | "form" | "hidden"

// Session-scoped, not persisted server-side: declining just hides the offer
// for the rest of this browser session (per spec), reappearing next session
// (or tomorrow, when the date-scoped key changes anyway) rather than forever.
function skipKey(userId: string, date: string) {
  return `anchor_reflection_skip_${userId}_${date}`
}

// The optional, deeper evening reflection (3 questions) offered once the
// regular check-in is done — additive, never a required extra step. Self-
// contained fetch/save like JournalCard/GratitudeDropCard: checkin.tsx just
// mounts it and passes today's mood + whether the check-in is done.
export function ReflectionCard({ mood, hasCheckedInToday }: ReflectionCardProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [stage, setStage] = useState<Stage>("loading")
  const [reflection, setReflection] = useState<Reflection | null>(null)
  const [draft, setDraft] = useState<ReflectionDraft>(EMPTY_REFLECTION_DRAFT)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    if (!user || !hasCheckedInToday) return
    let cancelled = false
    getReflection(user.id, todayStr())
      .then((row) => {
        if (cancelled) return
        setReflection(row)
        setDraft(reflectionToDraft(row))
        if (row) {
          // Already answered "yes" (and saved) today — go straight back to
          // the form, prefilled, no need to ask again.
          setStage("form")
          return
        }
        let skipped = false
        try {
          skipped = sessionStorage.getItem(skipKey(user.id, todayStr())) === "1"
        } catch {
          // Storage unavailable (private mode, etc.) — fail toward always
          // offering rather than always hiding.
        }
        setStage(skipped ? "hidden" : "offer")
      })
      .catch((err) => {
        console.error("Failed to load reflection:", err)
        setStage("hidden")
      })
    return () => {
      cancelled = true
    }
  }, [user, hasCheckedInToday])

  function handleSkip() {
    if (user) {
      try {
        sessionStorage.setItem(skipKey(user.id, todayStr()), "1")
      } catch {
        // Best-effort — worst case the offer just reappears.
      }
    }
    setStage("hidden")
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(reflectionToDraft(reflection))

  async function handleSave() {
    if (!user || saving) return
    setSaving(true)
    try {
      const saved = await saveReflection(user.id, todayStr(), draft)
      setReflection(saved)
      setDraft(reflectionToDraft(saved))
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 2000)
    } catch (err) {
      console.error("Failed to save reflection:", err)
      toast.error(t("reflection.error_save"))
    } finally {
      setSaving(false)
    }
  }

  if (!hasCheckedInToday || stage === "loading" || stage === "hidden") return null

  if (stage === "offer") {
    return (
      <Card className="border-0 rounded-anchor-card-lg bg-secondary shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="space-y-4 p-5">
          <p className="font-heading text-sm italic leading-snug text-foreground/90">
            {t("reflection.offer_question")}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button variant="outline" className="min-h-11 bg-card" onClick={() => setStage("form")}>
              {t("reflection.offer_yes")}
            </Button>
            <Button variant="outline" className="min-h-11 bg-card" onClick={handleSkip}>
              {t("reflection.offer_no")}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-0 rounded-anchor-card-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <CardContent className="space-y-4 p-5">
        <div>
          <p className="font-heading text-base font-semibold text-foreground">{t("reflection.title")}</p>
          {mood && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("reflection.mood_reminder", { mood: t(`mood.${mood}`) })}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="reflection-meaningful" className="text-sm font-normal text-foreground">
            {t("reflection.meaningful_label")}
          </Label>
          <Textarea
            id="reflection-meaningful"
            value={draft.meaningful_today}
            onChange={(e) => setDraft((d) => ({ ...d, meaningful_today: e.target.value }))}
            placeholder={t("reflection.meaningful_placeholder")}
            maxLength={MAX_REFLECTION_FIELD_LENGTH}
            rows={2}
            className="rounded-anchor-input placeholder:font-heading placeholder:italic"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="reflection-learned" className="text-sm font-normal text-foreground">
            {t("reflection.learned_label")}
          </Label>
          <Textarea
            id="reflection-learned"
            value={draft.learned_today}
            onChange={(e) => setDraft((d) => ({ ...d, learned_today: e.target.value }))}
            placeholder={t("reflection.learned_placeholder")}
            maxLength={MAX_REFLECTION_FIELD_LENGTH}
            rows={2}
            className="rounded-anchor-input placeholder:font-heading placeholder:italic"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="reflection-better" className="text-sm font-normal text-foreground">
            {t("reflection.better_label")}
          </Label>
          <Textarea
            id="reflection-better"
            value={draft.better_tomorrow}
            onChange={(e) => setDraft((d) => ({ ...d, better_tomorrow: e.target.value }))}
            placeholder={t("reflection.better_placeholder")}
            maxLength={MAX_REFLECTION_FIELD_LENGTH}
            rows={2}
            className="rounded-anchor-input placeholder:font-heading placeholder:italic"
          />
        </div>

        <Button onClick={handleSave} disabled={saving || (!dirty && !justSaved)} className="min-h-11 w-full">
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : justSaved ? (
            <span className="flex items-center gap-1.5">
              <Check className="h-4 w-4" /> {t("reflection.saved")}
            </span>
          ) : (
            t("reflection.save")
          )}
        </Button>
      </CardContent>
    </Card>
  )
}

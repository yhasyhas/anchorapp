import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { X } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import {
  acknowledgeObservation,
  fetchPendingObservations,
  markCompanionObservationShown,
  respondToObservation,
} from "@/lib/companion-observations"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import type { CompanionObservation } from "@/types"

export interface CompanionPanelProps {
  open: boolean
  onClose: () => void
  // Forwarded straight to SheetContent, same reason as HubModal — see
  // use-dialog-focus-restore.ts.
  onCloseAutoFocus?: (event: Event) => void
}

// weekly_checkin is excluded upstream (fetchPendingObservations) and never
// reaches this map — listed anyway so the Record stays exhaustive over
// CompanionObservationType without a cast.
const TYPE_LABEL_KEY: Record<CompanionObservation["type"], string> = {
  pattern: "companion_panel.type_pattern",
  gap: "companion_panel.type_gap",
  celebration: "companion_panel.type_celebration",
  first_time: "companion_panel.type_first_time",
  weekly_checkin: "companion_panel.type_pattern",
}

// The Companion's own entry point (anchor-companion-design.md section 4/8):
// a bottom sheet listing observations still waiting to be shown
// (shown_at IS NULL, generated_text already filled — see
// companion-observations.ts), most recent first. Each card is stamped shown
// the moment it actually mounts here, not at fetch time — this is a
// one-shot surface, never re-shown once seen, so marking early would burn
// it before there's anything on screen. Stays open and consultable even
// with nothing pending (a soft empty state, not a dead end) — same Sheet +
// useDialogFocusRestore pairing as HubModal/MovePickerSheet.
export function CompanionPanel({ open, onClose, onCloseAutoFocus }: CompanionPanelProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [observations, setObservations] = useState<CompanionObservation[]>([])
  const [loading, setLoading] = useState(true)
  // Persists across re-opens for this session — belt-and-suspenders against
  // marking the same row shown twice (e.g. a StrictMode double-effect on the
  // fetch below), on top of the row simply no longer matching the
  // shown_at-IS-NULL query once it's set server-side.
  const shownIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!open || !user) return
    let cancelled = false
    setLoading(true)
    fetchPendingObservations(user.id)
      .then((rows) => {
        if (cancelled) return
        setObservations(rows)
        setLoading(false)
        for (const row of rows) {
          if (shownIdsRef.current.has(row.id)) continue
          shownIdsRef.current.add(row.id)
          markCompanionObservationShown(row).catch((err) => {
            console.error("Failed to mark companion observation shown:", err)
          })
        }
      })
      .catch((err) => {
        console.error("Failed to load companion observations:", err)
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, user])

  function handleSettled(id: string) {
    setObservations((prev) => prev.filter((o) => o.id !== id))
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[80vh] overflow-y-auto rounded-t-anchor-modal"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <SheetHeader>
          <SheetTitle className="font-heading text-lg">{t("companion_panel.title")}</SheetTitle>
        </SheetHeader>
        <div className="space-y-3 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {!loading && observations.length === 0 && (
            <EmptyState icon="moon" titleKey="companion_panel.empty_title" descriptionKey="companion_panel.empty_desc" />
          )}
          {observations.map((observation) => (
            <CompanionObservationCard key={observation.id} observation={observation} onSettled={handleSettled} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}

interface CompanionObservationCardProps {
  observation: CompanionObservation
  onSettled: (id: string) => void
}

function CompanionObservationCard({ observation, onSettled }: CompanionObservationCardProps) {
  const { t } = useTranslation()

  function handleAcknowledge() {
    onSettled(observation.id)
    acknowledgeObservation(observation).catch((err) => {
      console.error("Failed to acknowledge companion observation:", err)
    })
  }

  function handleRespond(response: string) {
    onSettled(observation.id)
    respondToObservation(observation, response).catch((err) => {
      console.error("Failed to save companion observation response:", err)
    })
  }

  return (
    <Card className="border-0 rounded-anchor-card-lg bg-secondary shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t(TYPE_LABEL_KEY[observation.type])}
          </p>
          <button
            type="button"
            onClick={handleAcknowledge}
            aria-label={t("companion_panel.acknowledge")}
            className="-mr-1 -mt-1 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="font-heading text-sm italic leading-snug text-foreground/90">{observation.generated_text}</p>

        {observation.type === "gap" && (
          <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
            <Button variant="outline" className="min-h-11 bg-card" onClick={() => handleRespond("still_true")}>
              {t("companion_panel.gap_reply_still_true")}
            </Button>
            <Button variant="outline" className="min-h-11 bg-card" onClick={() => handleRespond("changed")}>
              {t("companion_panel.gap_reply_changed")}
            </Button>
          </div>
        )}

        {observation.type === "celebration" && (
          <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
            <Button variant="outline" className="min-h-11 bg-card" onClick={() => handleRespond("feels_good")}>
              {t("companion_panel.celebration_reply_good")}
            </Button>
            <Button variant="outline" className="min-h-11 bg-card" onClick={() => handleRespond("proud")}>
              {t("companion_panel.celebration_reply_proud")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

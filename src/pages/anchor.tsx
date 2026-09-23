import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowLeft, Loader2 } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { useDailyCycle } from "@/hooks/use-daily-cycle"
import { useAnchorDefs } from "@/hooks/use-anchor-defs"
import { useDailySuggestion } from "@/lib/daily-suggestion-context"
import { DailySuggestionCard } from "@/components/anchor/daily-suggestion-card"
import { PlanningAnchorCard, TrackingAnchorChip } from "@/components/anchor/anchor-cards"
import { AppIcon } from "@/components/icons/app-icon"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { DailySuggestion } from "@/types"

const noop = () => {}

function daysAgo(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number)
  const then = new Date(y, m - 1, d)
  then.setHours(0, 0, 0, 0)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.round((now.getTime() - then.getTime()) / 86400000)
}

function HistoryRow({ row }: { row: DailySuggestion }) {
  const { t } = useTranslation()
  const d = daysAgo(row.date)
  const when = d === 0 ? t("anchor_screen.today") : d === 1 ? t("anchor_screen.yesterday") : t("anchor_screen.days_ago", { count: d })

  const statusLabel =
    row.status === "accepted"
      ? t("anchor_screen.status_done")
      : row.status === "declined"
        ? t("anchor_screen.status_skipped")
        : t("anchor_screen.status_none")
  const statusClass =
    row.status === "accepted"
      ? "bg-primary/10 text-primary"
      : "bg-muted text-muted-foreground"

  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm text-foreground">{row.suggestion_text}</p>
        <p className="text-xs text-muted-foreground">{when}</p>
      </div>
      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClass}`}>{statusLabel}</span>
    </li>
  )
}

// Dedicated screen behind the Home suggestion card (tap the suggestion
// text). Same daily_suggestions row as Home — via DailySuggestionProvider —
// so a response given here shows on Home and vice versa. Below: the 3
// existing daily anchors (same components Home renders) and a plain 7-day
// history. Not a nav tab; reached only from Home.
export function AnchorPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const ds = useDailySuggestion()
  const cycle = useDailyCycle(user, profile, false, noop, noop)
  const { anchorDefs } = useAnchorDefs(cycle.anchor, cycle.saveAnchor)

  return (
    <div className="mx-auto max-w-lg space-y-6 lg:max-w-2xl lg:py-2">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")} aria-label={t("anchor_screen.back")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <AppIcon icon="move" decorative className="text-primary" />
          <div>
            <h1 className="font-heading text-2xl font-bold">{t("anchor_screen.title")}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("anchor_screen.subtitle")}</p>
          </div>
        </div>
      </div>

      {/* Today's suggestion — same data & actions as the Home card */}
      <section className="space-y-2">
        <h2 className="font-heading text-lg font-semibold">{t("anchor_screen.suggestion_intro")}</h2>
        {ds.loading && !ds.suggestion ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : ds.suggestion ? (
          <>
            <DailySuggestionCard
              text={ds.suggestion.suggestion_text}
              status={ds.suggestion.status}
              busy={ds.busy}
              onAccept={ds.accept}
              onDecline={ds.decline}
              onAnother={ds.another}
              selectionReason={ds.suggestion.selection_reason}
            />
            <p className="text-xs text-muted-foreground">{t("anchor_screen.suggestion_note")}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("anchor_screen.suggestion_none")}</p>
        )}
      </section>

      {/* The 3 daily anchors — same components Home uses */}
      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">{t("home.anchors_title")}</h2>
        {!cycle.anchorReady ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : cycle.dayMode === "tracking" ? (
          <div className="space-y-3">
            {anchorDefs.map((d) => (
              <TrackingAnchorChip key={d.key} def={d} lockedAt={cycle.anchor.anchors_locked_at} wide />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {anchorDefs.map((d) => (
              <PlanningAnchorCard
                key={d.key}
                borderColor={d.borderColor}
                icon={d.icon}
                title={d.title}
                subtitle={d.subtitle}
                task={d.task}
                onTaskChange={d.onTaskChange}
              />
            ))}
            <Button variant="outline" className="w-full" onClick={() => navigate("/")}>
              {t("anchor_screen.lock_on_home")}
            </Button>
          </div>
        )}
      </section>

      {/* Last 7 days of suggestions */}
      <section className="space-y-2">
        <h2 className="font-heading text-lg font-semibold">{t("anchor_screen.history_title")}</h2>
        <Card className="border-0 rounded-anchor-card-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <CardContent className="px-5 py-1">
            {ds.history.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">{t("anchor_screen.history_empty")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {ds.history.map((row) => (
                  <HistoryRow key={row.date} row={row} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

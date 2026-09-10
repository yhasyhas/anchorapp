import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { AppIcon, type AppIconSource } from "@/components/icons/app-icon"

export interface HubModalProps {
  open: boolean
  onClose: () => void
  // Forwarded straight to SheetContent — see use-dialog-focus-restore.ts
  // for why the caller needs this exact hook rather than restoring focus
  // itself from onClose.
  onCloseAutoFocus?: (event: Event) => void
  hasUnreadLetter: boolean
  hasPendingCircleInvite: boolean
  hasUnreadEncouragement: boolean
  lettersCount: number | null
  circleMemberCount: number | null
  jarCount: number | null
  wrappedLatestMonth: string | null
}

interface HubTile {
  to: string
  icon: AppIconSource
  labelKey: string
  status: string
  dot?: boolean
}

// The "More" hub for web mobile (<768px) — port of feature/capacitor-mobile's
// hub-modal.tsx: a 2x2 grid (Letters/Circle/Jar/Wrapped) + a Settings row
// below, replacing the old always-on top icon row in home.tsx. Status text
// per tile comes from the same hooks/queries the destination screens
// themselves use (see use-hub-status.ts) rather than new bespoke queries —
// and the unread badges that used to sit on the top icon row now surface
// here as dots + status text instead.
export function HubModal({
  open,
  onClose,
  onCloseAutoFocus,
  hasUnreadLetter,
  hasPendingCircleInvite,
  hasUnreadEncouragement,
  lettersCount,
  circleMemberCount,
  jarCount,
  wrappedLatestMonth,
}: HubModalProps) {
  const { t, i18n } = useTranslation()

  const lettersStatus = hasUnreadLetter
    ? t("hub.letters_status_new")
    : lettersCount
      ? t("hub.letters_status_count", { count: lettersCount })
      : t("hub.letters_status_empty")

  const circleStatus = circleMemberCount
    ? t("hub.circle_status_count", { count: circleMemberCount })
    : t("hub.circle_status_empty")

  const jarStatus = jarCount !== null ? t("hub.jar_status_count", { count: jarCount }) : ""

  const wrappedStatus = wrappedLatestMonth
    ? t("hub.wrapped_status_available", {
        month: new Date(`${wrappedLatestMonth}T00:00:00`).toLocaleDateString(
          i18n.language === "sw" ? "sw-TZ" : "en-US",
          { month: "long" }
        ),
      })
    : t("hub.wrapped_status_next")

  const tiles: HubTile[] = [
    { to: "/letters", icon: "hub-letters", labelKey: "hub.letters", status: lettersStatus, dot: hasUnreadLetter },
    { to: "/circle", icon: "hub-circle", labelKey: "hub.circle", status: circleStatus, dot: hasUnreadEncouragement },
    { to: "/jar", icon: "hub-jar", labelKey: "hub.jar", status: jarStatus },
    { to: "/wrapped", icon: "hub-wrapped", labelKey: "hub.wrapped", status: wrappedStatus },
  ]

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-anchor-modal" onCloseAutoFocus={onCloseAutoFocus}>
        <SheetHeader>
          <SheetTitle className="font-heading text-lg">{t("hub.title")}</SheetTitle>
        </SheetHeader>
        <div className="grid grid-cols-2 gap-3 px-4">
          {tiles.map((tile) => (
            <Link
              key={tile.to}
              to={tile.to}
              onClick={onClose}
              className="relative flex flex-col items-center gap-2 rounded-anchor-card-lg border border-border bg-card p-5 text-center transition-colors hover:bg-accent/40"
            >
              {tile.dot && (
                <span aria-hidden="true" className="absolute right-4 top-4 h-2 w-2 rounded-full bg-primary" />
              )}
              <AppIcon icon={tile.icon} size={24} decorative className="text-foreground" />
              <span className="text-sm font-semibold text-foreground">{t(tile.labelKey)}</span>
              <span className="text-xs text-muted-foreground">{tile.status}</span>
            </Link>
          ))}
        </div>
        <div className="space-y-2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {/* Compass + Settings kept as full-width rows below the 2x2 grid —
              both are set-once / edit-rarely foundations rather than content
              that accumulates like letters, gratitudes or recaps. */}
          <Link
            to="/compass"
            onClick={onClose}
            className="flex min-h-12 items-center gap-3 rounded-anchor-control-sm border border-border bg-card px-4 transition-colors hover:bg-accent/40"
          >
            <AppIcon icon="hub-compass" size={20} decorative className="text-foreground" />
            <span className="text-sm font-semibold text-foreground">{t("hub.compass")}</span>
          </Link>
          <Link
            to="/settings"
            onClick={onClose}
            className="relative flex min-h-12 items-center gap-3 rounded-anchor-control-sm border border-border bg-card px-4 transition-colors hover:bg-accent/40"
          >
            {hasPendingCircleInvite && (
              <span
                aria-hidden="true"
                className="absolute right-4 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-primary"
              />
            )}
            <AppIcon icon="hub-settings" size={20} decorative className="text-foreground" />
            <span className="text-sm font-semibold text-foreground">{t("hub.settings")}</span>
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  )
}

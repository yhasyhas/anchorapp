import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AppIcon } from "@/components/icons/app-icon"

export interface QuickAccessBarProps {
  hasUnreadLetter: boolean
  hasPendingCircleInvite: boolean
  hasUnreadEncouragement: boolean
}

// Extracted from src/pages/home.tsx's greeting header — Letters/Circle/
// Wrapped/Jar/Settings used to only be reachable from Home, so switching to
// Patterns/Check-in/Move meant backtracking Home first to reach any of them.
// Rendered once in AppLayout (persistent across every tab, same idea as the
// bottom nav) instead of duplicated per-page. Badge state comes from
// useHomeBadges, now called in AppLayout — this component stays purely
// presentational, same split as PlanningAnchorCard/useAnchorDefs.
export function QuickAccessBar({ hasUnreadLetter, hasPendingCircleInvite, hasUnreadEncouragement }: QuickAccessBarProps) {
  const { t } = useTranslation()

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Link to="/letters">
        <Button
          variant="ghost"
          size="icon"
          className="relative min-h-11 min-w-11 text-anchor-lavender/70 hover:text-anchor-lavender transition-colors"
          aria-label={t("letters.title")}
        >
          <AppIcon icon="letter-sealed" size={20} decorative />
          {hasUnreadLetter && (
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-anchor-orange" aria-hidden="true" />
          )}
        </Button>
      </Link>
      <Link to="/circle">
        <Button
          variant="ghost"
          size="icon"
          className="relative min-h-11 min-w-11 text-rose-accent/70 hover:text-rose-accent transition-colors"
          aria-label={t("circle.page_title")}
        >
          <AppIcon icon="circle-of-trust" size={20} decorative />
          {hasUnreadEncouragement && (
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-anchor-orange" aria-hidden="true" />
          )}
        </Button>
      </Link>
      <Link to="/wrapped">
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11 text-peach/80 hover:text-peach transition-colors"
          aria-label={t("wrapped.history_title")}
        >
          <AppIcon icon="wrapped" size={20} decorative />
        </Button>
      </Link>
      <Link to="/jar">
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11 text-anchor-green/70 hover:text-anchor-green transition-colors"
          aria-label={t("jar.page_title")}
        >
          <AppIcon icon="gratitude-jar" size={20} decorative />
        </Button>
      </Link>
      <Link to="/settings">
        <Button
          variant="ghost"
          size="icon"
          className="relative min-h-11 min-w-11 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={t("settings.title")}
        >
          <AppIcon icon={Settings} size={20} decorative />
          {hasPendingCircleInvite && (
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-anchor-orange" aria-hidden="true" />
          )}
        </Button>
      </Link>
    </div>
  )
}

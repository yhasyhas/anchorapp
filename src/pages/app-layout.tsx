import { Outlet, NavLink, Link, useLocation } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { CloudOff, RefreshCw } from "lucide-react"
import { Suspense, useEffect, useState } from "react"
import { Capacitor } from "@capacitor/core"
import { Network } from "@capacitor/network"
import { isOnline, processSyncQueue, getPendingSyncCount, SYNC_QUEUE_CHANGED_EVENT } from "@/lib/offline-sync"
import { useAuth } from "@/lib/auth-context"
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion"
import { useHomeBadges } from "@/hooks/use-home-badges"
import { useHubStatus } from "@/hooks/use-hub-status"
import { PauseModal, type PauseOption } from "@/components/anchor/pause-modal"
import { PauseBreathing } from "@/components/anchor/pause-breathing"
import { PauseFocusSession } from "@/components/anchor/pause-focus-session"
import { PauseRecenter } from "@/components/anchor/pause-recenter"
import { HubModal } from "@/components/anchor/hub-modal"
import { InstallPrompt } from "@/components/pwa/install-prompt"
import { Spinner } from "@/components/ui/spinner"
import { AppIcon, type SignatureIconName } from "@/components/icons/app-icon"

// Order + icons per anchor-redesign-spec.md section 4: 5 labeled items,
// Home / Check-in / Patterns / Move / More (More isn't a route — it opens
// the hub sheet below instead of a NavLink, so it's rendered separately).
const navItems: { path: string; icon: SignatureIconName; labelKey: string }[] = [
  { path: "/", icon: "nav-home", labelKey: "home.title" },
  { path: "/checkin", icon: "nav-checkin", labelKey: "checkin.title" },
  { path: "/patterns", icon: "nav-patterns", labelKey: "patterns.title" },
  { path: "/move", icon: "nav-move", labelKey: "move.title" },
]

// Spec section 3's inactive-nav color is a dedicated hex distinct from the
// --muted-foreground token (which serves a broader "secondary text" role) —
// kept as a one-off arbitrary value here rather than a new global token.
const NAV_INACTIVE = "text-[#B0968A]"

export function AppLayout() {
  const { t } = useTranslation()
  const { user, profile } = useAuth()
  const location = useLocation()
  const prefersReducedMotion = usePrefersReducedMotion()
  const [online, setOnline] = useState(isOnline())
  const [showPauseMenu, setShowPauseMenu] = useState(false)
  const [activePause, setActivePause] = useState<PauseOption | null>(null)
  const [showHubModal, setShowHubModal] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [retrying, setRetrying] = useState(false)

  // Letters/Circle/Wrapped/Jar/Settings — was Home-only before (home.tsx's
  // greeting header), meaning switching to Patterns/Check-in/Move meant
  // backtracking through Home to reach any of them. Now reachable from every
  // tab via the "More" hub sheet below. refreshKey (route pathname) keeps
  // badge freshness AppLayout never had before, since unlike HomePage it
  // never unmounts between navigations — see use-home-badges.ts.
  const { hasUnreadLetter, hasPendingCircleInvite, hasUnreadEncouragement } = useHomeBadges(
    user,
    profile,
    location.pathname
  )
  const hubStatus = useHubStatus(user, location.pathname)
  const hubHasNotification = hasUnreadLetter || hasPendingCircleInvite || hasUnreadEncouragement

  useEffect(() => {
    if (!user) return
    const refreshPendingCount = () => setPendingCount(getPendingSyncCount(user.id))
    refreshPendingCount()
    window.addEventListener(SYNC_QUEUE_CHANGED_EVENT, refreshPendingCount)
    return () => window.removeEventListener(SYNC_QUEUE_CHANGED_EVENT, refreshPendingCount)
  }, [user])

  useEffect(() => {
    if (!user) return
    const listener = Network.addListener("networkStatusChange", (status) => {
      setOnline(status.connected)
      if (status.connected) processSyncQueue(user.id)
    })
    return () => {
      listener.then((handle) => handle.remove())
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    processSyncQueue(user.id)
  }, [location, user])

  // Manual retry — for when a device comes back online but processSyncQueue's
  // automatic pass (on the 'online' event / route change) already ran and
  // still left items behind (e.g. a transient server error), so she isn't
  // stuck waiting for another route change to try again.
  async function handleRetrySync() {
    if (!user || retrying) return
    setRetrying(true)
    try {
      await processSyncQueue(user.id)
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col bg-background">
      {/* Install-to-homescreen nudge only makes sense for the PWA — the
          native app is already "installed" once it's on the device. */}
      {!Capacitor.isNativePlatform() && <InstallPrompt />}

      {/* Offline / pending-sync banner - Style doux */}
      {(!online || pendingCount > 0) && (
        <div className="flex items-center justify-center gap-2 bg-lavender/40 px-4 py-2.5 text-center backdrop-blur-sm animate-in slide-in-from-top">
          <CloudOff className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm text-muted-foreground font-medium">
            {!online
              ? pendingCount > 0
                ? t("offline.banner_with_pending", { count: pendingCount })
                : t("offline.banner")
              : t("offline.pending_sync", { count: pendingCount })}
          </span>
          {online && pendingCount > 0 && (
            <button
              onClick={handleRetrySync}
              disabled={retrying}
              className="flex shrink-0 items-center gap-1 text-sm font-semibold text-primary underline underline-offset-4 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`} />
              {retrying ? t("offline.retrying") : t("offline.retry")}
            </button>
          )}
        </div>
      )}

      {/* Contextual header — anchor-redesign-spec.md section 4: the old
          always-on Letters/Circle/Wrapped/Jar/Settings row is gone (those 4
          now live in the "More" hub sheet below); only Settings persists
          here, alone, on every screen. Each page's own in-body title is
          left as-is for now (see CLAUDE.md's Design system note) — folding
          it into this header is scoped to that page's own redesign phase,
          not this nav pass, to avoid a doubled-up title until then. Sits in
          normal flow above <main> (not fixed) — same technique the offline
          banner above already uses to stay visible without scrolling away. */}
      <div
        className="mx-auto flex w-full max-w-lg shrink-0 justify-end px-4"
        style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}
      >
        <Link
          to="/settings"
          aria-label={t("settings.title")}
          className="relative flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
        >
          <AppIcon icon="hub-settings" size={20} decorative />
          {hasPendingCircleInvite && (
            <span aria-hidden="true" className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" />
          )}
        </Link>
      </div>

      <main className="flex-1 overflow-y-auto px-6 pb-24 pt-2">
        {/* Own Suspense boundary (rather than relying on App.tsx's top-level
            one) so switching tabs shows a small inline spinner in the
            content area only — the tab bar, offline banner, and focus
            button below stay mounted and visible instead of the whole
            screen flashing to a full-screen spinner on every navigation. */}
        <Suspense
          fallback={
            <div className="flex justify-center py-16">
              <Spinner className="h-6 w-6 text-primary" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>

      {/* Tab Bar — 5 labeled items per anchor-redesign-spec.md section 4.
          Active state is a tinted pill (bg-accent, already the spec's
          rgba(accent,10-14%) value from the token pass) behind the icon
          plus accent color on icon + label, instead of the old scale+dot
          treatment. Safe-area padding is a no-op fallback to 0 unless the
          device reports a bottom inset (e.g. Android gesture nav), see
          CARTOGRAPHIE.md Mission 7d. */}
      <nav
        className="fixed bottom-0 left-0 right-0 border-t border-border bg-card/95 backdrop-blur-md"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto flex max-w-lg items-center justify-around py-1.5">
          {navItems.map(({ path, icon, labelKey }) => (
            <NavLink
              key={path}
              to={path}
              end={path === "/"}
              className="flex flex-col items-center gap-1 px-2 py-1 text-[11px] font-medium"
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full ${
                      prefersReducedMotion ? "" : "transition-colors duration-200"
                    } ${isActive ? "bg-accent" : ""}`}
                  >
                    <AppIcon icon={icon} size={20} decorative className={isActive ? "text-primary" : NAV_INACTIVE} />
                  </span>
                  <span className={isActive ? "text-primary" : NAV_INACTIVE}>{t(labelKey)}</span>
                </>
              )}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setShowHubModal(true)}
            aria-haspopup="dialog"
            aria-expanded={showHubModal}
            className="flex flex-col items-center gap-1 px-2 py-1 text-[11px] font-medium"
          >
            <span
              className={`relative flex h-9 w-9 items-center justify-center rounded-full ${
                prefersReducedMotion ? "" : "transition-colors duration-200"
              } ${showHubModal ? "bg-accent" : ""}`}
            >
              <AppIcon icon="nav-more" size={20} decorative className={showHubModal ? "text-primary" : NAV_INACTIVE} />
              {hubHasNotification && !showHubModal && (
                <span aria-hidden="true" className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-primary" />
              )}
            </span>
            <span className={showHubModal ? "text-primary" : NAV_INACTIVE}>{t("nav.more")}</span>
          </button>
        </div>
      </nav>

      {/* Pause Floating Button */}
      <button
        onClick={() => setShowPauseMenu(true)}
        className="fixed right-6 flex h-12 w-12 items-center justify-center rounded-full bg-secondary shadow-[0_2px_10px_rgba(0,0,0,0.08)] transition-all hover:scale-110 hover:shadow-[0_4px_15px_rgba(0,0,0,0.12)] active:scale-95"
        style={{ bottom: "calc(5rem + env(safe-area-inset-bottom))" }}
        aria-label={t("pause.title")}
      >
        <AppIcon icon="pause" decorative />
      </button>

      <PauseModal
        open={showPauseMenu}
        onClose={() => setShowPauseMenu(false)}
        onSelect={(option) => {
          setShowPauseMenu(false)
          setActivePause(option)
        }}
      />
      {activePause === "breathing" && <PauseBreathing onClose={() => setActivePause(null)} />}
      {activePause === "focus_session" && <PauseFocusSession onClose={() => setActivePause(null)} />}
      {activePause === "recenter" && <PauseRecenter onClose={() => setActivePause(null)} />}

      <HubModal
        open={showHubModal}
        onClose={() => setShowHubModal(false)}
        hasUnreadLetter={hasUnreadLetter}
        hasPendingCircleInvite={hasPendingCircleInvite}
        hasUnreadEncouragement={hasUnreadEncouragement}
        lettersCount={hubStatus.lettersCount}
        circleMemberCount={hubStatus.circleMemberCount}
        jarCount={hubStatus.jarCount}
        wrappedLatestMonth={hubStatus.wrappedLatestMonth}
      />
    </div>
  )
}


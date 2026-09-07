import { Outlet, NavLink, Link, useLocation } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { CloudOff, RefreshCw } from "lucide-react"
import { Suspense, useEffect, useRef, useState } from "react"
import { Capacitor } from "@capacitor/core"
import { Network } from "@capacitor/network"
import { isOnline, processSyncQueue, getPendingSyncCount, SYNC_QUEUE_CHANGED_EVENT } from "@/lib/offline-sync"
import { useAuth } from "@/lib/auth-context"
import { useViewportTier } from "@/hooks/use-viewport"
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion"
import { useHomeBadges } from "@/hooks/use-home-badges"
import { useHubStatus } from "@/hooks/use-hub-status"
import { useDialogFocusRestore } from "@/hooks/use-dialog-focus-restore"
import { AppIcon, type AppIconSource } from "@/components/icons/app-icon"
import { PauseModal, type PauseOption } from "@/components/anchor/pause-modal"
import { PauseBreathing } from "@/components/anchor/pause-breathing"
import { PauseFocusSession } from "@/components/anchor/pause-focus-session"
import { PauseRecenter } from "@/components/anchor/pause-recenter"
import { HubModal } from "@/components/anchor/hub-modal"
import { InstallPrompt } from "@/components/pwa/install-prompt"
import { Spinner } from "@/components/ui/spinner"
import { WebSidebar, SIDEBAR_WIDTH_DESKTOP, SIDEBAR_WIDTH_TABLET } from "@/components/layout/web-sidebar"

// Order matches feature/capacitor-mobile's 5-item nav (anchor-redesign-spec.md
// section 4): Home / Check-in / Patterns / Move / More. "More" isn't a route
// — it opens the Hub sheet below instead of a NavLink — so it's rendered
// separately further down rather than living in this array.
const navItems: { path: string; icon: AppIconSource; labelKey: string }[] = [
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
  const viewportTier = useViewportTier()
  const isMobile = viewportTier === "mobile"
  const prefersReducedMotion = usePrefersReducedMotion()
  const [online, setOnline] = useState(isOnline())
  const [showPauseMenu, setShowPauseMenu] = useState(false)
  const [activePause, setActivePause] = useState<PauseOption | null>(null)
  const [showHubModal, setShowHubModal] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [retrying, setRetrying] = useState(false)
  const pauseTriggerRef = useRef<HTMLButtonElement>(null)

  // Letters/Circle/Jar/Wrapped/Settings used to live in home.tsx's own top
  // icon row (mobile <768px only) — now reachable from every tab via the
  // "More" hub sheet below, so the badge data that used to drive that row's
  // dots moves here instead. refreshKey (route pathname) keeps them fresh
  // across in-app navigation now that this lives in AppLayout, which never
  // unmounts between tabs the way HomePage does — see use-home-badges.ts.
  const { hasUnreadLetter, hasPendingCircleInvite, hasUnreadEncouragement } = useHomeBadges(
    user,
    profile,
    location.pathname
  )
  const hubStatus = useHubStatus(user, location.pathname)
  const hubHasNotification = hasUnreadLetter || hasPendingCircleInvite || hasUnreadEncouragement

  // HubModal is a Radix Sheet with no SheetTrigger (controlled via
  // showHubModal state) — same gap as PauseModal above and every other
  // externally-controlled dialog in this app, see use-dialog-focus-restore.ts.
  const hubFocus = useDialogFocusRestore()
  // Set right before picking a Pause option — PauseModal's Dialog closes in
  // that case too (same onCloseAutoFocus fires), but focus shouldn't jump
  // back to the trigger then: a sub-overlay (PauseBreathing/Recenter/
  // FocusSession) is opening right on top of it. Only a real "not
  // now"/Escape/overlay-click close should restore to the trigger.
  const selectingPauseOptionRef = useRef(false)

  // PauseModal is a controlled Dialog (open={showPauseMenu}, no
  // DialogTrigger wrapping the button below) — Radix has no registered
  // trigger to restore focus to on its own, so Escape/overlay-click/"Not
  // now" would otherwise drop focus to <body>. The actual restore happens
  // in onPauseMenuCloseAutoFocus below, not here: while PauseModal's exit
  // animation plays, Radix's FocusScope is still trapping focus inside it,
  // so a `.focus()` call fired from this state-setter is silently
  // swallowed — onCloseAutoFocus is the one moment the trap has released.
  function closePauseMenu() {
    setShowPauseMenu(false)
  }

  function onPauseMenuCloseAutoFocus(e: Event) {
    e.preventDefault()
    if (selectingPauseOptionRef.current) {
      selectingPauseOptionRef.current = false
      return
    }
    pauseTriggerRef.current?.focus()
  }

  // Picking a Pause option replaces that same Dialog with one of the
  // plain-div overlays below in the same commit — same underlying gap,
  // just reached via onSelect instead of onClose (see useEscapeToClose's
  // `restoreFocus: false` on all three usages below, which defers to this
  // instead of guessing via document.activeElement).
  function closePauseFlow() {
    setActivePause(null)
    pauseTriggerRef.current?.focus()
  }

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
    // overflow-x-hidden is a safety net, not the fix — see home.tsx's header
    // row for the actual root cause this guards against. Kept here in
    // addition to that fix so a future unrelated regression can't silently
    // reintroduce a horizontal scrollbar on mobile.
    <div className="flex min-h-svh overflow-x-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none focus:ring-[3px] focus:ring-ring/50"
      >
        {t("a11y.skip_to_content")}
      </a>

      {/* Install-to-homescreen nudge only makes sense for the PWA — the
          native app is already "installed" once it's on the device. */}
      {!Capacitor.isNativePlatform() && <InstallPrompt />}

      {/* Sidebar replaces the bottom tab bar at 768px+ — full labels above
          1024px, icon rail with tooltips between 768-1024px. Below 768px
          this renders nothing and the mobile tab bar (further down) takes
          over instead, untouched. See anchor-web-spec.md section 2. */}
      {!isMobile && <WebSidebar collapsed={viewportTier === "tablet"} />}

      <div
        className="flex min-h-svh flex-1 flex-col"
        style={isMobile ? undefined : { marginLeft: viewportTier === "tablet" ? SIDEBAR_WIDTH_TABLET : SIDEBAR_WIDTH_DESKTOP }}
      >
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
            here, alone. Mobile only (<768px) — at 768px+ WebSidebar already
            has its own Settings link, so this would otherwise be a duplicate
            entry point. Each page's own in-body title is left as-is for now
            (see CLAUDE.md's Design system note) — folding it into this
            header is scoped to that page's own redesign phase, not this nav
            pass, to avoid a doubled-up title until then. Sits in normal flow
            above <main> (not fixed) — same technique the offline banner
            above already uses to stay visible without scrolling away. */}
        {isMobile && (
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
        )}

        <main
          id="main-content"
          tabIndex={-1}
          className={`flex-1 overflow-y-auto px-6 pt-2 outline-none ${isMobile ? "pb-24" : "pb-10"}`}
        >
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

        {/* Tab Bar — mobile only (<768px), see WebSidebar above for 768px+.
            Active state is a tinted pill (bg-accent) behind the icon plus
            accent color on icon + label. Safe-area padding is a no-op
            fallback to 0 unless the device reports a bottom inset (e.g.
            Android gesture nav), see CARTOGRAPHIE.md Mission 7d. */}
        {isMobile && (
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
                  className="flex min-h-11 min-w-11 flex-col items-center justify-center gap-1 px-2 py-1 text-[11px] font-medium"
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

              {/* "More" — 5th tab, opens the Hub sheet (Letters/Circle/Jar/
                  Wrapped/Settings) instead of navigating directly. Not a
                  NavLink since it has no route of its own. */}
              <button
                type="button"
                onClick={() => {
                  hubFocus.captureTrigger()
                  setShowHubModal(true)
                }}
                aria-haspopup="dialog"
                aria-expanded={showHubModal}
                className="flex min-h-11 min-w-11 flex-col items-center justify-center gap-1 px-2 py-1 text-[11px] font-medium"
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
        )}
      </div>

      {/* Pause Floating Button */}
      <button
        ref={pauseTriggerRef}
        onClick={() => setShowPauseMenu(true)}
        className={`fixed right-6 flex h-12 w-12 items-center justify-center rounded-full bg-secondary shadow-[0_2px_10px_rgba(0,0,0,0.08)] transition-all hover:scale-110 hover:shadow-[0_4px_15px_rgba(0,0,0,0.12)] active:scale-95 ${
          isMobile ? "" : "bottom-6"
        }`}
        style={isMobile ? { bottom: "calc(5rem + env(safe-area-inset-bottom))" } : undefined}
        aria-label={t("pause.title")}
      >
        <AppIcon icon="pause" decorative />
      </button>

      <PauseModal
        open={showPauseMenu}
        onClose={closePauseMenu}
        onCloseAutoFocus={onPauseMenuCloseAutoFocus}
        onSelect={(option) => {
          selectingPauseOptionRef.current = true
          setShowPauseMenu(false)
          setActivePause(option)
        }}
      />
      {activePause === "breathing" && <PauseBreathing onClose={closePauseFlow} />}
      {activePause === "focus_session" && <PauseFocusSession onClose={closePauseFlow} />}
      {activePause === "recenter" && <PauseRecenter onClose={closePauseFlow} />}

      <HubModal
        open={showHubModal}
        onClose={() => setShowHubModal(false)}
        onCloseAutoFocus={hubFocus.dialogContentProps.onCloseAutoFocus}
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


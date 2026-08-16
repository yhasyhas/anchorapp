import { Outlet, NavLink, useLocation } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { CloudOff, RefreshCw } from "lucide-react"
import { Suspense, useEffect, useState } from "react"
import { isOnline, processSyncQueue, getPendingSyncCount, SYNC_QUEUE_CHANGED_EVENT } from "@/lib/offline-sync"
import { useAuth } from "@/lib/auth-context"
import { useViewportTier } from "@/hooks/use-viewport"
import { AppIcon, type AppIconSource } from "@/components/icons/app-icon"
import { PauseModal, type PauseOption } from "@/components/anchor/pause-modal"
import { PauseBreathing } from "@/components/anchor/pause-breathing"
import { PauseFocusSession } from "@/components/anchor/pause-focus-session"
import { PauseRecenter } from "@/components/anchor/pause-recenter"
import { InstallPrompt } from "@/components/pwa/install-prompt"
import { Spinner } from "@/components/ui/spinner"
import { WebSidebar, SIDEBAR_WIDTH_DESKTOP, SIDEBAR_WIDTH_TABLET } from "@/components/layout/web-sidebar"

const navItems: { path: string; icon: AppIconSource; labelKey: string }[] = [
  { path: "/", icon: "nav-home", labelKey: "home.title" },
  { path: "/patterns", icon: "nav-patterns", labelKey: "patterns.title" },
  { path: "/checkin", icon: "nav-checkin", labelKey: "checkin.title" },
  { path: "/move", icon: "nav-move", labelKey: "move.title" },
]

export function AppLayout() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const location = useLocation()
  const viewportTier = useViewportTier()
  const isMobile = viewportTier === "mobile"
  const [online, setOnline] = useState(isOnline())
  const [showPauseMenu, setShowPauseMenu] = useState(false)
  const [activePause, setActivePause] = useState<PauseOption | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    if (!user) return
    const refreshPendingCount = () => setPendingCount(getPendingSyncCount(user.id))
    refreshPendingCount()
    window.addEventListener(SYNC_QUEUE_CHANGED_EVENT, refreshPendingCount)
    return () => window.removeEventListener(SYNC_QUEUE_CHANGED_EVENT, refreshPendingCount)
  }, [user])

  useEffect(() => {
    if (!user) return
    const handleOnline = () => {
      setOnline(true)
      processSyncQueue(user.id)
    }
    const handleOffline = () => setOnline(false)
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
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
    <div className="flex min-h-svh bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none focus:ring-[3px] focus:ring-ring/50"
      >
        {t("a11y.skip_to_content")}
      </a>

      <InstallPrompt />

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

        <main
          id="main-content"
          tabIndex={-1}
          className={`flex-1 overflow-y-auto px-6 pt-6 outline-none ${isMobile ? "pb-24" : "pb-10"}`}
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

        {/* Tab Bar — mobile only (<768px), see WebSidebar above for 768px+ */}
        {isMobile && (
          <nav className="fixed bottom-0 left-0 right-0 border-t border-border/60 bg-card/95 backdrop-blur-md">
            <div className="mx-auto flex max-w-lg items-center justify-around py-2">
              {navItems.map(({ path, icon, labelKey }) => (
                <NavLink
                  key={path}
                  to={path}
                  className={({ isActive }) =>
                    `flex flex-col items-center gap-1 px-3 py-2 text-xs outline-none transition-all duration-200 focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                      isActive ? "text-primary scale-105" : "text-muted-foreground hover:text-foreground"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <AppIcon icon={icon} size={20} active={isActive} decorative className="transition-transform duration-200" />
                      <span>{t(labelKey)}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </nav>
        )}
      </div>

      {/* Pause Floating Button */}
      <button
        onClick={() => setShowPauseMenu(true)}
        className={`fixed right-6 flex h-12 w-12 items-center justify-center rounded-full bg-secondary shadow-[0_2px_10px_rgba(0,0,0,0.08)] transition-all hover:scale-110 hover:shadow-[0_4px_15px_rgba(0,0,0,0.12)] active:scale-95 ${
          isMobile ? "bottom-20" : "bottom-6"
        }`}
        aria-label={t("pause.title")}
      >
        <span className="text-lg">&#x2601;&#xFE0F;</span>
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
    </div>
  )
}


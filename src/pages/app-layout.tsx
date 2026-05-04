import { Outlet, NavLink, useLocation } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Home, BarChart3, Heart, Footprints, CloudOff } from "lucide-react"
import { useEffect, useState } from "react"
import { isOnline, processSyncQueue } from "@/lib/offline-sync"
import { FocusModeModal } from "@/components/anchor/focus-mode-modal"

const navItems = [
  { path: "/", icon: Home, labelKey: "home.title" },
  { path: "/patterns", icon: BarChart3, labelKey: "patterns.title" },
  { path: "/checkin", icon: Heart, labelKey: "checkin.title" },
  { path: "/move", icon: Footprints, labelKey: "move.title" },
]

export function AppLayout() {
  const { t } = useTranslation()
  const location = useLocation()
  const [online, setOnline] = useState(isOnline())
  const [showFocus, setShowFocus] = useState(false)

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true)
      processSyncQueue()
    }
    const handleOffline = () => setOnline(false)
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  useEffect(() => {
    processSyncQueue()
  }, [location])

  return (
    <div className="flex min-h-svh flex-col bg-background">
      {/* Offline Banner - Style doux */}
      {!online && (
        <div className="flex items-center justify-center gap-2 bg-lavender/40 px-4 py-2.5 text-center backdrop-blur-sm animate-in slide-in-from-top">
          <CloudOff className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground font-medium">
            {t("offline.banner")}
          </span>
        </div>
      )}

      <main className="flex-1 overflow-y-auto px-6 pb-24 pt-6">
        <Outlet />
      </main>

      {/* Tab Bar */}
      <nav className="fixed bottom-0 left-0 right-0 border-t border-border/60 bg-card/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-lg items-center justify-around py-2">
          {navItems.map(({ path, icon: Icon, labelKey }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 px-3 py-2 text-xs transition-all duration-200 ${
                  isActive ? "text-primary scale-105" : "text-muted-foreground hover:text-foreground"
                }`
              }
            >
              <Icon className="h-5 w-5 transition-transform duration-200" />
              <span>{t(labelKey)}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Focus Mode Floating Button */}
      <button
        onClick={() => setShowFocus(true)}
        className="fixed bottom-20 right-6 flex h-12 w-12 items-center justify-center rounded-full bg-secondary shadow-[0_2px_10px_rgba(0,0,0,0.08)] transition-all hover:scale-110 hover:shadow-[0_4px_15px_rgba(0,0,0,0.12)] active:scale-95"
        aria-label={t("focus.title")}
      >
        <span className="text-lg">&#x2601;&#xFE0F;</span>
      </button>

      <FocusModeModal open={showFocus} onClose={() => setShowFocus(false)} />
    </div>
  )
}

// import { Outlet, NavLink, useLocation } from "react-router-dom"
// import { useTranslation } from "react-i18next"
// import { Hop as Home, ChartBar as BarChart3, Heart, Footprints } from "lucide-react"
// import { useEffect, useState } from "react"
// import { isOnline, processSyncQueue } from "@/lib/offline-sync"
// import { FocusModeModal } from "@/components/anchor/focus-mode-modal"

// // const navItems = [
// //   { path: "/", icon: Home, labelKey: "home.greeting" },
// //   { path: "/patterns", icon: BarChart3, labelKey: "patterns.title" },
// //   { path: "/checkin", icon: Heart, labelKey: "checkin.title" },
// //   { path: "/move", icon: Footprints, labelKey: "move.title" },
// // ]

// const navItems = [
//   { path: "/", icon: Home, labelKey: "home.tab" },
//   { path: "/patterns", icon: BarChart3, labelKey: "patterns.title" },
//   { path: "/checkin", icon: Heart, labelKey: "checkin.title" },
//   { path: "/move", icon: Footprints, labelKey: "move.title" },
// ]

// export function AppLayout() {
//   const { t } = useTranslation()
//   const location = useLocation()
//   const [online, setOnline] = useState(isOnline())
//   const [showFocus, setShowFocus] = useState(false)

//   useEffect(() => {
//     const handleOnline = () => {
//       setOnline(true)
//       processSyncQueue()
//     }
//     const handleOffline = () => setOnline(false)
//     window.addEventListener("online", handleOnline)
//     window.addEventListener("offline", handleOffline)
//     return () => {
//       window.removeEventListener("online", handleOnline)
//       window.removeEventListener("offline", handleOffline)
//     }
//   }, [])

//   useEffect(() => {
//     processSyncQueue()
//   }, [location])

//   return (
//     <div className="flex min-h-svh flex-col bg-background">
//       {!online && (
//         <div className="bg-muted px-4 py-2 text-center text-sm text-muted-foreground">
//           {t("offline.banner")}
//         </div>
//       )}

//       <main className="flex-1 overflow-y-auto px-6 pb-24 pt-6">
//         <Outlet />
//       </main>

//       <nav className="fixed bottom-0 left-0 right-0 border-t border-border bg-card/95 backdrop-blur-sm">
//         <div className="mx-auto flex max-w-lg items-center justify-around py-2">
//           {navItems.map(({ path, icon: Icon, labelKey }) => (
//             <NavLink
//               key={path}
//               to={path}
//               className={({ isActive }) =>
//                 `flex flex-col items-center gap-1 px-3 py-2 text-xs transition-colors ${
//                   isActive ? "text-primary" : "text-muted-foreground"
//                 }`
//               }
//             >
//               <Icon className="h-5 w-5" />
//               {/* <span>{path === "/" ? "Home" : t(labelKey)}</span> */}
//               <span>{t(labelKey)}</span>
//             </NavLink>
//           ))}
//         </div>
//       </nav>

//       <button
//         onClick={() => setShowFocus(true)}
//         className="fixed bottom-20 right-6 flex h-12 w-12 items-center justify-center rounded-full bg-secondary shadow-[0_2px_10px_rgba(0,0,0,0.08)] transition-transform hover:scale-105"
//         aria-label={t("focus.title")}
//       >
//         <span className="text-lg">&#x2601;&#xFE0F;</span>
//       </button>

//       <FocusModeModal open={showFocus} onClose={() => setShowFocus(false)} />
//     </div>
//   )
// }

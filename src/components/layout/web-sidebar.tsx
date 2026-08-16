import { NavLink } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Anchor as AnchorIcon } from "lucide-react"
import { AppIcon, type AppIconSource } from "@/components/icons/app-icon"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

// Desktop/tablet nav — see anchor-web-spec.md section 2. Kept separate from
// app-layout.tsx's `navItems` (the mobile bottom tab bar), which stays
// untouched: the two lists differ in scope (this one lists every section,
// mobile hides Letters/Circle/Jar/Wrapped behind quick-action icons on Home)
// so merging them would force one to compromise for the other.
const primaryNavItems: { path: string; icon: AppIconSource; labelKey: string }[] = [
  { path: "/", icon: "nav-home", labelKey: "home.title" },
  { path: "/checkin", icon: "nav-checkin", labelKey: "checkin.title" },
  { path: "/patterns", icon: "nav-patterns", labelKey: "patterns.title" },
  { path: "/move", icon: "nav-move", labelKey: "move.title" },
]

const secondaryNavItems: { path: string; icon: AppIconSource; labelKey: string }[] = [
  { path: "/letters", icon: "hub-letters", labelKey: "letters.title" },
  { path: "/circle", icon: "hub-circle", labelKey: "circle.page_title" },
  { path: "/jar", icon: "hub-jar", labelKey: "jar.page_title" },
  { path: "/wrapped", icon: "hub-wrapped", labelKey: "wrapped.history_title" },
]

export const SIDEBAR_WIDTH_DESKTOP = 208
export const SIDEBAR_WIDTH_TABLET = 72

interface WebSidebarProps {
  collapsed: boolean
}

export function WebSidebar({ collapsed }: WebSidebarProps) {
  const { t } = useTranslation()

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className="fixed inset-y-0 left-0 z-30 flex flex-col border-r border-border/60 bg-card"
        style={{ width: collapsed ? SIDEBAR_WIDTH_TABLET : SIDEBAR_WIDTH_DESKTOP }}
      >
        <div className={`flex items-center gap-2 py-5 ${collapsed ? "justify-center px-0" : "px-4"}`}>
          <AnchorIcon className="h-5 w-5 shrink-0 text-primary" />
          {!collapsed && <span className="font-heading text-lg font-semibold text-foreground">Anchor</span>}
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3" aria-label={t("home.title")}>
          {primaryNavItems.map((item) => (
            <SidebarLink
              key={item.path}
              path={item.path}
              icon={item.icon}
              label={t(item.labelKey)}
              collapsed={collapsed}
            />
          ))}

          <div className={`my-2 border-t border-border/60 ${collapsed ? "mx-2" : "mx-1"}`} />

          {secondaryNavItems.map((item) => (
            <SidebarLink
              key={item.path}
              path={item.path}
              icon={item.icon}
              label={t(item.labelKey)}
              collapsed={collapsed}
            />
          ))}
        </nav>

        <div className="border-t border-border/60 px-3 py-3">
          <SidebarLink path="/settings" icon="hub-settings" label={t("settings.title")} collapsed={collapsed} />
        </div>
      </aside>
    </TooltipProvider>
  )
}

interface SidebarLinkProps {
  path: string
  icon: AppIconSource
  label: string
  collapsed: boolean
}

function SidebarLink({ path, icon, label, collapsed }: SidebarLinkProps) {
  const link = (
    <NavLink
      to={path}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg py-2.5 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
          collapsed ? "justify-center px-0" : "px-3"
        } ${
          isActive
            ? "bg-primary/10 font-medium text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`
      }
      aria-label={collapsed ? label : undefined}
    >
      {({ isActive }) => (
        <>
          <AppIcon icon={icon} size={20} active={isActive} decorative className="shrink-0" />
          {!collapsed && <span>{label}</span>}
        </>
      )}
    </NavLink>
  )

  if (!collapsed) return link

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

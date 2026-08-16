import { useEffect, useState } from "react"

export type ViewportTier = "mobile" | "tablet" | "desktop"

// Mirrors the breakpoints in anchor-web-spec.md section 2: below 768px is
// the untouched mobile layout, 768-1024px is the icon-rail sidebar, above
// 1024px is the full sidebar.
const TABLET_QUERY = "(min-width: 768px)"
const DESKTOP_QUERY = "(min-width: 1024px)"

function resolveTier(tabletMatches: boolean, desktopMatches: boolean): ViewportTier {
  if (desktopMatches) return "desktop"
  if (tabletMatches) return "tablet"
  return "mobile"
}

export function useViewportTier(): ViewportTier {
  const [tier, setTier] = useState<ViewportTier>(() => {
    if (typeof window === "undefined") return "mobile"
    return resolveTier(window.matchMedia(TABLET_QUERY).matches, window.matchMedia(DESKTOP_QUERY).matches)
  })

  useEffect(() => {
    const tabletMql = window.matchMedia(TABLET_QUERY)
    const desktopMql = window.matchMedia(DESKTOP_QUERY)
    const onChange = () => setTier(resolveTier(tabletMql.matches, desktopMql.matches))
    tabletMql.addEventListener("change", onChange)
    desktopMql.addEventListener("change", onChange)
    return () => {
      tabletMql.removeEventListener("change", onChange)
      desktopMql.removeEventListener("change", onChange)
    }
  }, [])

  return tier
}

import { useEffect, useState } from "react"

const QUERY = "(prefers-reduced-motion: reduce)"

// Purely decorative bursts (confetti, evening-release particles) check this
// before animating at all — functional motion elsewhere in the app (the
// morning-ritual breathing circle) is left alone since removing it would
// remove the feature itself, not just decorate it.
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia(QUERY).matches
  )

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    const onChange = () => setReduced(mql.matches)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return reduced
}

import { useEffect, useRef, useState } from "react"
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion"

// Reveals a section once as it scrolls into view — purely decorative (landing page only),
// so it defers to usePrefersReducedMotion the same way confetti/particles do elsewhere
// (see that hook's own comment) rather than animating regardless.
export function useScrollReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const prefersReducedMotion = usePrefersReducedMotion()
  const [revealed, setRevealed] = useState(prefersReducedMotion)

  useEffect(() => {
    if (prefersReducedMotion || !ref.current) return
    const el = ref.current
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true)
          observer.unobserve(el)
        }
      },
      { threshold: 0.15 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [prefersReducedMotion])

  return { ref, revealed }
}

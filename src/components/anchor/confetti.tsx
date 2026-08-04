import { useEffect } from "react"
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion"

export function ConfettiBurst({ active }: { active: boolean }) {
  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    if (!active || reducedMotion) return

    const container = document.createElement("div")
    container.style.position = "fixed"
    container.style.inset = "0"
    container.style.pointerEvents = "none"
    container.style.zIndex = "100"
    container.style.overflow = "hidden"
    document.body.appendChild(container)

    const colors = [
      "var(--sage)",
      "var(--rose-accent)",
      "var(--lavender)",
      "var(--peach)",
      "var(--background)",
      "var(--foreground)",
    ]
    const particles: HTMLDivElement[] = []

    for (let i = 0; i < 50; i++) {
      const el = document.createElement("div")
      const size = 6 + Math.random() * 8
      el.style.position = "absolute"
      el.style.left = "50%"
      el.style.top = "45%"
      el.style.width = `${size}px`
      el.style.height = `${size}px`
      el.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)]
      el.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px"
      el.style.transition = "all 1.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)"
      el.style.opacity = "1"
      container.appendChild(el)
      particles.push(el)
    }

    requestAnimationFrame(() => {
      particles.forEach((el) => {
        const angle = Math.random() * Math.PI * 2
        const velocity = 80 + Math.random() * 200
        const tx = Math.cos(angle) * velocity
        const ty = Math.sin(angle) * velocity - 60 // légèrement vers le haut
        const rot = Math.random() * 720 - 360
        el.style.transform = `translate(${tx}px, ${ty}px) rotate(${rot}deg) scale(0)`
        el.style.opacity = "0"
      })
    })

    const timer = setTimeout(() => {
      container.remove()
    }, 1500)

    return () => {
      clearTimeout(timer)
      container.remove()
    }
  }, [active, reducedMotion])

  return null
}
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

interface Particle {
  id: number
  x: number
  delay: number
  size: number
}

export function EveningReleaseAnimation({ active }: { active: boolean }) {
  const [particles, setParticles] = useState<Particle[]>([])

  useEffect(() => {
    if (active) {
      const newParticles = Array.from({ length: 12 }, (_, i) => ({
        id: Date.now() + i,
        x: Math.random() * 100,
        delay: Math.random() * 0.5,
        size: Math.random() * 6 + 4,
      }))
      setParticles(newParticles)
      const timer = setTimeout(() => setParticles([]), 3000)
      return () => clearTimeout(timer)
    }
  }, [active])

  if (!active && particles.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute bottom-4 rounded-full opacity-0 animate-float-up"
          style={{
            left: `${p.x}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            backgroundColor: ["#D4C5E8", "#E8C4C4", "#F5D5C5", "#E8EDE5"][Math.floor(Math.random() * 4)],
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
      <style>{`
        @keyframes float-up {
          0% { transform: translateY(0) scale(1); opacity: 0.8; }
          100% { transform: translateY(-120px) scale(0.2); opacity: 0; }
        }
        .animate-float-up {
          animation: float-up 2.5s ease-out forwards;
        }
      `}</style>
    </div>
  )
}
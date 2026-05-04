import { useTranslation } from "react-i18next"

interface EmptyStateProps {
  icon: "flower" | "cloud" | "moon" | "seedling"
  titleKey: string
  descriptionKey?: string
}

const icons = {
  flower: (
    <svg viewBox="0 0 64 64" fill="none" className="h-16 w-16 text-rose-accent/60">
      <circle cx="32" cy="28" r="8" fill="currentColor" />
      <circle cx="32" cy="12" r="6" fill="currentColor" opacity="0.5" />
      <circle cx="32" cy="44" r="6" fill="currentColor" opacity="0.5" />
      <circle cx="16" cy="28" r="6" fill="currentColor" opacity="0.5" />
      <circle cx="48" cy="28" r="6" fill="currentColor" opacity="0.5" />
      <path d="M32 52v8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  ),
  cloud: (
    <svg viewBox="0 0 64 64" fill="none" className="h-16 w-16 text-lavender/60">
      <path d="M16 40a12 12 0 0112-12 10 10 0 0118-2 12 12 0 0110 12 8 8 0 01-8 8H20a8 8 0 01-4-8z" fill="currentColor" />
    </svg>
  ),
  moon: (
    <svg viewBox="0 0 64 64" fill="none" className="h-16 w-16 text-primary/40">
      <path d="M46 28a16 16 0 11-20 20 12 12 0 0020-20z" fill="currentColor" />
    </svg>
  ),
  seedling: (
    <svg viewBox="0 0 64 64" fill="none" className="h-16 w-16 text-sage/60">
      <path d="M32 56V32" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M32 32c0-12 8-20 16-20-4 8-8 12-16 12z" fill="currentColor" />
      <path d="M32 36c0-10-6-16-12-16 3 6 6 10 12 10z" fill="currentColor" opacity="0.6" />
    </svg>
  ),
}

export function EmptyState({ icon, titleKey, descriptionKey }: EmptyStateProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="mb-4 transition-transform hover:scale-105 duration-300">
        {icons[icon]}
      </div>
      <p className="font-heading text-base font-medium text-foreground/80">
        {t(titleKey)}
      </p>
      {descriptionKey && (
        <p className="mt-1 text-sm text-muted-foreground max-w-[200px]">
          {t(descriptionKey)}
        </p>
      )}
    </div>
  )
}
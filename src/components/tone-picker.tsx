import { useTranslation } from "react-i18next"
import { Check } from "lucide-react"
import { tones } from "@/lib/constants"
import type { Tone } from "@/types"

interface TonePickerProps {
  value: Tone
  onChange: (tone: Tone) => void
}

// Shared between the onboarding tone screen and Settings — same 3 cards, same copy
// (src/locales/*.json "tones.*"), so the tone she picks always looks like the same choice
// wherever she's asked.
export function TonePicker({ value, onChange }: TonePickerProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-3">
      {tones.map((tone) => {
        const selected = value === tone
        return (
          <button
            key={tone}
            type="button"
            onClick={() => onChange(tone)}
            className={`w-full rounded-2xl border p-4 text-left transition-all duration-300 ${
              selected
                ? "border-primary bg-sage-light/40 ring-2 ring-primary ring-offset-2 shadow-md"
                : "border-border bg-card hover:border-primary/40"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-heading text-base font-semibold text-foreground">{t(`tones.${tone}.label`)}</p>
              {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{t(`tones.${tone}.description`)}</p>
            <p className="mt-2 text-sm italic text-foreground/80">"{t(`tones.${tone}.example`)}"</p>
          </button>
        )
      })}
    </div>
  )
}

import { useTranslation } from "react-i18next"
import { Sparkles } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { TonePicker } from "@/components/tone-picker"
import { useAuth } from "@/lib/auth-context"
import type { Tone } from "@/types"

export function ToneSection() {
  const { t } = useTranslation()
  const { profile, updateProfile } = useAuth()
  const tone = profile?.tone ?? "gentle"

  async function handleToneChange(next: Tone) {
    await updateProfile({ tone: next })
  }

  return (
    <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">{t("settings.tone_title")}</p>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{t("settings.tone_desc")}</p>
        <TonePicker value={tone} onChange={handleToneChange} />
      </CardContent>
    </Card>
  )
}

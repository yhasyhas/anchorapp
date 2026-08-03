import { useTranslation } from "react-i18next"
import { Heart } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { useAuth } from "@/lib/auth-context"

// Manual on/off — the other entry point besides the automatic proposal card
// on Home (see soft-mode-nudge-card.tsx). Toggling here works at any time,
// independent of whether either automatic trigger has fired.
export function SoftModeSection() {
  const { t } = useTranslation()
  const { profile, updateProfile } = useAuth()
  const softMode = profile?.soft_mode ?? false

  async function handleToggle(enabled: boolean) {
    await updateProfile({ soft_mode: enabled, soft_mode_since: enabled ? new Date().toISOString() : null })
  }

  return (
    <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Heart className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium">{t("soft_mode.settings_title")}</p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{t("soft_mode.settings_enable_desc")}</p>
          </div>
          <Switch checked={softMode} onCheckedChange={handleToggle} />
        </div>
      </CardContent>
    </Card>
  )
}

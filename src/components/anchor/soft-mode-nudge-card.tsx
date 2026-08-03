import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Heart } from "lucide-react"

interface SoftModeNudgeCardProps {
  // "enter": proposes turning soft mode on (3 heavy days, or a return after
  // an absence). "exit": proposes turning it back off (2 lighter days in a
  // row while already active). Same card shape, different copy/actions —
  // never imposed, always accept/not-now, per the feature's "propose, never
  // impose" rule.
  variant: "enter" | "exit"
  onAccept: () => void
  onDismiss: () => void
}

export function SoftModeNudgeCard({ variant, onAccept, onDismiss }: SoftModeNudgeCardProps) {
  const { t } = useTranslation()
  const isEnter = variant === "enter"

  return (
    <Card className="border-0 bg-lavender/25 shadow-[0_2px_10px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-2">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-lavender/40">
            <Heart className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium leading-relaxed text-foreground">
              {t(isEnter ? "soft_mode.proposal_title" : "soft_mode.exit_title")}
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={onAccept}>
                {t(isEnter ? "soft_mode.proposal_accept" : "soft_mode.exit_accept")}
              </Button>
              <Button size="sm" variant="ghost" onClick={onDismiss} className="text-muted-foreground">
                {t(isEnter ? "soft_mode.proposal_dismiss" : "soft_mode.exit_dismiss")}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

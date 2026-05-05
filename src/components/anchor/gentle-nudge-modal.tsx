import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Heart, Sparkles } from "lucide-react"

interface GentleNudgeModalProps {
  open: boolean
  onClose: () => void
  onChoose: () => void
  onContinue: () => void
  type: "mood" | "intention"
}

export function GentleNudgeModal({ open, onClose, onChoose, onContinue, type }: GentleNudgeModalProps) {
  const { t } = useTranslation()

  const config = {
    mood: {
      icon: <Heart className="h-6 w-6 text-peach" />,
      title: t("nudge.mood_title"),
      message: t("nudge.mood_message"),
      choose: t("nudge.choose_mood"),
    },
    intention: {
      icon: <Sparkles className="h-6 w-6 text-primary" />,
      title: t("nudge.intention_title"),
      message: t("nudge.intention_message"),
      choose: t("nudge.choose_intention"),
    },
  }

  const current = config[type]

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm border-0 bg-secondary shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
        <DialogHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
            {current.icon}
          </div>
          <DialogTitle className="font-heading text-lg font-semibold">
            {current.title}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm text-foreground/80 leading-relaxed">
            {current.message}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-3">
          <Button onClick={onChoose} className="w-full">
            {current.choose}
          </Button>
          <Button variant="ghost" onClick={onContinue} className="w-full text-muted-foreground hover:text-foreground">
            {t("nudge.continue_anyway")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
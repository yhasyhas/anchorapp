import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Wind, Target, Compass } from "lucide-react"
import { AppIcon } from "@/components/icons/app-icon"

export type PauseOption = "breathing" | "focus_session" | "recenter"

interface PauseModalProps {
  open: boolean
  onClose: () => void
  // Forwarded straight to DialogContent — see use-dialog-focus-restore.ts
  // for why the caller needs this exact hook rather than restoring focus
  // itself from onClose.
  onCloseAutoFocus?: (event: Event) => void
  onSelect: (option: PauseOption) => void
}

// Repositioned from the old "Focus Mode" (a static, non-functional modal —
// its "detect excessive scrolling" premise is impossible in a PWA with no
// access to other apps). This is now the entry menu for 3 real, working
// options — see pause-breathing.tsx / pause-focus-session.tsx / pause-recenter.tsx.
export function PauseModal({ open, onClose, onCloseAutoFocus, onSelect }: PauseModalProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-sm border-0 rounded-anchor-card-lg bg-secondary shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <AppIcon icon="pause" size={24} active decorative className="text-primary" />
          </div>
          <DialogTitle className="font-heading text-xl font-semibold">{t("pause.title")}</DialogTitle>
          <DialogDescription className="mt-2 text-foreground/80">{t("pause.message")}</DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-3">
          <Button onClick={() => onSelect("breathing")} className="min-h-12 w-full justify-start gap-2 rounded-anchor-card-lg" variant="outline">
            <AppIcon icon={Wind} size={20} decorative /> {t("pause.option_breathing")}
          </Button>
          <Button onClick={() => onSelect("focus_session")} className="min-h-12 w-full justify-start gap-2 rounded-anchor-card-lg" variant="outline">
            <AppIcon icon={Target} size={20} decorative /> {t("pause.option_focus")}
          </Button>
          <Button onClick={() => onSelect("recenter")} className="min-h-12 w-full justify-start gap-2 rounded-anchor-card-lg" variant="outline">
            <AppIcon icon={Compass} size={20} decorative /> {t("pause.option_recenter")}
          </Button>
          <Button variant="ghost" onClick={onClose} className="min-h-11 w-full text-muted-foreground">
            {t("pause.not_now")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

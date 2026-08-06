import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

export type PauseOption = "breathing" | "focus_session" | "recenter"

interface PauseModalProps {
  open: boolean
  onClose: () => void
  onSelect: (option: PauseOption) => void
}

// Repositioned from the old "Focus Mode" (a static, non-functional modal —
// its "detect excessive scrolling" premise is impossible in a PWA with no
// access to other apps). This is now the entry menu for 3 real, working
// options — see pause-breathing.tsx / pause-focus-session.tsx / pause-recenter.tsx.
export function PauseModal({ open, onClose, onSelect }: PauseModalProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm border-0 bg-secondary shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
        <DialogHeader className="text-center">
          <div className="mx-auto mb-4 text-4xl">&#x1F9D8;</div>
          <DialogTitle className="font-heading text-xl font-semibold">{t("pause.title")}</DialogTitle>
          <DialogDescription className="mt-2 text-foreground/80">{t("pause.message")}</DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-3">
          <Button onClick={() => onSelect("breathing")} className="w-full justify-start gap-2" variant="outline">
            <span>&#x1F32C;&#xFE0F;</span> {t("pause.option_breathing")}
          </Button>
          <Button onClick={() => onSelect("focus_session")} className="w-full justify-start gap-2" variant="outline">
            <span>&#x1F331;</span> {t("pause.option_focus")}
          </Button>
          <Button onClick={() => onSelect("recenter")} className="w-full justify-start gap-2" variant="outline">
            <span>&#x1F4AC;</span> {t("pause.option_recenter")}
          </Button>
          <Button variant="ghost" onClick={onClose} className="w-full text-muted-foreground">
            {t("pause.not_now")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface FocusModeModalProps {
  open: boolean
  onClose: () => void
}

export function FocusModeModal({ open, onClose }: FocusModeModalProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm border-0 bg-secondary shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
        <DialogHeader className="text-center">
          <div className="mx-auto mb-4 text-4xl">&#x1F9D8;</div>
          <DialogTitle className="font-heading text-xl font-semibold">
            {t("focus.title")}
          </DialogTitle>
          <DialogDescription className="mt-2 text-foreground/80">
            {t("focus.message")}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-3">
          <Button onClick={onClose} className="w-full">
            {t("focus.yes")}
          </Button>
          <Button variant="ghost" onClick={onClose} className="w-full text-muted-foreground">
            {t("focus.no")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface SoftModeBadgeProps {
  onExit: () => void
}

// Discrete pill on Home when soft mode is active — deliberately no day
// count ("day 12 of soft mode" would just be a sadness score). Tapping opens
// the explanation + the exit action, satisfying "a badge with a link to the
// explanation/exit" from the spec.
export function SoftModeBadge({ onExit }: SoftModeBadgeProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  function handleExit() {
    setOpen(false)
    onExit()
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 self-start rounded-full bg-lavender/30 px-3 py-1 text-xs font-medium text-foreground/80 transition-colors hover:bg-lavender/45"
      >
        {t("soft_mode.badge_label")}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("soft_mode.modal_title")}</DialogTitle>
            <DialogDescription>{t("soft_mode.modal_explanation")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleExit}>
              {t("soft_mode.modal_exit_button")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

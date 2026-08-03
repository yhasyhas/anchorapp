import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { JarIcon } from "@/components/anchor/jar-icon"
import type { Gratitude } from "@/types"

interface JarOpeningModalProps {
  open: boolean
  onClose: () => void
  gratitudes: Gratitude[]
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

type Stage = "prompt" | "revealing" | "closing"

// Never automatic — always starts on the "prompt" stage with an explicit
// yes/not-now choice, same shape as GentleNudgeModal's choose/continue pair.
// Adapts to what's actually in the jar: empty means no "open" language at
// all (invites a first drop instead), 1-2 entries reveals just those, 3+
// reveals exactly 3 random ones — the spec's own graceful-degradation rule.
export function JarOpeningModal({ open, onClose, gratitudes }: JarOpeningModalProps) {
  const { t } = useTranslation()
  const [stage, setStage] = useState<Stage>("prompt")
  const [revealIndex, setRevealIndex] = useState(0)

  const picked = useMemo(() => shuffle(gratitudes).slice(0, Math.min(3, gratitudes.length)), [gratitudes])

  useEffect(() => {
    if (open) {
      setStage("prompt")
      setRevealIndex(0)
    }
  }, [open])

  function handleOpenJar() {
    setStage("revealing")
    setRevealIndex(0)
  }

  function handleNext() {
    if (revealIndex + 1 < picked.length) {
      setRevealIndex((i) => i + 1)
    } else {
      setStage("closing")
    }
  }

  const isEmpty = gratitudes.length === 0

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm border-0 bg-secondary shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
        {stage === "prompt" && isEmpty && (
          <>
            <DialogHeader className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-popover shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                <JarIcon className="h-6 w-6 text-primary" />
              </div>
              <DialogTitle className="font-heading text-lg font-semibold">{t("jar.empty_invite_title")}</DialogTitle>
              <DialogDescription className="mt-2 text-sm text-foreground/80 leading-relaxed">
                {t("jar.empty_invite_body")}
              </DialogDescription>
            </DialogHeader>
            <Button variant="ghost" onClick={onClose} className="mt-4 w-full text-muted-foreground hover:text-foreground">
              {t("jar.close")}
            </Button>
          </>
        )}

        {stage === "prompt" && !isEmpty && (
          <>
            <DialogHeader className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-popover shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                <JarIcon className="h-6 w-6 text-primary" />
              </div>
              <DialogTitle className="font-heading text-lg font-semibold">{t("jar.prompt_title")}</DialogTitle>
              <DialogDescription className="mt-2 text-sm text-foreground/80 leading-relaxed">
                {t("jar.prompt_body")}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 flex flex-col gap-3">
              <Button onClick={handleOpenJar} className="w-full">
                {t("jar.prompt_yes")}
              </Button>
              <Button variant="ghost" onClick={onClose} className="w-full text-muted-foreground hover:text-foreground">
                {t("jar.prompt_not_now")}
              </Button>
            </div>
          </>
        )}

        {stage === "revealing" && picked[revealIndex] && (
          <div className="animate-in fade-in zoom-in-95 duration-300 text-center py-4">
            <JarIcon className="mx-auto mb-4 h-10 w-10 text-primary" />
            <p className="font-heading text-base italic leading-relaxed text-foreground/90">
              &#8220;{picked[revealIndex].text}&#8221;
            </p>
            <Button onClick={handleNext} className="mt-6 w-full">
              {revealIndex + 1 < picked.length ? t("jar.reveal_next") : t("jar.reveal_finish")}
            </Button>
          </div>
        )}

        {stage === "closing" && (
          <div className="animate-in fade-in duration-500 text-center py-4">
            <p className="font-heading text-base italic leading-relaxed text-foreground/90">
              {t("jar.closing_message")}
            </p>
            <Button onClick={onClose} className="mt-6 w-full">
              {t("jar.close")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

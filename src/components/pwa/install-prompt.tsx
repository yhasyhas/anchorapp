import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Anchor, Share, X } from "lucide-react"
import { Button } from "@/components/ui/button"

// Shown at most once ever, regardless of outcome — set as soon as the card is
// displayed so it never reappears on a later visit ("plus tard" just closes it).
const PROMPTED_KEY = "anchor_pwa_install_prompted"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  )
}

// Safari never fires beforeinstallprompt, so without this branch iOS users —
// roughly half of the mobile audience — would never see any install nudge at
// all. There's no programmatic install API there; the only path is the
// Share-sheet "Add to Home Screen" action, so we can only point at it.
function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !isStandalone()
}

export function InstallPrompt() {
  const { t } = useTranslation()
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIOSInstructions, setShowIOSInstructions] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(PROMPTED_KEY) || isStandalone()) return

    if (isIOS()) {
      setShowIOSInstructions(true)
      return
    }

    function handler(e: Event) {
      e.preventDefault()
      if (localStorage.getItem(PROMPTED_KEY)) return
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener("beforeinstallprompt", handler)
    return () => window.removeEventListener("beforeinstallprompt", handler)
  }, [])

  function dismiss() {
    localStorage.setItem(PROMPTED_KEY, "1")
    setDeferredPrompt(null)
    setShowIOSInstructions(false)
  }

  async function install() {
    if (!deferredPrompt) return
    localStorage.setItem(PROMPTED_KEY, "1")
    await deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
  }

  if (!deferredPrompt && !showIOSInstructions) return null

  return (
    <div className="fixed inset-x-4 top-4 z-30 mx-auto max-w-sm rounded-2xl bg-secondary p-4 shadow-[0_4px_20px_rgba(0,0,0,0.08)] animate-in slide-in-from-top-4 fade-in">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sage-light">
          <Anchor className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">{t("pwa.install_title")}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {showIOSInstructions ? (
              <>
                {t("pwa.install_ios_message")}{" "}
                <Share className="inline h-3.5 w-3.5 -translate-y-px text-muted-foreground" />
              </>
            ) : (
              t("pwa.install_message")
            )}
          </p>
          <div className="mt-3 flex gap-2">
            {showIOSInstructions ? (
              <Button size="sm" variant="ghost" onClick={dismiss} className="flex-1 text-muted-foreground">
                {t("pwa.install_got_it")}
              </Button>
            ) : (
              <>
                <Button size="sm" onClick={install} className="flex-1">
                  {t("pwa.install_cta")}
                </Button>
                <Button size="sm" variant="ghost" onClick={dismiss} className="flex-1 text-muted-foreground">
                  {t("pwa.install_later")}
                </Button>
              </>
            )}
          </div>
        </div>
        <button
          onClick={dismiss}
          aria-label={t("pwa.install_later")}
          className="shrink-0 text-muted-foreground/60 hover:text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

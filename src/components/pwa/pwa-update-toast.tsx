import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useRegisterSW } from "virtual:pwa-register/react"

// Checked hourly so a tab left open for days still notices a new deploy —
// registration alone only checks once, on load.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

export function PwaUpdateToast() {
  const { t } = useTranslation()

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return
      setInterval(() => {
        registration.update()
      }, UPDATE_CHECK_INTERVAL_MS)
    },
  })

  useEffect(() => {
    if (!needRefresh) return

    toast(t("pwa.update_available"), {
      duration: Infinity,
      action: {
        label: t("pwa.update_reload"),
        onClick: () => updateServiceWorker(true),
      },
    })
  }, [needRefresh, t, updateServiceWorker])

  return null
}

import { useTranslation } from "react-i18next"
import { Check, X } from "lucide-react"

// Shared by the pending-received card in Settings and the /circle/invite/:token
// landing page, so "explain what's shared before the button" holds for both
// acceptance paths, not just the emailed-token one.
export function CircleShareExplainer() {
  const { t } = useTranslation()

  return (
    <div className="space-y-3 rounded-lg bg-muted/60 p-4">
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Check className="h-3.5 w-3.5 text-primary" />
          {t("circle.explainer_shares_title")}
        </p>
        <ul className="ml-5 list-disc space-y-0.5 text-xs text-muted-foreground">
          <li>{t("circle.explainer_shares_1")}</li>
          <li>{t("circle.explainer_shares_2")}</li>
        </ul>
      </div>
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
          <X className="h-3.5 w-3.5 text-muted-foreground" />
          {t("circle.explainer_never_title")}
        </p>
        <ul className="ml-5 list-disc space-y-0.5 text-xs text-muted-foreground">
          <li>{t("circle.explainer_never_1")}</li>
          <li>{t("circle.explainer_never_2")}</li>
          <li>{t("circle.explainer_never_3")}</li>
        </ul>
      </div>
    </div>
  )
}

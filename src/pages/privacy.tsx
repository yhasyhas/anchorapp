import { useEffect } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowLeft, Anchor } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

const SECTION_KEYS = [
  "collect",
  "protected",
  "never_sold",
  "ai",
  "control",
] as const

export function PrivacyPage() {
  const { t } = useTranslation()

  useEffect(() => {
    document.title = t("privacy.page_title")
  }, [t])

  return (
    <div className="min-h-svh bg-background px-6 py-8">
      <div className="mx-auto max-w-lg space-y-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          {t("privacy.back")}
        </Link>

        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sage-light">
            <Anchor className="h-6 w-6 text-primary" />
          </div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">{t("privacy.title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("privacy.intro")}</p>
        </div>

        <div className="space-y-4">
          {SECTION_KEYS.map((key) => (
            <Card key={key} className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
              <CardContent className="p-5">
                <h2 className="font-heading text-base font-semibold text-foreground">
                  {t(`privacy.${key}_title`)}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(`privacy.${key}_body`)}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          {t("privacy.contact_line")}{" "}
          <a href="mailto:santilsndiaye@gmail.com" className="underline-offset-4 hover:underline">
            santilsndiaye@gmail.com
          </a>
        </p>

        <div className="flex justify-center pb-4">
          <Button asChild variant="outline">
            <Link to="/">{t("privacy.back_home")}</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

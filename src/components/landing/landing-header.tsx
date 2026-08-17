import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Anchor } from "lucide-react"
import { Button } from "@/components/ui/button"

// Logo left / Sign in right, per anchor-web-spec.md section 5 — no h1 here,
// the page's only h1 is the hero quote below (HeroSection).
export function LandingHeader() {
  const { t } = useTranslation()

  return (
    <header className="flex items-center justify-between px-6 py-5">
      <div className="flex items-center gap-2">
        <Anchor className="h-5 w-5 text-primary" />
        <span className="font-heading text-lg font-semibold text-foreground">Anchor</span>
      </div>
      <Button asChild variant="outline" size="sm" className="border-primary/30 text-primary hover:bg-primary/5">
        <Link to="/login">{t("landing.header_signin")}</Link>
      </Button>
    </header>
  )
}

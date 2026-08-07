import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"

export function LandingFooter() {
  const { t, i18n } = useTranslation()

  return (
    <footer className="border-t border-border/60 px-6 py-8 text-center">
      <div className="mx-auto flex max-w-md flex-col items-center gap-4">
        <div className="flex gap-3 text-xs">
          <button
            onClick={() => i18n.changeLanguage("en")}
            className={i18n.language === "en" ? "font-semibold text-foreground" : "text-muted-foreground"}
          >
            English
          </button>
          <span className="text-muted-foreground/50">·</span>
          <button
            onClick={() => i18n.changeLanguage("sw")}
            className={i18n.language === "sw" ? "font-semibold text-foreground" : "text-muted-foreground"}
          >
            Kiswahili
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <a href="mailto:santilsndiaye@gmail.com" className="hover:text-foreground hover:underline">
            {t("landing.footer_contact")}
          </a>
          <Link to="/privacy" className="hover:text-foreground hover:underline">
            {t("landing.footer_privacy")}
          </Link>
        </div>

        <p className="text-xs text-muted-foreground/70">
          {t("landing.footer_copyright", { year: new Date().getFullYear() })}
        </p>
      </div>
    </footer>
  )
}

import { useTranslation } from "react-i18next"
import { Sun, Moon, Monitor } from "lucide-react"
import { useTheme } from "@/components/theme-provider"

const options = [
  { value: "light" as const, icon: Sun, labelKey: "settings.theme_light" },
  { value: "dark" as const, icon: Moon, labelKey: "settings.theme_dark" },
  { value: "system" as const, icon: Monitor, labelKey: "settings.theme_system" },
]

export function ModeToggle() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex gap-3">
      {options.map(({ value, icon: Icon, labelKey }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          aria-pressed={theme === value}
          className={`flex flex-1 flex-col items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
            theme === value
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground"
          }`}
        >
          <Icon className="h-4 w-4" />
          {t(labelKey)}
        </button>
      ))}
    </div>
  )
}

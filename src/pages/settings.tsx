import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { ArrowLeft } from "lucide-react"

export function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { profile, updateProfile, signOut, user } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState(profile?.full_name ?? "")

  async function handleLanguageChange(lang: "en" | "sw") {
    i18n.changeLanguage(lang)
    await updateProfile({ preferred_language: lang })
  }

  async function handleNameSave() {
    await updateProfile({ full_name: name })
  }

  async function handleExport() {
    if (!user) return
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const since = thirtyDaysAgo.toISOString().split("T")[0]

    const [anchors, moods, checkIns] = await Promise.all([
      supabase.from("daily_anchors").select("*").eq("user_id", user.id).gte("date", since),
      supabase.from("mood_logs").select("*").eq("user_id", user.id).gte("date", since),
      supabase.from("check_ins").select("*").eq("user_id", user.id).gte("date", since),
    ])

    const exportData = {
      exported_at: new Date().toISOString(),
      anchors: anchors.data,
      moods: moods.data,
      check_ins: checkIns.data,
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "anchor-journal-export.json"
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleLogout() {
    await signOut()
    navigate("/login")
  }

  return (
    <div className="min-h-svh bg-background px-6 py-6">
      <div className="mx-auto max-w-lg space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="font-heading text-2xl font-bold">{t("settings.title")}</h1>
        </div>

        {/* Language */}
        <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <CardContent className="p-5">
            <Label className="mb-3 block text-sm font-medium">{t("settings.language")}</Label>
            <div className="flex gap-3">
              <button
                onClick={() => handleLanguageChange("en")}
                className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                  i18n.language === "en"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                English
              </button>
              <button
                onClick={() => handleLanguageChange("sw")}
                className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                  i18n.language === "sw"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                Kiswahili
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Profile */}
        <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <CardContent className="p-5">
            <Label className="mb-3 block text-sm font-medium">{t("settings.name")}</Label>
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button onClick={handleNameSave} size="sm">
                Save
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Export */}
        <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <CardContent className="p-5">
            <Button variant="outline" className="w-full" onClick={handleExport}>
              {t("settings.export")}
            </Button>
          </CardContent>
        </Card>

        {/* About */}
        <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <CardContent className="p-5">
            <p className="text-sm font-medium">{t("settings.about")}</p>
            <Separator className="my-3" />
            <p className="text-sm text-muted-foreground">{t("settings.about_text")}</p>
          </CardContent>
        </Card>

        {/* Logout */}
        <Button variant="ghost" className="w-full text-destructive" onClick={handleLogout}>
          {t("settings.logout")}
        </Button>
      </div>
    </div>
  )
}

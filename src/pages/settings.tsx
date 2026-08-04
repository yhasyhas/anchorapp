import { useState, type MouseEvent as ReactMouseEvent } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { ModeToggle } from "@/components/mode-toggle"
import { RemindersSection } from "@/components/settings/reminders-section"
import { JournalExportSection } from "@/components/settings/journal-export-section"
import { ToneSection } from "@/components/settings/tone-section"
import { SoftModeSection } from "@/components/settings/soft-mode-section"
import { CircleSection } from "@/components/settings/circle-section"
import { ArrowLeft, Brain } from "lucide-react"

export function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { profile, updateProfile, signOut, deleteAccount, user } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState(profile?.full_name ?? "")
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [deleting, setDeleting] = useState(false)
  const canConfirmDelete = !!user?.email && deleteConfirmText.trim().toLowerCase() === user.email.toLowerCase()

  // Préférences IA stockées en base (profiles.ai_enabled / ai_checkins_enabled) plutôt
  // qu'en localStorage : elles suivent le compte d'un appareil à l'autre, comme le reste
  // du profil.
  const aiEnabled = profile?.ai_enabled ?? false
  const aiCheckIns = profile?.ai_checkins_enabled ?? false

  async function handleLanguageChange(lang: "en" | "sw") {
    i18n.changeLanguage(lang)
    await updateProfile({ preferred_language: lang })
  }

  async function handleNameSave() {
    await updateProfile({ full_name: name })
  }

  async function handleAiToggle(enabled: boolean) {
    // Désactiver l'IA désactive aussi le partage des check-ins avec elle
    await updateProfile(enabled ? { ai_enabled: true } : { ai_enabled: false, ai_checkins_enabled: false })
  }

  async function handleAiCheckInsToggle(enabled: boolean) {
    await updateProfile({ ai_checkins_enabled: enabled })
  }

  // Full-history export across every table that holds her own written/logged
  // content — not just the last 30 days used by the PDF keepsake above. Left
  // out: Circle of Trust tables (memberships, invites, encouragements, SOS)
  // are relationship data involving other users' rows, not a diary of hers.
  async function handleExport() {
    if (!user) return

    const [anchors, moods, checkIns, gratitudes, journalEntries, weeklyLetters, monthlyRecaps, moveSuggestions, insightLog] =
      await Promise.all([
        supabase.from("daily_anchors").select("*").eq("user_id", user.id),
        supabase.from("mood_logs").select("*").eq("user_id", user.id),
        supabase.from("check_ins").select("*").eq("user_id", user.id),
        supabase.from("gratitudes").select("*").eq("user_id", user.id),
        supabase.from("journal_entries").select("*").eq("user_id", user.id),
        supabase.from("weekly_letters").select("*").eq("user_id", user.id),
        supabase.from("monthly_recaps").select("*").eq("user_id", user.id),
        supabase.from("move_suggestions").select("*").eq("user_id", user.id),
        supabase.from("insight_log").select("*").eq("user_id", user.id),
      ])

    const exportData = {
      exported_at: new Date().toISOString(),
      profile,
      anchors: anchors.data,
      moods: moods.data,
      check_ins: checkIns.data,
      gratitudes: gratitudes.data,
      journal_entries: journalEntries.data,
      weekly_letters: weeklyLetters.data,
      monthly_recaps: monthlyRecaps.data,
      move_suggestions: moveSuggestions.data,
      insight_log: insightLog.data,
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "anchor-data-export.json"
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleLogout() {
    await signOut()
    navigate("/login")
  }

  // preventDefault: AlertDialogAction closes the dialog on click by default,
  // but this is async and must stay open on failure so she can see the
  // error and retry rather than silently landing back on a dialog-free page.
  async function handleDeleteAccount(e: ReactMouseEvent) {
    e.preventDefault()
    if (!canConfirmDelete || deleting) return
    setDeleting(true)
    try {
      await deleteAccount()
      toast.success(t("settings.danger_delete_success"))
      navigate("/login")
    } catch {
      toast.error(t("settings.danger_delete_error"))
      setDeleting(false)
    }
  }

  return (
    <div className="min-h-svh bg-background px-6 py-6">
      <div className="mx-auto max-w-lg space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")} aria-label={t("settings.back")}>
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

        {/* Appearance */}
        <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <CardContent className="p-5">
            <Label className="mb-3 block text-sm font-medium">{t("settings.theme")}</Label>
            <ModeToggle />
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
                {t("settings.save")}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* AI Insights Settings */}
        <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <CardContent className="p-5 space-y-5">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium">{t("settings.ai_title")}</p>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-sm text-foreground">{t("settings.ai_enable")}</p>
                <p className="text-xs text-muted-foreground">{t("settings.ai_enable_desc")}</p>
              </div>
              <Switch
                checked={aiEnabled}
                onCheckedChange={handleAiToggle}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-sm text-foreground">{t("settings.ai_checkins")}</p>
                <p className="text-xs text-muted-foreground">{t("settings.ai_checkins_desc")}</p>
              </div>
              <Switch
                checked={aiCheckIns}
                onCheckedChange={handleAiCheckInsToggle}
                disabled={!aiEnabled}
              />
            </div>

            {!import.meta.env.VITE_GROQ_API_KEY && (
              <div className="rounded-lg bg-muted/60 p-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t("settings.ai_no_key")}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Soft Mode */}
        <SoftModeSection />

        {/* Tone */}
        <ToneSection />

        {/* Circle of Trust */}
        <CircleSection />

        {/* Reminders */}
        <RemindersSection />

        {/* Anchor Journal PDF export */}
        <JournalExportSection />

        {/* Raw JSON export */}
        <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <CardContent className="p-5">
            <Button variant="outline" className="w-full" onClick={handleExport}>
              {t("settings.export_json")}
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

        {/* Danger Zone */}
        <Card className="border border-destructive/20 shadow-none">
          <CardContent className="p-5 space-y-3">
            <p className="text-sm font-medium text-destructive">{t("settings.danger_title")}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{t("settings.danger_delete_desc")}</p>
            <AlertDialog
              open={deleteDialogOpen}
              onOpenChange={(open) => {
                setDeleteDialogOpen(open)
                if (!open) setDeleteConfirmText("")
              }}
            >
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="w-full border-destructive/40 text-destructive hover:bg-destructive/10">
                  {t("settings.danger_delete_button")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("settings.danger_delete_title")}</AlertDialogTitle>
                  <AlertDialogDescription>{t("settings.danger_delete_confirm_desc")}</AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-2 text-left">
                  <Label htmlFor="delete-confirm-email" className="text-xs text-muted-foreground">
                    {t("settings.danger_delete_confirm_label", { email: user?.email ?? "" })}
                  </Label>
                  <Input
                    id="delete-confirm-email"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("settings.danger_delete_cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteAccount}
                    disabled={!canConfirmDelete || deleting}
                    className="bg-destructive text-white hover:bg-destructive/90"
                  >
                    {deleting ? t("settings.danger_delete_deleting") : t("settings.danger_delete_confirm_action")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}


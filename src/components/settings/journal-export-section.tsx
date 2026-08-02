import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { BookHeart, Loader2 } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { fetchMonthlyJournalData } from "@/lib/pdf/data"
import { downloadMonthlyJournalPdf } from "@/lib/pdf/generate-monthly-journal"
import { localDateStr } from "@/lib/utils"

function currentMonthIso(): string {
  return localDateStr().slice(0, 7)
}

export function JournalExportSection() {
  const { t, i18n } = useTranslation()
  const { user, profile } = useAuth()
  const [month, setMonth] = useState(currentMonthIso())
  const [generating, setGenerating] = useState(false)

  async function handleDownload() {
    if (!user || generating) return
    setGenerating(true)
    try {
      const firstName = profile?.full_name?.split(" ")[0] ?? ""
      const lang = i18n.language === "sw" ? "sw" : "en"
      const data = await fetchMonthlyJournalData(user.id, month, firstName, lang)
      await downloadMonthlyJournalPdf(data, t, month)
      toast.success(t("settings.export_success"))
    } catch (err) {
      console.error("Failed to generate monthly journal PDF:", err)
      toast.error(t("settings.export_error"))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <BookHeart className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">{t("settings.export")}</p>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{t("settings.export_desc")}</p>

        <div>
          <Label htmlFor="journal-export-month" className="mb-1.5 block text-xs text-muted-foreground">
            {t("settings.export_month_label")}
          </Label>
          <Input
            id="journal-export-month"
            type="month"
            value={month}
            max={currentMonthIso()}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>

        <Button className="w-full" onClick={handleDownload} disabled={generating}>
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {generating ? t("settings.export_generating") : t("settings.export_cta")}
        </Button>
      </CardContent>
    </Card>
  )
}

import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { addToSyncQueue, isOnline, setLocalData, getLocalData } from "@/lib/offline-sync"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Heart, Moon } from "lucide-react"
import type { CheckIn } from "@/types"

function todayStr(): string {
  return new Date().toISOString().split("T")[0]
}

export function CheckInPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [checkIn, setCheckIn] = useState<Partial<CheckIn>>({
    what_matters: "",
    what_avoiding: "",
    what_felt_real: "",
    evening_release: "",
  })
  const [saved, setSaved] = useState(false)
  const [released, setReleased] = useState(false)

  useEffect(() => {
    if (user) loadCheckIn()
  }, [user])

  async function loadCheckIn() {
    if (!user) return
    const localKey = `checkin_${user.id}_${todayStr()}`
    const cached = getLocalData<Partial<CheckIn>>(localKey)

    if (isOnline()) {
      const { data } = await supabase
        .from("check_ins")
        .select("*")
        .eq("user_id", user.id)
        .eq("date", todayStr())
        .maybeSingle()

      if (data) {
        setCheckIn(data)
        setLocalData(localKey, data)
      } else if (cached) {
        setCheckIn(cached)
      }
    } else if (cached) {
      setCheckIn(cached)
    }
  }

  async function handleSave() {
    if (!user) return

    const record = {
      user_id: user.id,
      date: todayStr(),
      what_matters: checkIn.what_matters ?? "",
      what_avoiding: checkIn.what_avoiding ?? "",
      what_felt_real: checkIn.what_felt_real ?? "",
      evening_release: checkIn.evening_release ?? "",
    }

    const localKey = `checkin_${user.id}_${todayStr()}`
    setLocalData(localKey, record)

    if (isOnline()) {
      await supabase.from("check_ins").upsert(record, { onConflict: "user_id,date" })
    } else {
      addToSyncQueue({ table: "check_ins", action: "upsert", data: record, conflictKey: "user_id,date" })
    }

    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleRelease() {
    setReleased(true)
    setCheckIn((prev) => ({ ...prev, evening_release: new Date().toISOString() }))
    setTimeout(() => setReleased(false), 3000)
  }

  function updateField(field: keyof CheckIn, value: string) {
    setCheckIn((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Heart className="h-5 w-5 text-primary" />
          <h1 className="font-heading text-2xl font-bold">{t("checkin.title")}</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t("checkin.subtitle")}</p>
      </div>

      {/* Reflection Cards */}
      <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="p-5">
          <div className="mb-2 flex items-center gap-2">
            <span>&#x1F33F;</span>
            <p className="text-sm font-medium text-foreground">{t("checkin.what_matters")}</p>
          </div>
          <Textarea
            value={checkIn.what_matters ?? ""}
            onChange={(e) => updateField("what_matters", e.target.value)}
            placeholder="..."
            className="min-h-[80px] border-0 bg-muted/50 shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
          />
        </CardContent>
      </Card>

      <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="p-5">
          <div className="mb-2 flex items-center gap-2">
            <span>&#x2601;&#xFE0F;</span>
            <p className="text-sm font-medium text-foreground">{t("checkin.what_avoiding")}</p>
          </div>
          <Textarea
            value={checkIn.what_avoiding ?? ""}
            onChange={(e) => updateField("what_avoiding", e.target.value)}
            placeholder="..."
            className="min-h-[80px] border-0 bg-muted/50 shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
          />
        </CardContent>
      </Card>

      <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="p-5">
          <div className="mb-2 flex items-center gap-2">
            <span>&#x1F338;</span>
            <p className="text-sm font-medium text-foreground">{t("checkin.what_felt_real")}</p>
          </div>
          <Textarea
            value={checkIn.what_felt_real ?? ""}
            onChange={(e) => updateField("what_felt_real", e.target.value)}
            placeholder="..."
            className="min-h-[80px] border-0 bg-muted/50 shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
          />
        </CardContent>
      </Card>

      {/* Evening Release */}
      <Card className="border-0 bg-secondary shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="p-5 text-center">
          <Moon className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
          <p className="font-heading text-sm italic text-foreground/80">
            {t("checkin.evening_release")}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRelease}
            disabled={released}
            className="mt-3 border-primary/20 text-primary"
          >
            {released ? "\u2713" : ""} {t("checkin.release_button")}
          </Button>
        </CardContent>
      </Card>

      {/* Save */}
      <Button onClick={handleSave} className="w-full" size="lg">
        {saved ? t("checkin.saved") : t("checkin.save")}
      </Button>
    </div>
  )
}

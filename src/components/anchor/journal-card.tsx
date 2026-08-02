import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { addToSyncQueue, isOnline, setLocalData, getLocalData } from "@/lib/offline-sync"
import { getDailyJournalQuestion } from "@/lib/journal-questions"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Feather, Pencil } from "lucide-react"
import { toast } from "sonner"
import { todayStr } from "@/lib/utils"
import type { JournalEntry } from "@/types"

const MAX_LENGTH = 200

export function JournalCard() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const [sentence, setSentence] = useState("")
  const [savedSentence, setSavedSentence] = useState("")
  const [editing, setEditing] = useState(true)
  const [loading, setLoading] = useState(true)
  const [justSaved, setJustSaved] = useState(false)

  const question = user
    ? getDailyJournalQuestion(user.id, todayStr(), i18n.language as "en" | "sw")
    : ""

  useEffect(() => {
    if (user) loadEntry()
  }, [user])

  async function loadEntry() {
    if (!user) return
    try {
      const localKey = `journal_${user.id}_${todayStr()}`
      const cached = getLocalData<JournalEntry>(localKey)

      if (isOnline()) {
        const { data, error } = await supabase
          .from("journal_entries")
          .select("*")
          .eq("user_id", user.id)
          .eq("date", todayStr())
          .maybeSingle()

        if (error) throw error

        if (data) {
          applyEntry(data.sentence)
          setLocalData(localKey, data)
        } else if (cached) {
          applyEntry(cached.sentence)
        }
      } else if (cached) {
        applyEntry(cached.sentence)
      }
    } catch (err: any) {
      console.error("Failed to load journal entry:", err)
      toast.error(t("journal.error_load"))
    } finally {
      setLoading(false)
    }
  }

  function applyEntry(text: string) {
    setSentence(text)
    setSavedSentence(text)
    setEditing(!text)
  }

  async function handleSave() {
    if (!user || !sentence.trim()) return

    const trimmed = sentence.trim()
    const record = {
      user_id: user.id,
      date: todayStr(),
      sentence: trimmed,
    }

    const localKey = `journal_${user.id}_${todayStr()}`
    setLocalData(localKey, record)

    try {
      if (isOnline()) {
        const { error } = await supabase
          .from("journal_entries")
          .upsert(record, { onConflict: "user_id,date" })
        if (error) throw error
      } else {
        addToSyncQueue(user.id, {
          table: "journal_entries",
          action: "upsert",
          data: record,
          conflictKey: "user_id,date",
        })
      }

      setSavedSentence(trimmed)
      setSentence(trimmed)
      setEditing(false)
      setJustSaved(true)
      toast.success(t("journal.saved"))
      setTimeout(() => setJustSaved(false), 2000)
    } catch (err: any) {
      console.error("Failed to save journal entry:", err)
      toast.error(t("journal.error_save"))
    }
  }

  function startEditing() {
    setSentence(savedSentence)
    setEditing(true)
  }

  if (loading) return null

  return (
    <Card
      className={`border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-colors duration-700 ${
        justSaved ? "bg-sage-light/50" : "bg-card"
      }`}
    >
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Feather className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold text-foreground">{t("journal.title")}</p>
          </div>
          {!editing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={startEditing}
              className="gap-1.5 text-xs text-muted-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
              {t("journal.edit")}
            </Button>
          )}
        </div>

        {editing ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{question}</p>
            <Textarea
              value={sentence}
              onChange={(e) => setSentence(e.target.value.slice(0, MAX_LENGTH))}
              placeholder={t("journal.placeholder")}
              maxLength={MAX_LENGTH}
              rows={2}
              className="min-h-0 resize-none border-0 bg-muted/50 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                {t("journal.char_count", { count: sentence.length, max: MAX_LENGTH })}
              </span>
              <Button size="sm" onClick={handleSave} disabled={!sentence.trim()} className="text-xs">
                {t("journal.save")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm italic text-foreground/90 leading-relaxed">&#8220;{savedSentence}&#8221;</p>
        )}
      </CardContent>
    </Card>
  )
}

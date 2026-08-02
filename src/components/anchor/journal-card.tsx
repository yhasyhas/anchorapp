import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { addToSyncQueue, isOnline, setLocalData, getLocalData } from "@/lib/offline-sync"
import { getDailyJournalQuestion } from "@/lib/journal-questions"
import { transcribeAudio } from "@/lib/transcribe"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Feather, Pencil, Mic, Square, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { todayStr } from "@/lib/utils"
import type { JournalEntry } from "@/types"

const MAX_LENGTH = 200
// Journal entries are one sentence — a much shorter cap than the check-in's
// 60s voice note, since this is meant to be spoken as quickly as it's typed.
const MAX_RECORDING_SECONDS = 25

export function JournalCard() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const [sentence, setSentence] = useState("")
  const [savedSentence, setSavedSentence] = useState("")
  const [editing, setEditing] = useState(true)
  const [loading, setLoading] = useState(true)
  const [justSaved, setJustSaved] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [transcribingVoice, setTranscribingVoice] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  // Speak the sentence instead of typing it — no audio is ever stored (unlike
  // the check-in voice note), the recording is transient and discarded the
  // moment its transcript lands in the text field, editable before saving.
  async function startVoiceEntry() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" })
        setTranscribingVoice(true)
        const text = await transcribeAudio(blob)
        setTranscribingVoice(false)
        if (text) setSentence(text.slice(0, MAX_LENGTH))
      }

      mediaRecorder.start()
      setIsRecording(true)

      let elapsed = 0
      timerRef.current = setInterval(() => {
        elapsed++
        if (elapsed >= MAX_RECORDING_SECONDS) stopVoiceEntry()
      }, 1000)
    } catch (err) {
      console.error("Microphone access denied or error:", err)
      toast.error(t("journal.mic_permission_denied"))
    }
  }

  function stopVoiceEntry() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      if (timerRef.current) clearInterval(timerRef.current)
    }
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
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {t("journal.char_count", { count: sentence.length, max: MAX_LENGTH })}
                </span>
                {transcribingVoice && (
                  <span className="flex items-center gap-1 text-[10px] italic text-muted-foreground">
                    <Sparkles className="h-3 w-3 animate-pulse text-primary" />
                    {t("journal.transcribing")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={isRecording ? stopVoiceEntry : startVoiceEntry}
                  disabled={transcribingVoice}
                  aria-label={t("journal.record_voice")}
                  className={`flex h-7 w-7 items-center justify-center rounded-full transition-all ${
                    isRecording
                      ? "animate-pulse bg-destructive text-white dark:text-background"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {isRecording ? <Square className="h-3 w-3" /> : <Mic className="h-3.5 w-3.5" />}
                </button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!sentence.trim() || isRecording || transcribingVoice}
                  className="text-xs"
                >
                  {t("journal.save")}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm italic text-foreground/90 leading-relaxed">&#8220;{savedSentence}&#8221;</p>
        )}
      </CardContent>
    </Card>
  )
}

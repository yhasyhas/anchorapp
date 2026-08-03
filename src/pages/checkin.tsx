import { useEffect, useState, useRef, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { addToSyncQueue, isOnline, setLocalData, getLocalData } from "@/lib/offline-sync"
import { getDailyQuestions, getSoftModeQuestion } from "@/lib/checkin-questions"
import { transcribeAudio } from "@/lib/transcribe"
import { generateFollowUpQuestion, type FollowUpEntry } from "@/lib/ai-service"
import { getQuickReplyChips } from "@/lib/checkin-chips"
import { addGratitude } from "@/lib/gratitude"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Heart, Moon, Mic, Square, Play, Trash2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { moodConfig } from "@/lib/constants"
import { isCheckInTime, todayStr, localDateStr } from "@/lib/utils"
import type { CheckIn, DailyAnchor } from "@/types"
import { EveningReleaseAnimation } from "@/components/anchor/evening-release-animation"

function daysAgoStr(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return localDateStr(d)
}

function moodNoteBucket(mood: string): "heavy" | "good" | "neutral" {
  if (mood === "low" || mood === "stressed") return "heavy"
  if (mood === "great" || mood === "okay") return "good"
  return "neutral"
}

// Merges the last 7 days of check-ins/journal/anchors into one entry per
// date, dropping days with nothing textual at all — this is the payload
// handed to generateFollowUpQuestion, and the ONLY source of "recent
// history" it ever sees, which is what keeps the personalized question from
// ever referencing anything older than 7 days.
function buildFollowUpEntries(
  checkIns: Partial<CheckIn>[],
  journal: { date: string; sentence: string }[],
  anchors: Partial<DailyAnchor>[]
): FollowUpEntry[] {
  const byDate = new Map<string, FollowUpEntry>()

  function entryFor(date: string): FollowUpEntry {
    let e = byDate.get(date)
    if (!e) {
      e = { date }
      byDate.set(date, e)
    }
    return e
  }

  for (const c of checkIns) {
    if (!c.date) continue
    const e = entryFor(c.date)
    if (c.what_matters) e.whatMatters = c.what_matters
    if (c.what_avoiding) e.whatAvoiding = c.what_avoiding
    if (c.what_felt_real) e.whatFeltReal = c.what_felt_real
    if (c.evening_mood) e.eveningMood = c.evening_mood
    if (c.evening_mood_note) e.eveningMoodNote = c.evening_mood_note
    if (c.voice_transcript) e.voiceTranscript = c.voice_transcript
  }
  for (const j of journal) {
    if (!j.date || !j.sentence) continue
    entryFor(j.date).journalSentence = j.sentence
  }
  for (const a of anchors) {
    if (!a.date) continue
    const taskText = [a.future_task, a.mindbody_task, a.life_task].filter(Boolean).join("; ")
    if (taskText) entryFor(a.date).anchorText = taskText
    if (a.daily_intention) entryFor(a.date).intention = a.daily_intention
  }

  return Array.from(byDate.values())
    .filter((e) => Object.keys(e).length > 1)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7)
}

const SIGNED_URL_TTL_SECONDS = 60 * 60 // 1h — plenty for a single viewing session; reloading gets a fresh one

// Handles both the new bare-path format (`${userId}/${date}.webm`) and any
// legacy full-URL value that might still be sitting in an old row — extracts
// just the storage path either way so it can be re-signed.
function extractVoiceNotePath(stored: string): string {
  const marker = "/voice-notes/"
  const idx = stored.indexOf(marker)
  return idx >= 0 ? stored.slice(idx + marker.length) : stored
}

export function CheckInPage() {
  const { t, i18n } = useTranslation()
  const { user, profile } = useAuth()
  const [checkIn, setCheckIn] = useState<Partial<CheckIn>>({
    what_matters: "",
    what_avoiding: "",
    what_felt_real: "",
    evening_release: "",
    evening_mood: "",
    evening_mood_note: "",
    voice_transcript: "",
  })
  const [saved, setSaved] = useState(false)
  const [jarAdded, setJarAdded] = useState(false)
  const [addingToJar, setAddingToJar] = useState(false)
  const [released, setReleased] = useState(false)

  const [dailyQuestions, setDailyQuestions] = useState<[string, string]>(["", ""])
  const [personalQuestion, setPersonalQuestion] = useState<string | null>(null)
  const [recentCheckIns, setRecentCheckIns] = useState<Partial<CheckIn>[]>([])

  const [isRecording, setIsRecording] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [transcribing, setTranscribing] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (user) {
      loadDailyQuestions()
      // Chained, not parallel: loadPersonalizedQuestion needs to know whether
      // today's row already has a resolved personal_question (set by this
      // device earlier, or by another device entirely) before deciding
      // whether to generate one — same reasoning as home.tsx chaining
      // loadContextData off loadTodayData's resolved value rather than
      // reading React state, which wouldn't have committed yet.
      loadCheckIn().then((loaded) => loadPersonalizedQuestion(loaded))
    }
  }, [user])

  function loadDailyQuestions() {
    if (!user) return
    const key = `anchor_checkin_qs_${user.id}_${todayStr()}`
    const cached = getLocalData<[string, string]>(key)

    if (cached && cached[0] && cached[1]) {
      setDailyQuestions(cached)
    } else {
      const qs = getDailyQuestions(user.id, todayStr(), i18n.language as "en" | "sw")
      setLocalData(key, qs)
      setDailyQuestions(qs)
    }
  }

  // Resolved server-side now (check_ins.personal_question), not a per-device
  // localStorage cache — a null/undefined column means "not yet attempted by
  // ANY device today"; an empty string means "attempted, resolved to no
  // personalization"; either way, once one device resolves it, every other
  // device sees the same answer instead of each generating its own. Also
  // fetches the same 7-day window the quick-reply chips render from,
  // regardless of whether a personalized question ends up existing for today.
  async function loadPersonalizedQuestion(existingCheckIn?: Partial<CheckIn>) {
    if (!user) return

    try {
      const since = daysAgoStr(6)
      const [{ data: checkIns }, { data: journal }, { data: anchors }] = await Promise.all([
        supabase
          .from("check_ins")
          .select("date, what_matters, what_avoiding, what_felt_real, evening_mood, evening_mood_note, voice_transcript")
          .eq("user_id", user.id)
          .gte("date", since),
        supabase.from("journal_entries").select("date, sentence").eq("user_id", user.id).gte("date", since),
        supabase
          .from("daily_anchors")
          .select("date, future_task, mindbody_task, life_task, daily_intention")
          .eq("user_id", user.id)
          .gte("date", since),
      ])

      setRecentCheckIns((checkIns as Partial<CheckIn>[]) || [])

      const existing = existingCheckIn?.personal_question
      if (existing !== undefined && existing !== null) {
        setPersonalQuestion(existing || null)
        return
      }

      if (!isOnline()) {
        // Don't persist a "no personalization" result just because THIS
        // device is offline — leave the column untouched so an online
        // attempt (this device later, or another device) can still resolve
        // it for real today.
        setPersonalQuestion(null)
        return
      }

      if (!profile?.ai_enabled || !profile?.ai_checkins_enabled) {
        await persistPersonalQuestion(null)
        return
      }

      const entries = buildFollowUpEntries(
        (checkIns as Partial<CheckIn>[]) || [],
        (journal as { date: string; sentence: string }[]) || [],
        (anchors as Partial<DailyAnchor>[]) || []
      )
      if (entries.length === 0) {
        await persistPersonalQuestion(null)
        return
      }

      const question = await generateFollowUpQuestion(
        true,
        true,
        entries,
        i18n.language as "en" | "sw",
        profile?.tone ?? "gentle"
      )
      await persistPersonalQuestion(question)
    } catch (err) {
      console.error("Failed to load personalized question:", err)
      setPersonalQuestion(null)
    }
  }

  // Single-column upsert — only ever sets user_id/date/personal_question, so
  // it can run before (or after) the full reflection save without touching
  // any other field either way. Same established pattern as
  // src/pages/move.tsx's addToAnchor.
  async function persistPersonalQuestion(question: string | null) {
    setPersonalQuestion(question)
    if (!user) return
    try {
      const { error } = await supabase
        .from("check_ins")
        .upsert({ user_id: user.id, date: todayStr(), personal_question: question ?? "" }, { onConflict: "user_id,date" })
      if (error) throw error
    } catch (err) {
      console.error("Failed to persist personalized question:", err)
      // Best-effort — worst case this device (or another) just re-attempts
      // next time today's check-in loads; saved reflection answers are never
      // affected by this.
    }
  }

  async function loadCheckIn(): Promise<Partial<CheckIn> | undefined> {
    if (!user) return undefined
    let resolved: Partial<CheckIn> | undefined
    try {
      const localKey = `checkin_${user.id}_${todayStr()}`
      const cached = getLocalData<Partial<CheckIn>>(localKey)

      if (isOnline()) {
        const { data, error } = await supabase
          .from("check_ins")
          .select("*")
          .eq("user_id", user.id)
          .eq("date", todayStr())
          .maybeSingle()

        if (error) throw error

        if (data) {
          setCheckIn(data)
          setLocalData(localKey, data)
          if (data.voice_note_url) loadSignedAudioUrl(data.voice_note_url)
          resolved = data
        } else if (cached) {
          setCheckIn(cached)
          if (cached.voice_note_url) loadSignedAudioUrl(cached.voice_note_url)
          resolved = cached
        }
      } else if (cached) {
        setCheckIn(cached)
        if (cached.voice_note_url) loadSignedAudioUrl(cached.voice_note_url)
        resolved = cached
      }
    } catch (err: any) {
      console.error("Failed to load check-in:", err)
      toast.error(t("checkin.error_load"))
    }
    return resolved
  }

  // voice-notes is a private bucket (see the migration) — playback always
  // goes through a freshly-signed URL, never a stored permanent one.
  async function loadSignedAudioUrl(stored: string) {
    try {
      const path = extractVoiceNotePath(stored)
      const { data, error } = await supabase.storage.from("voice-notes").createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
      if (error) throw error
      if (data?.signedUrl) setAudioUrl(data.signedUrl)
    } catch (err) {
      console.error("Failed to load voice note:", err)
      // Doesn't block the rest of the check-in — the recording just won't play back.
    }
  }

  // Returns the storage PATH, not a public URL — the bucket is private, so a
  // permanent public URL wouldn't resolve anyway. Playback re-signs on load.
  async function uploadVoiceNote(blob: Blob): Promise<string | null> {
    if (!user) return null
    const fileName = `${user.id}/${todayStr()}.webm`

    try {
      const { error: uploadError } = await supabase.storage
        .from("voice-notes")
        .upload(fileName, blob, {
          contentType: "audio/webm",
          upsert: true,
        })

      if (uploadError) throw uploadError

      return fileName
    } catch (err: any) {
      console.error("Voice upload failed:", err)
      toast.error(t("checkin.error_upload_voice"))
      return null
    }
  }

  async function handleSave() {
    if (!user) return

    try {
      // Not `audioUrl` — that's a local blob/signed URL, never what belongs
      // in the DB column. `checkIn.voice_note_url` is the persisted path,
      // and deleteVoiceNote() clears it directly so this stays correct
      // whether nothing changed, a new recording replaced it, or it was removed.
      let voicePath = checkIn.voice_note_url ?? null
      let transcript = checkIn.voice_transcript ?? ""

      if (audioBlob) {
        const uploaded = await uploadVoiceNote(audioBlob)
        if (uploaded) voicePath = uploaded

        // Transcription only ever runs here — once per fresh recording, at
        // explicit save, never on every keystroke/edit of the other fields.
        setTranscribing(true)
        try {
          const text = await transcribeAudio(audioBlob)
          if (text) {
            transcript = text
            setCheckIn((prev) => ({ ...prev, voice_transcript: text }))
          }
          // A failed transcription (text === null) is silent by design — the
          // voice note itself still saves and plays back fine either way.
        } finally {
          setTranscribing(false)
        }
      }

      const record = {
        user_id: user.id,
        date: todayStr(),
        what_matters: checkIn.what_matters ?? "",
        what_avoiding: checkIn.what_avoiding ?? "",
        what_felt_real: checkIn.what_felt_real ?? "",
        evening_release: checkIn.evening_release ?? "",
        evening_mood: checkIn.evening_mood ?? "",
        evening_mood_note: checkIn.evening_mood_note ?? "",
        voice_note_url: voicePath ?? "",
        voice_transcript: transcript,
      }

      const localKey = `checkin_${user.id}_${todayStr()}`
      setLocalData(localKey, record)

      if (isOnline()) {
        const { error } = await supabase.from("check_ins").upsert(record, { onConflict: "user_id,date" })
        if (error) throw error
      } else {
        addToSyncQueue(user.id, { table: "check_ins", action: "upsert", data: record, conflictKey: "user_id,date" })
      }

      setAudioBlob(null)
      setSaved(true)
      toast.success(t("checkin.saved"))
      setTimeout(() => setSaved(false), 2000)
    } catch (err: any) {
      console.error("Failed to save check-in:", err)
      toast.error(t("checkin.error_save"))
    }
  }

  function handleRelease() {
    setReleased(true)
    setCheckIn((prev) => ({ ...prev, evening_release: new Date().toISOString() }))
    setTimeout(() => setReleased(false), 3000)
  }

  function updateField(field: keyof CheckIn, value: string) {
    setCheckIn((prev) => ({ ...prev, [field]: value }))
  }

  // 1-tap, no second text entry — reuses whatever she already wrote in
  // Reflection 1. jarAdded is session-only (not persisted): reopening the
  // check-in another day is a fresh, legitimate new drop, so it's only
  // guarding against an accidental double-tap in the same sitting.
  async function handleAddToJar() {
    const text = (checkIn.what_matters ?? "").trim()
    if (!text || jarAdded || addingToJar) return
    setAddingToJar(true)
    try {
      await addGratitude(text)
      setJarAdded(true)
      toast.success(t("jar.added_from_checkin"))
    } catch (err) {
      console.error("Failed to add gratitude from check-in:", err)
      toast.error(t("jar.drop_error"))
    } finally {
      setAddingToJar(false)
    }
  }

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" })
        setAudioBlob(blob)
        setAudioUrl(URL.createObjectURL(blob))
        stream.getTracks().forEach((track) => track.stop())
      }

      mediaRecorder.start()
      setIsRecording(true)
      setRecordingDuration(0)

      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => {
          if (prev >= 60) {
            stopRecording()
            return prev
          }
          return prev + 1
        })
      }, 1000)
    } catch (err) {
      console.error("Microphone access denied or error:", err)
      toast.error(t("checkin.mic_permission_denied"))
    }
  }, [t])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isRecording])

  const togglePlay = useCallback(() => {
    if (!audioUrl) return
    if (isPlaying) {
      audioPlayerRef.current?.pause()
      setIsPlaying(false)
    } else {
      const audio = new Audio(audioUrl)
      audioPlayerRef.current = audio
      audio.onended = () => setIsPlaying(false)
      audio.play()
      setIsPlaying(true)
    }
  }, [audioUrl, isPlaying])

  const deleteVoiceNote = useCallback(() => {
    setAudioUrl(null)
    setAudioBlob(null)
    setIsPlaying(false)
    setCheckIn((prev) => ({ ...prev, voice_note_url: null, voice_transcript: "" }))
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause()
      audioPlayerRef.current = null
    }
  }, [])

  const softModeActive = profile?.soft_mode ?? false
  const [q1, q2] = dailyQuestions
  const q2Display = personalQuestion ?? q2
  const isEvening = isCheckInTime()
  const hoursUntilEvening = Math.max(0, 19 - new Date().getHours())
  const lang: "en" | "sw" = i18n.language === "sw" ? "sw" : "en"
  // Soft mode: 1 question instead of 3 — the AI follow-up if one was
  // generated, otherwise a fixed gentle fallback (never the rotating pool,
  // which includes heavier prompts). Reuses the Reflection-1 card/field.
  const softQuestion = personalQuestion ?? getSoftModeQuestion(lang)
  const chipsWhatMatters = getQuickReplyChips(
    "what_matters",
    recentCheckIns.map((c) => c.what_matters).filter((t): t is string => !!t),
    lang
  )
  const chipsWhatAvoiding = getQuickReplyChips(
    "what_avoiding",
    recentCheckIns.map((c) => c.what_avoiding).filter((t): t is string => !!t),
    lang
  )
  const chipsWhatFeltReal = getQuickReplyChips(
    "what_felt_real",
    recentCheckIns.map((c) => c.what_felt_real).filter((t): t is string => !!t),
    lang
  )

  if (!isEvening) {
    return (
      <div className="mx-auto max-w-lg flex min-h-[60vh] flex-col items-center justify-center space-y-6 px-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-lavender/30">
          <Moon className="h-10 w-10 text-lavender" />
        </div>
        <div>
          <h2 className="font-heading text-xl font-semibold text-foreground">
            {t("timegate.evening_title")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            {t("timegate.evening_message")}
          </p>
        </div>
        <div className="rounded-full bg-secondary px-4 py-2 text-xs font-medium text-muted-foreground">
          {hoursUntilEvening > 0
            ? t("timegate.hours_until", { hours: hoursUntilEvening, plural: hoursUntilEvening > 1 ? 's' : '' })
            : t("timegate.soon")}
        </div>
        <p className="text-xs text-muted-foreground italic">
          {t("timegate.evening_sub")}
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Heart className="h-5 w-5 text-primary" />
          <h1 className="font-heading text-2xl font-bold">{t("checkin.title")}</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t("checkin.subtitle")}</p>
        {softModeActive && (
          <p className="mt-1 text-xs italic text-muted-foreground">{t("soft_mode.checkin_notice")}</p>
        )}
      </div>

      {/* Evening Mood Selector */}
      <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Moon className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium text-foreground">{t("checkin.evening_mood_label")}</p>
          </div>
          <div className="flex justify-between gap-2">
            {moodConfig.map(({ key, emoji, color }) => (
              <button
                key={key}
                onClick={() => updateField("evening_mood", key)}
                className={`flex flex-1 flex-col items-center gap-1 rounded-xl p-2.5 transition-all duration-300 ${
                  checkIn.evening_mood === key
                    ? "ring-2 ring-primary ring-offset-2 scale-110 shadow-md"
                    : "hover:scale-105 hover:shadow-sm"
                }`}
                style={{ backgroundColor: color }}
              >
                <span className="text-xl">{emoji}</span>
                <span className="text-[10px] font-medium text-foreground">{t(`mood.${key}`)}</span>
              </button>
            ))}
          </div>
          {checkIn.evening_mood && (
            <div className="mt-4">
              <p className="mb-1.5 text-xs text-muted-foreground">
                {t(`checkin.evening_mood_note_${moodNoteBucket(checkIn.evening_mood)}`)}
              </p>
              <Input
                value={checkIn.evening_mood_note ?? ""}
                onChange={(e) => updateField("evening_mood_note", e.target.value)}
                placeholder="..."
                className="border-0 bg-muted/50 shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reflection 1 */}
      <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="p-5">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>{softModeActive && personalQuestion ? "✨" : "\u{1F33F}"}</span>
              <p className="text-sm font-medium text-foreground">{softModeActive ? softQuestion : q1}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {softModeActive && personalQuestion && (
                <Badge className="border-0 bg-primary/10 text-[10px] text-primary">
                  {t("checkin.personalized_badge")} ✨
                </Badge>
              )}
              <Badge variant="secondary" className="text-[10px]">
                {t("checkin.reflection")} 1
              </Badge>
            </div>
          </div>
          <Textarea
            value={checkIn.what_matters ?? ""}
            onChange={(e) => updateField("what_matters", e.target.value)}
            placeholder="..."
            className="min-h-[80px] border-0 bg-muted/50 shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
          />
          {chipsWhatMatters.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chipsWhatMatters.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => updateField("what_matters", chip)}
                  className="rounded-full bg-muted px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-sage-light"
                >
                  {chip}
                </button>
              ))}
            </div>
          )}
          {(checkIn.what_matters ?? "").trim() && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAddToJar}
              disabled={jarAdded || addingToJar}
              className="mt-2 gap-1.5 px-0 text-xs text-primary hover:bg-transparent hover:underline disabled:opacity-60"
            >
              🫙 {jarAdded ? t("jar.added_from_checkin") : t("jar.add_from_checkin")}
            </Button>
          )}
        </CardContent>
      </Card>

      {!softModeActive && (
        <>
          {/* Reflection 2 */}
          <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
            <CardContent className="p-5">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span>{personalQuestion ? "✨" : "☁️"}</span>
                  <p className="text-sm font-medium text-foreground">{q2Display}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {personalQuestion && (
                    <Badge className="border-0 bg-primary/10 text-[10px] text-primary">
                      {t("checkin.personalized_badge")} ✨
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-[10px]">
                    {t("checkin.reflection")} 2
                  </Badge>
                </div>
              </div>
              <Textarea
                value={checkIn.what_avoiding ?? ""}
                onChange={(e) => updateField("what_avoiding", e.target.value)}
                placeholder="..."
                className="min-h-[80px] border-0 bg-muted/50 shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
              />
              {chipsWhatAvoiding.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {chipsWhatAvoiding.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => updateField("what_avoiding", chip)}
                      className="rounded-full bg-muted px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-sage-light"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Reflection 3 */}
          <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
            <CardContent className="p-5">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span>&#x1F338;</span>
                  <p className="text-sm font-medium text-foreground">{t("checkin.what_felt_real")}</p>
                </div>
                <Badge variant="secondary" className="text-[10px]">
                  {t("checkin.reflection")} 3
                </Badge>
              </div>
              <Textarea
                value={checkIn.what_felt_real ?? ""}
                onChange={(e) => updateField("what_felt_real", e.target.value)}
                placeholder="..."
                className="min-h-[80px] border-0 bg-muted/50 shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
              />
              {chipsWhatFeltReal.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {chipsWhatFeltReal.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => updateField("what_felt_real", chip)}
                      className="rounded-full bg-muted px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-sage-light"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Voice Note Section */}
      <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Mic className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium text-foreground">{t("checkin.voice_note")}</p>
          </div>

          {!audioUrl ? (
            <div className="flex items-center gap-3">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`flex h-12 w-12 items-center justify-center rounded-full transition-all ${
                  isRecording
                    ? "bg-destructive text-white dark:text-background animate-pulse"
                    : "bg-primary text-primary-foreground hover:scale-105"
                }`}
              >
                {isRecording ? <Square className="h-4 w-4" /> : <Mic className="h-5 w-5" />}
              </button>
              <div className="flex-1">
                {isRecording ? (
                  <div className="space-y-1">
                    <p className="text-xs text-destructive font-medium">{t("checkin.recording", { seconds: recordingDuration })}</p>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-destructive transition-all"
                        style={{ width: `${(recordingDuration / 60) * 100}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("checkin.tap_to_record")}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
                <button
                  onClick={togglePlay}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground hover:scale-105 transition-transform"
                >
                  {isPlaying ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
                </button>
                <div className="flex-1">
                  <p className="text-xs font-medium text-foreground">{t("checkin.voice_recorded")}</p>
                  <p className="text-xs text-muted-foreground">{isPlaying ? t("checkin.playing") : t("checkin.ready_to_play")}</p>
                </div>
                <button
                  onClick={deleteVoiceNote}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {transcribing ? (
                <div className="flex items-center gap-2 px-1">
                  <Sparkles className="h-3.5 w-3.5 animate-pulse text-primary" />
                  <span className="text-xs italic text-muted-foreground">{t("checkin.transcribing")}</span>
                </div>
              ) : checkIn.voice_transcript ? (
                <div className="rounded-xl bg-secondary/60 p-3">
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t("checkin.transcript_label")}
                  </p>
                  <Textarea
                    value={checkIn.voice_transcript}
                    onChange={(e) => updateField("voice_transcript", e.target.value)}
                    className="min-h-[60px] border-0 bg-transparent p-0 text-sm italic leading-relaxed text-foreground/85 shadow-none focus-visible:ring-0"
                  />
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Evening Release */}
      <Card className="relative overflow-hidden border-0 bg-secondary shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <EveningReleaseAnimation active={released} />
        <CardContent className="relative p-5 text-center">
          <Moon className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
          <p className="font-heading text-sm italic text-foreground/80">
            {t("checkin.evening_release")}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRelease}
            disabled={released}
            className="mt-3 border-primary/20 text-primary transition-all hover:bg-primary/5"
          >
            {released ? "\u2713 " : ""}{t("checkin.release_button")}
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
import { useEffect, useState, useRef, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { addToSyncQueue, isOnline, setLocalData, getLocalData } from "@/lib/offline-sync"
import { getDailyQuestions } from "@/lib/checkin-questions"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Heart, Moon, Mic, Square, Play, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { moodConfig } from "@/lib/constants"
import { isCheckInTime, todayStr } from "@/lib/utils"
import type { CheckIn } from "@/types"
import { EveningReleaseAnimation } from "@/components/anchor/evening-release-animation"

export function CheckInPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const [checkIn, setCheckIn] = useState<Partial<CheckIn>>({
    what_matters: "",
    what_avoiding: "",
    what_felt_real: "",
    evening_release: "",
    evening_mood: "",
  })
  const [saved, setSaved] = useState(false)
  const [released, setReleased] = useState(false)

  const [dailyQuestions, setDailyQuestions] = useState<[string, string]>(["", ""])

  const [isRecording, setIsRecording] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (user) {
      loadDailyQuestions()
      loadCheckIn()
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

  async function loadCheckIn() {
    if (!user) return
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
          if (data.voice_note_url) setAudioUrl(data.voice_note_url)
        } else if (cached) {
          setCheckIn(cached)
          if (cached.voice_note_url) setAudioUrl(cached.voice_note_url)
        }
      } else if (cached) {
        setCheckIn(cached)
        if (cached.voice_note_url) setAudioUrl(cached.voice_note_url)
      }
    } catch (err: any) {
      console.error("Failed to load check-in:", err)
      toast.error("Could not load your reflection")
    }
  }

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

      const { data } = supabase.storage.from("voice-notes").getPublicUrl(fileName)
      return data.publicUrl
    } catch (err: any) {
      console.error("Voice upload failed:", err)
      toast.error("Failed to upload voice note")
      return null
    }
  }

  async function handleSave() {
    if (!user) return

    try {
      let voiceUrl = audioUrl
      if (audioBlob) {
        const uploaded = await uploadVoiceNote(audioBlob)
        if (uploaded) voiceUrl = uploaded
      }

      const record = {
        user_id: user.id,
        date: todayStr(),
        what_matters: checkIn.what_matters ?? "",
        what_avoiding: checkIn.what_avoiding ?? "",
        what_felt_real: checkIn.what_felt_real ?? "",
        evening_release: checkIn.evening_release ?? "",
        evening_mood: checkIn.evening_mood ?? "",
        voice_note_url: voiceUrl ?? "",
      }

      const localKey = `checkin_${user.id}_${todayStr()}`
      setLocalData(localKey, record)

      if (isOnline()) {
        const { error } = await supabase.from("check_ins").upsert(record, { onConflict: "user_id,date" })
        if (error) throw error
      } else {
        addToSyncQueue({ table: "check_ins", action: "upsert", data: record, conflictKey: "user_id,date" })
      }

      setAudioBlob(null)
      setSaved(true)
      toast.success(t("checkin.saved"))
      setTimeout(() => setSaved(false), 2000)
    } catch (err: any) {
      console.error("Failed to save check-in:", err)
      toast.error("Could not save your reflection")
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
      toast.error("Please allow microphone access to record voice notes.")
    }
  }, [])

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
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause()
      audioPlayerRef.current = null
    }
  }, [])

  const [q1, q2] = dailyQuestions
  const isEvening = isCheckInTime()
  const hoursUntilEvening = Math.max(0, 19 - new Date().getHours())

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
        </CardContent>
      </Card>

      {/* Reflection 1 */}
      <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="p-5">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>&#x1F33F;</span>
              <p className="text-sm font-medium text-foreground">{q1}</p>
            </div>
            <Badge variant="secondary" className="text-[10px]">
              {t("checkin.reflection")} 1
            </Badge>
          </div>
          <Textarea
            value={checkIn.what_matters ?? ""}
            onChange={(e) => updateField("what_matters", e.target.value)}
            placeholder="..."
            className="min-h-[80px] border-0 bg-muted/50 shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
          />
        </CardContent>
      </Card>

      {/* Reflection 2 */}
      <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="p-5">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>&#x2601;&#xFE0F;</span>
              <p className="text-sm font-medium text-foreground">{q2}</p>
            </div>
            <Badge variant="secondary" className="text-[10px]">
              {t("checkin.reflection")} 2
            </Badge>
          </div>
          <Textarea
            value={checkIn.what_avoiding ?? ""}
            onChange={(e) => updateField("what_avoiding", e.target.value)}
            placeholder="..."
            className="min-h-[80px] border-0 bg-muted/50 shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
          />
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
        </CardContent>
      </Card>

      {/* Voice Note Section */}
      <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Mic className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium text-foreground">Voice Note</p>
          </div>

          {!audioUrl ? (
            <div className="flex items-center gap-3">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`flex h-12 w-12 items-center justify-center rounded-full transition-all ${
                  isRecording
                    ? "bg-destructive text-white animate-pulse"
                    : "bg-primary text-primary-foreground hover:scale-105"
                }`}
              >
                {isRecording ? <Square className="h-4 w-4" /> : <Mic className="h-5 w-5" />}
              </button>
              <div className="flex-1">
                {isRecording ? (
                  <div className="space-y-1">
                    <p className="text-xs text-destructive font-medium">Recording... {recordingDuration}s / 60s</p>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-destructive transition-all"
                        style={{ width: `${(recordingDuration / 60) * 100}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Tap to record a 60-second voice reflection</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
              <button
                onClick={togglePlay}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground hover:scale-105 transition-transform"
              >
                {isPlaying ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
              </button>
              <div className="flex-1">
                <p className="text-xs font-medium text-foreground">Voice note recorded</p>
                <p className="text-xs text-muted-foreground">{isPlaying ? "Playing..." : "Ready to play"}</p>
              </div>
              <button
                onClick={deleteVoiceNote}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </button>
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
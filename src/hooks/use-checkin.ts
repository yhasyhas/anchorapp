import { useEffect, useRef, useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { addToSyncQueue, isOnline, setLocalData, getLocalData } from "@/lib/offline-sync"
import { getDailyQuestions } from "@/lib/checkin-questions"
import { generateFollowUpQuestion, type FollowUpEntry } from "@/lib/ai-service"
import { transcribeAudio } from "@/lib/transcribe"
import { addGratitude } from "@/lib/gratitude"
import { todayStr, localDateStr } from "@/lib/utils"
import type { CheckIn, DailyAnchor, Profile } from "@/types"

function daysAgoStr(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return localDateStr(d)
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

export interface UseCheckInResult {
  checkIn: Partial<CheckIn>
  saved: boolean
  jarAdded: boolean
  addingToJar: boolean
  released: boolean
  dailyQuestions: [string, string]
  personalQuestion: string | null
  recentCheckIns: Partial<CheckIn>[]
  isRecording: boolean
  recordingDuration: number
  audioUrl: string | null
  isPlaying: boolean
  transcribing: boolean
  updateField: (field: keyof CheckIn, value: string) => void
  handleSave: () => Promise<void>
  handleRelease: () => void
  handleAddToJar: () => Promise<void>
  startRecording: () => void
  stopRecording: () => void
  togglePlay: () => void
  deleteVoiceNote: () => void
}

// Extracted from src/pages/checkin.tsx: today's check-in record, the daily
// question pool + AI-personalized follow-up question, and voice-note
// recording/playback/transcription. Voice recording stays bundled in here
// rather than its own hook — it isn't a generic "record audio" utility,
// it's directly wired into checkIn's own fields (deleteVoiceNote clears
// checkIn.voice_note_url/voice_transcript, handleSave uploads+transcribes
// whatever was just recorded before building the saved record), so
// splitting it out would only trade this file's size for cross-hook
// plumbing, not remove complexity.
export function useCheckIn(user: User | null, profile: Profile | null, language: "en" | "sw"): UseCheckInResult {
  const { t } = useTranslation()

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
      // Chained, not parallel: loadPersonalizedQuestion needs to know whether
      // today's row already has a resolved personal_question (set by this
      // device earlier, or by another device entirely) before deciding
      // whether to generate one — same reasoning as home.tsx chaining
      // loadContextData off loadTodayData's resolved value rather than
      // reading React state, which wouldn't have committed yet.
      loadDailyQuestions()
      loadCheckIn().then((loaded) => loadPersonalizedQuestion(loaded))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  function loadDailyQuestions() {
    if (!user) return
    const key = `anchor_checkin_qs_${user.id}_${todayStr()}`
    const cached = getLocalData<[string, string]>(key)

    if (cached && cached[0] && cached[1]) {
      setDailyQuestions(cached)
    } else {
      const qs = getDailyQuestions(user.id, todayStr(), language)
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

      const question = await generateFollowUpQuestion(true, true, entries, language, profile?.tone ?? "gentle")
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return {
    checkIn,
    saved,
    jarAdded,
    addingToJar,
    released,
    dailyQuestions,
    personalQuestion,
    recentCheckIns,
    isRecording,
    recordingDuration,
    audioUrl,
    isPlaying,
    transcribing,
    updateField,
    handleSave,
    handleRelease,
    handleAddToJar,
    startRecording,
    stopRecording,
    togglePlay,
    deleteVoiceNote,
  }
}

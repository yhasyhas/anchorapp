import { useCallback, useRef, useState } from "react"

export interface UseVoiceRecorderResult {
  isRecording: boolean
  durationSeconds: number
  blob: Blob | null
  startRecording: () => Promise<void>
  stopRecording: () => void
  reset: () => void
}

// Generic MediaRecorder wrapper — same technique (MediaRecorder + webm blob)
// as src/hooks/use-checkin.ts's voice-note recording, but standalone: that
// hook's recorder is tightly coupled to the check-in record itself (upload
// path, transcript field, autosave), not reusable as-is. This one just
// records up to maxSeconds and hands back a blob; callers own upload.
export function useVoiceRecorder(maxSeconds: number): UseVoiceRecorderResult {
  const [isRecording, setIsRecording] = useState(false)
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [blob, setBlob] = useState<Blob | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const startRecording = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mediaRecorder = new MediaRecorder(stream)
    mediaRecorderRef.current = mediaRecorder
    chunksRef.current = []
    setBlob(null)

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    mediaRecorder.onstop = () => {
      setBlob(new Blob(chunksRef.current, { type: "audio/webm" }))
      stream.getTracks().forEach((track) => track.stop())
    }

    mediaRecorder.start()
    setIsRecording(true)
    setDurationSeconds(0)

    timerRef.current = setInterval(() => {
      setDurationSeconds((prev) => {
        if (prev + 1 >= maxSeconds) {
          stopRecording()
          return maxSeconds
        }
        return prev + 1
      })
    }, 1000)
  }, [maxSeconds, stopRecording])

  const reset = useCallback(() => {
    setBlob(null)
    setDurationSeconds(0)
  }, [])

  return { isRecording, durationSeconds, blob, startRecording, stopRecording, reset }
}

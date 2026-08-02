import { supabase } from "@/lib/supabase"

// Same dev/prod split as generateAiInsights in ai-service.ts: in dev, call
// Groq directly with VITE_GROQ_API_KEY (npm run dev doesn't serve /api/*
// routes); in prod, go through the Edge Function so the real GROQ_API_KEY
// never reaches the client.
const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY

// Never throws — a failed transcription must never block saving the
// check-in or journal entry it's attached to (graceful fallback).
export async function transcribeAudio(blob: Blob): Promise<string | null> {
  try {
    return import.meta.env.DEV ? await transcribeDirectDev(blob) : await transcribeViaEdgeFunction(blob)
  } catch (err) {
    console.error("Transcription failed:", err)
    return null
  }
}

async function transcribeDirectDev(blob: Blob): Promise<string | null> {
  if (!GROQ_API_KEY) return null

  const form = new FormData()
  form.append("file", blob, "voice-note.webm")
  form.append("model", "whisper-large-v3-turbo")
  form.append("response_format", "json")

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    body: form,
  })

  if (!response.ok) return null
  const json = await response.json()
  return typeof json.text === "string" ? json.text.trim() : null
}

async function transcribeViaEdgeFunction(blob: Blob): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) return null

  const response = await fetch("/api/transcribe", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": blob.type || "audio/webm",
    },
    body: blob,
  })

  if (!response.ok) return null
  const json = await response.json()
  return typeof json.text === "string" ? json.text.trim() : null
}

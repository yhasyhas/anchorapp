// Text-to-speech for the Home companion message, via the browser's built-in
// speechSynthesis — free, local, no server call. See src/pages/home.tsx's listen button.

export function isSpeechSynthesisAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window
}

// Matches the sw-TZ/en-US tags already used elsewhere in the app for locale-aware
// formatting (see src/pages/wrapped-history.tsx), for consistency.
function speechLang(language: "en" | "sw"): string {
  return language === "sw" ? "sw-TZ" : "en-US"
}

function pickVoice(language: "en" | "sw"): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(language))
  if (matching.length === 0) return null
  // Prefer a non-local (usually higher-quality/"natural") voice when the browser exposes
  // that distinction; otherwise just take the first matching voice.
  return matching.find((v) => !v.localService) ?? matching[0]
}

// Speaks `text` aloud, cancelling any utterance already in progress first (so tapping the
// listen button again mid-speech acts as a stop, not an overlap). Callers should check
// isSpeechSynthesisAvailable() before rendering the button at all.
export function speak(text: string, language: "en" | "sw", onEnd?: () => void) {
  if (!isSpeechSynthesisAvailable()) return
  window.speechSynthesis.cancel()

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = speechLang(language)
  if (onEnd) utterance.onend = onEnd

  const voice = pickVoice(language)
  if (voice) {
    utterance.voice = voice
    window.speechSynthesis.speak(utterance)
    return
  }

  // Voices can load asynchronously on first use in some browsers — if none are available
  // yet, speak once they arrive rather than falling back to a default English voice for a
  // Swahili message.
  if (window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.addEventListener(
      "voiceschanged",
      () => {
        const lateVoice = pickVoice(language)
        if (lateVoice) utterance.voice = lateVoice
        window.speechSynthesis.speak(utterance)
      },
      { once: true }
    )
    return
  }

  window.speechSynthesis.speak(utterance)
}

export function stopSpeaking() {
  if (isSpeechSynthesisAvailable()) window.speechSynthesis.cancel()
}

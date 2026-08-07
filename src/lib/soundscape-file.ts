import type { SoundscapeId } from "@/lib/soundscape"

// Real recorded ambiences (~22s, ~350KB each, designed to loop), served from
// public/sounds/ — runtime-cached by the service worker (see vite.config.ts) so they
// keep working offline after a first successful load.
const SOUNDSCAPE_FILES: Record<SoundscapeId, string> = {
  rain: "/sounds/soundscape-rain.mp3",
  waves: "/sounds/soundscape-waves.mp3",
  forest: "/sounds/soundscape-forest.mp3",
}

const FADE_MS = 800
// Same ceiling as the synthesized fallback (src/lib/soundscape.ts) — this plays under
// a breathing exercise, never meant to be the focus. NOTE: iOS Safari ignores
// HTMLMediaElement.volume entirely (a platform limitation, volume there only follows
// the hardware buttons) — the fade/ceiling below simply has no effect on iOS; nothing
// to fix, there's no workaround short of routing through Web Audio again, which would
// defeat the point of using plain <audio> here.
const MAX_VOLUME = 0.15
// How long to wait for the file to load before giving up and letting the caller fall
// back to the synthesized engine — matters mainly offline-without-cache, where a
// network fetch can hang instead of failing fast.
const START_TIMEOUT_MS = 4000

function fadeVolume(audio: HTMLAudioElement, target: number, durationMs: number, onDone?: () => void): number {
  const startVolume = audio.volume
  const startTime = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - startTime) / durationMs)
    audio.volume = startVolume + (target - startVolume) * t
    if (t < 1) {
      rafId = requestAnimationFrame(step)
    } else {
      onDone?.()
    }
  }
  let rafId = requestAnimationFrame(step)
  return rafId
}

// Plays a real audio file with fade in/out — mirrors Soundscape's (src/lib/soundscape.ts)
// start()/stop() shape so SoundscapePlayer (src/lib/soundscape-player.ts) can swap
// between the two transparently.
//
// Loaded via fetch() + a blob: URL rather than pointing <audio src> straight at the
// network path. Reason: Chrome issues a Range-header request for a plain <audio src>
// (even for a first, full play), which servers answer with 206 Partial Content — and
// the Cache API spec flatly refuses to cache.put() a 206 response, so the service
// worker's runtime cache would silently never fill in. A plain fetch() here has no
// Range header, gets back a normal cacheable 200, and playback happens from the
// resulting in-memory blob — sidesteps the whole problem instead of fighting it.
export class FileSoundscape {
  private audio: HTMLAudioElement | null = null
  private objectUrl: string | null = null
  private fadeRaf: number | null = null

  // Resolves true once playback has genuinely started, false for any failure (missing
  // file, network error, decode error, offline without cache, play() rejected) — the
  // caller is expected to fall back silently on false, never surface an error.
  async start(track: SoundscapeId): Promise<boolean> {
    this.teardown()

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), START_TIMEOUT_MS)

    try {
      // Lazy-load: the file is only ever requested here, on the first play of this
      // track — never eagerly preloaded or fetched on mount.
      const response = await fetch(SOUNDSCAPE_FILES[track], { signal: controller.signal })
      if (!response.ok) return false

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)

      const audio = new Audio(objectUrl)
      audio.loop = true
      audio.volume = 0
      this.audio = audio
      this.objectUrl = objectUrl

      await audio.play()
      this.fadeRaf = fadeVolume(audio, MAX_VOLUME, FADE_MS)
      return true
    } catch {
      this.teardown()
      return false
    } finally {
      clearTimeout(timeout)
    }
  }

  // Fades out, then releases the element — safe to call even if nothing is playing.
  stop() {
    const audio = this.audio
    const objectUrl = this.objectUrl
    this.audio = null
    this.objectUrl = null
    if (this.fadeRaf) cancelAnimationFrame(this.fadeRaf)
    if (!audio) return

    this.fadeRaf = fadeVolume(audio, 0, FADE_MS, () => {
      audio.pause()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    })
  }

  private teardown() {
    if (this.fadeRaf) cancelAnimationFrame(this.fadeRaf)
    this.fadeRaf = null
    if (this.audio) {
      this.audio.pause()
      this.audio = null
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
  }
}

import { useEffect, useRef, useState } from "react"
import { SOUNDSCAPE_IDS, type SoundscapeId } from "@/lib/soundscape"
import { SoundscapePlayer } from "@/lib/soundscape-player"
import { getUserLocalData, setUserLocalData } from "@/lib/user-storage"

const SOUNDSCAPE_TRACK_KEY_BASE = "anchor_soundscape_track"

export interface UseSoundscapeResult {
  enabled: boolean
  track: SoundscapeId
  setTrack: (track: SoundscapeId) => void
  toggle: () => void
}

// Owns playback lifecycle for the ambient sound (see src/lib/soundscape-player.ts, which
// plays the real audio file and falls back to synthesis if that fails).
// `enabled` always starts false on mount — off by default every session, never autoplay,
// only ever flips true from a tap on the toggle this hook returns. Only the last-picked
// TRACK is remembered across sessions (localStorage, user-scoped) so turning it back on
// reopens on her preferred ambience.
export function useSoundscape(userId: string | undefined): UseSoundscapeResult {
  const [enabled, setEnabled] = useState(false)
  const [track, setTrackState] = useState<SoundscapeId>(() => {
    if (!userId) return SOUNDSCAPE_IDS[0]
    const saved = getUserLocalData<SoundscapeId>(SOUNDSCAPE_TRACK_KEY_BASE, userId)
    return saved && (SOUNDSCAPE_IDS as string[]).includes(saved) ? saved : SOUNDSCAPE_IDS[0]
  })
  const soundscapeRef = useRef<SoundscapePlayer | null>(null)

  function getSoundscape(): SoundscapePlayer {
    if (!soundscapeRef.current) soundscapeRef.current = new SoundscapePlayer()
    return soundscapeRef.current
  }

  useEffect(() => {
    if (enabled) getSoundscape().start(track)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, track])

  // Fade out and tear down on unmount (session ended/skipped) regardless of `enabled`.
  useEffect(() => {
    return () => soundscapeRef.current?.stop()
  }, [])

  function toggle() {
    setEnabled((prev) => {
      const next = !prev
      if (!next) getSoundscape().stop()
      return next
    })
  }

  function setTrack(next: SoundscapeId) {
    setTrackState(next)
    if (userId) setUserLocalData(SOUNDSCAPE_TRACK_KEY_BASE, userId, next)
  }

  return { enabled, track, setTrack, toggle }
}

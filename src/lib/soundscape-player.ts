import { Soundscape, type SoundscapeId } from "@/lib/soundscape"
import { FileSoundscape } from "@/lib/soundscape-file"

// Orchestrates the two engines behind one start()/stop() API: tries the real audio
// file first (FileSoundscape), and falls back to the synthesized Web Audio engine
// (Soundscape) silently — no visible error, no user-facing distinction — if the file
// fails to load (missing asset, offline without cache, decode error, etc). The
// synthesized engine is kept, not removed, specifically to be this fallback.
export class SoundscapePlayer {
  private fileEngine = new FileSoundscape()
  private synthEngine = new Soundscape()
  // Bumped on every start()/stop() so a late-resolving start() from a previous call
  // (e.g. she taps rain then waves before the first file finished loading) can tell
  // it's stale and must not apply its result.
  private sessionId = 0

  start(track: SoundscapeId) {
    const session = ++this.sessionId
    this.stopActive()

    this.fileEngine.start(track).then((ok) => {
      if (session !== this.sessionId) return // superseded by a newer start()/stop()
      if (!ok) this.synthEngine.start(track)
    })
  }

  stop() {
    this.sessionId++
    this.stopActive()
  }

  private stopActive() {
    // Both are safe to call even when idle, so no need to track which one is
    // "really" playing here — just stop whichever might be active.
    this.fileEngine.stop()
    this.synthEngine.stop()
  }
}

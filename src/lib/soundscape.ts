// Optional ambient sound for breathing sessions (morning ritual + Pause menu) — synthesized
// entirely with the Web Audio API rather than shipped as audio files: no real recording
// could be sourced/licensed for this, and synthesizing sidesteps the whole "fetch + PWA
// precache" problem too (nothing is ever downloaded, so it's offline by construction).
export type SoundscapeId = "rain" | "waves" | "forest"

export const SOUNDSCAPE_IDS: SoundscapeId[] = ["rain", "waves", "forest"]

const NOISE_BUFFER_SECONDS = 2
const FADE_SECONDS = 0.8
// Low ceiling — this plays under a breathing exercise, never meant to be the focus.
const MAX_GAIN = 0.15

function createNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * NOISE_BUFFER_SECONDS)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1
  }
  return buffer
}

interface TrackShape {
  filterType: BiquadFilterType
  filterFreq: number
  // Optional slow LFO modulating either the filter frequency (flutter, e.g. rain) or the
  // output gain (swell, e.g. waves) — omitted entirely for a steadier track (forest).
  lfo?: { rate: number; target: "filterFreq" | "gain"; depth: number }
}

const TRACK_SHAPES: Record<SoundscapeId, TrackShape> = {
  rain: { filterType: "lowpass", filterFreq: 1000, lfo: { rate: 0.7, target: "filterFreq", depth: 300 } },
  waves: { filterType: "lowpass", filterFreq: 400, lfo: { rate: 0.12, target: "gain", depth: 0.5 } },
  forest: { filterType: "lowpass", filterFreq: 2000, lfo: { rate: 0.08, target: "gain", depth: 0.2 } },
}

export class Soundscape {
  private ctx: AudioContext | null = null
  private source: AudioBufferSourceNode | null = null
  private masterGain: GainNode | null = null
  private lfoNode: OscillatorNode | null = null

  // Starts silent and fades in — never called except from a user tap (see
  // src/hooks/use-soundscape.ts), satisfying "no autoplay" by construction.
  start(track: SoundscapeId) {
    this.stopImmediately()

    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioContextCtor) return
    const ctx: AudioContext = new AudioContextCtor()
    this.ctx = ctx

    const shape = TRACK_SHAPES[track]
    const buffer = createNoiseBuffer(ctx)

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true

    const filter = ctx.createBiquadFilter()
    filter.type = shape.filterType
    filter.frequency.value = shape.filterFreq

    const masterGain = ctx.createGain()
    masterGain.gain.value = 0
    masterGain.gain.linearRampToValueAtTime(MAX_GAIN, ctx.currentTime + FADE_SECONDS)

    source.connect(filter)
    filter.connect(masterGain)
    masterGain.connect(ctx.destination)

    let lfoNode: OscillatorNode | null = null
    if (shape.lfo) {
      lfoNode = ctx.createOscillator()
      lfoNode.frequency.value = shape.lfo.rate
      const lfoGain = ctx.createGain()
      if (shape.lfo.target === "filterFreq") {
        lfoGain.gain.value = shape.lfo.depth
        lfoNode.connect(lfoGain)
        lfoGain.connect(filter.frequency)
      } else {
        lfoGain.gain.value = shape.lfo.depth * MAX_GAIN
        lfoNode.connect(lfoGain)
        lfoGain.connect(masterGain.gain)
      }
      lfoNode.start()
    }

    source.start()

    this.source = source
    this.masterGain = masterGain
    this.lfoNode = lfoNode
  }

  // Fades out, then tears down — safe to call even if nothing is playing.
  stop() {
    const ctx = this.ctx
    const masterGain = this.masterGain
    const source = this.source
    const lfoNode = this.lfoNode
    if (!ctx || !masterGain || !source) {
      this.stopImmediately()
      return
    }

    masterGain.gain.cancelScheduledValues(ctx.currentTime)
    masterGain.gain.setValueAtTime(masterGain.gain.value, ctx.currentTime)
    masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + FADE_SECONDS)

    const cleanupAt = ctx.currentTime + FADE_SECONDS
    window.setTimeout(
      () => {
        try {
          source.stop()
        } catch {
          // already stopped
        }
        lfoNode?.stop()
        ctx.close().catch(() => {})
      },
      Math.max(0, (cleanupAt - ctx.currentTime) * 1000)
    )

    this.ctx = null
    this.source = null
    this.masterGain = null
    this.lfoNode = null
  }

  private stopImmediately() {
    try {
      this.source?.stop()
    } catch {
      // already stopped
    }
    this.lfoNode?.stop()
    this.ctx?.close().catch(() => {})
    this.ctx = null
    this.source = null
    this.masterGain = null
    this.lfoNode = null
  }
}

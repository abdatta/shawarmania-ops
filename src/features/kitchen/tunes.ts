import type { KitchenAlertKind } from '@/data-access/adapters'

import type { TunePlayer } from './ringer'

/**
 * The three tunes, synthesised with the Web Audio API so there is no audio file
 * to ship, cache or lose (#70, design D9). The owner chose them by ear from a
 * set of candidates (2026-10-09), and each is distinct by shape, pitch and
 * sound, so a cook can tell them apart without looking up:
 *
 *  - **new**     *Sparkle* — a quick run up four bright plucked notes with a
 *                short echo; high and happy;
 *  - **edit**    *Hi-lo* — two hard beeps swapping twice, mid-pitched, so it
 *                cuts through a busy kitchen;
 *  - **cancel**  *Falling buzz* — three buzzy notes stepping down, the lowest.
 *
 * The owner kept these three over sets re-voiced to match each other: the
 * difference in sound between them is part of what tells them apart.
 *
 * Browsers refuse to make sound until the page has been touched. The kitchen's
 * shift-start screen involves typing, which unlocks the context for the page's
 * life; after a reload into a live shift nothing has been touched, so the
 * screen asks with `audioBlocked()` and a tap calls `unlockAudio()`.
 */

interface Note {
  frequency: number
  startMs: number
  lengthMs: number
  wave: OscillatorType
  gain: number
  attackMs: number
  /** How long the note fades at its end; a pluck fades over most of it. */
  releaseMs: number
  /** A lowpass that takes the fizz off a square wave. */
  cutoffHz?: number
  /** A quieter partial above the note, for a struck sound. */
  overtone?: { ratio: number; gain: number }
}

const ECHO = { delayS: 0.14, feedback: 0.28, wet: 0.35 }

/** C6, E6, G6, C7, each struck and left to ring, the last one longest. */
const sparkle: Note[] = [1046.5, 1318.51, 1567.98, 2093].map((frequency, index) => {
  const lengthMs = index === 3 ? 700 : 250
  return {
    frequency,
    startMs: index * 75,
    lengthMs,
    wave: 'triangle',
    gain: 0.5,
    attackMs: 4,
    releaseMs: lengthMs * 0.9,
    overtone: { ratio: 4, gain: 0.25 },
  }
})

/** D6 and A5, swapped twice. */
const hiLo: Note[] = [1174.66, 880, 1174.66, 880].map((frequency, index) => ({
  frequency,
  startMs: index * 180,
  lengthMs: 160,
  wave: 'square',
  gain: 0.28,
  attackMs: 4,
  releaseMs: 30,
  cutoffHz: 4500,
}))

/** C5, G4, C4. */
const fallingBuzz: Note[] = [
  { frequency: 523.25, startMs: 0, lengthMs: 220 },
  { frequency: 392, startMs: 240, lengthMs: 220 },
  { frequency: 261.63, startMs: 480, lengthMs: 420 },
].map((note) => ({ ...note, wave: 'square', gain: 0.3, attackMs: 8, releaseMs: 120 }))

const TUNES: Record<KitchenAlertKind, { notes: Note[]; echo: boolean }> = {
  new: { notes: sparkle, echo: true },
  edit: { notes: hiLo, echo: false },
  cancel: { notes: fallingBuzz, echo: false },
}

let context: AudioContext | null = null

function audio(): AudioContext | null {
  if (context) return context
  const Constructor =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
  if (!Constructor) return null
  try {
    context = new Constructor()
  } catch {
    context = null
  }
  return context
}

/** Resume the audio context; call from a tap or a keypress. */
export function unlockAudio(): void {
  void audio()
    ?.resume()
    .catch(() => undefined)
}

/** True when the browser is holding sound back until the page is touched. */
export function audioBlocked(): boolean {
  const ctx = audio()
  return ctx !== null && ctx.state !== 'running'
}

/** Whether this browser can make the kitchen's sounds at all. */
export function audioAvailable(): boolean {
  return audio() !== null
}

/** Play one note into `out`, shaped so a kitchen hears a tone, not a click. */
function sound(ctx: BaseAudioContext, out: AudioNode, note: Note, at: number, held: AudioNode[]) {
  const voices: {
    frequency: number
    lengthMs: number
    gain: number
    attackMs: number
    releaseMs: number
  }[] = [note]
  if (note.overtone) {
    voices.push({
      frequency: note.frequency * note.overtone.ratio,
      lengthMs: note.lengthMs * 0.35,
      gain: note.gain * note.overtone.gain,
      attackMs: 2,
      releaseMs: note.lengthMs * 0.3,
    })
  }
  for (const voice of voices) {
    const oscillator = ctx.createOscillator()
    oscillator.type = note.wave
    oscillator.frequency.value = voice.frequency
    const envelope = ctx.createGain()
    const start = at + note.startMs / 1000
    const end = start + voice.lengthMs / 1000
    const attack = voice.attackMs / 1000
    envelope.gain.setValueAtTime(0, start)
    envelope.gain.linearRampToValueAtTime(voice.gain, start + attack)
    envelope.gain.setValueAtTime(
      voice.gain,
      start + Math.max(attack, (voice.lengthMs - voice.releaseMs) / 1000),
    )
    envelope.gain.exponentialRampToValueAtTime(0.0001, end)
    let source: AudioNode = oscillator
    if (note.cutoffHz) {
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = note.cutoffHz
      filter.Q.value = 2
      source.connect(filter)
      source = filter
      held.push(filter)
    }
    source.connect(envelope).connect(out)
    oscillator.start(start)
    oscillator.stop(end + 0.05)
    held.push(oscillator, envelope)
  }
}

/**
 * Loud, and never broken by being loud (owner, 2026-10-09). A kitchen can turn a
 * loud tablet down but cannot turn a quiet one past its maximum, so each tune is
 * driven hard into a limiter: a compressor with a hard knee, a steep ratio and a
 * fast attack that holds the peaks under full scale, so pushing the level raises
 * how loud the tune sounds without the clipping that would make it crackle.
 * `drive` evens the three out — a square wave is far louder than a pluck at the
 * same gain — and the levels were set by rendering each tune offline through
 * `scheduleTune` and reading its peak and loudness, not by ear. Measured
 * 2026-10-09 in Chromium: peaks at -1.3, -2.4 and -2.6 dBFS (new, edit, cancel)
 * with no sample clipped, and the loudest 50 ms at -7.9, -6.1 and -4.2 dBFS —
 * about 3 dB louder than unlimited. The high Sparkle measures quietest but sits
 * where the ear is most sensitive. Driving harder only moves the peaks closer to
 * clipping without making them louder; a ceiling above -6 dB (-4, -3) let Sparkle's
 * attacks clip.
 */
const MASTER = { limitDb: -6, ratio: 20, attackS: 0.001, releaseS: 0.12, output: 0.92 }
const DRIVE: Record<KitchenAlertKind, number> = { new: 4, edit: 3.5, cancel: 3 }

/**
 * Schedule one ring of `kind` on `ctx` at `at`, into `destination`, and return
 * its length in ms. Every node it makes goes into `held`, so the caller can cut
 * the ring — echo tail included. Takes any context, so a test can render it
 * offline and measure it.
 */
export function scheduleTune(
  ctx: BaseAudioContext,
  kind: KitchenAlertKind,
  destination: AudioNode,
  at: number,
  held: AudioNode[],
): number {
  const { notes, echo } = TUNES[kind]
  const drive = ctx.createGain()
  drive.gain.value = DRIVE[kind]
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = MASTER.limitDb
  limiter.knee.value = 0
  limiter.ratio.value = MASTER.ratio
  limiter.attack.value = MASTER.attackS
  limiter.release.value = MASTER.releaseS
  const output = ctx.createGain()
  output.gain.value = MASTER.output
  drive.connect(limiter).connect(output).connect(destination)
  held.push(drive, limiter, output)

  let into: AudioNode = drive
  if (echo) {
    const dry = ctx.createGain()
    const delay = ctx.createDelay()
    delay.delayTime.value = ECHO.delayS
    const feedback = ctx.createGain()
    feedback.gain.value = ECHO.feedback
    const wet = ctx.createGain()
    wet.gain.value = ECHO.wet
    dry.connect(drive)
    dry.connect(delay)
    delay.connect(feedback).connect(delay)
    delay.connect(wet).connect(drive)
    held.push(dry, delay, feedback, wet)
    into = dry
  }
  for (const note of notes) sound(ctx, into, note, at, held)
  return Math.max(...notes.map((note) => note.startMs + note.lengthMs))
}

export function createTunePlayer(): TunePlayer {
  // Everything one ring made, so stopping can silence it — echo tail included.
  let held: AudioNode[] = []

  function stop(): void {
    for (const node of held) {
      if (node instanceof OscillatorNode) {
        try {
          node.stop()
        } catch {
          // Already finished.
        }
      }
      node.disconnect()
    }
    held = []
  }

  return {
    play(kind) {
      const ctx = audio()
      if (!ctx || ctx.state !== 'running') {
        const { notes } = TUNES[kind]
        return Math.max(...notes.map((note) => note.startMs + note.lengthMs))
      }
      stop()
      return scheduleTune(ctx, kind, ctx.destination, ctx.currentTime, held)
    },
    stop,
  }
}

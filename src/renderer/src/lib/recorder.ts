import { onBeforeUnmount, ref, shallowRef } from 'vue'
import type { Note } from '@shared/types'

/**
 * Recording in the renderer:
 *  voice — the microphone;
 *  call  — the system sound (what the other side says; Electron "loopback" via a screen-capture request,
 *          the video track is dropped at once) mixed with the microphone.
 * The result is Opus/WebM; for speech-to-text it is converted to 16 kHz mono WAV here (no ffmpeg).
 */
export interface Recording {
  stop(): Promise<{ blob: Blob; durationSec: number }>
  /** Live input level 0..1 (for the meter). */
  level(): number
  cancel(): void
}

/** The microphone picked in the settings; an unplugged one → the system's default. */
async function openMic(echoCancellation: boolean): Promise<MediaStream> {
  const base = { echoCancellation, noiseSuppression: true }
  const id = (await window.qa.getSettings()).voice.micId
  if (id) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: id } } })
    } catch {
      // not connected now — the default one
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: base })
}

export async function startRecording(kind: 'voice' | 'call'): Promise<Recording> {
  const ctx = new AudioContext()
  const dest = ctx.createMediaStreamDestination()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  const streams: MediaStream[] = []

  const mic = await openMic(kind === 'voice')
  streams.push(mic)
  ctx.createMediaStreamSource(mic).connect(dest)
  ctx.createMediaStreamSource(mic).connect(analyser)

  if (kind === 'call') {
    const sys = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
    for (const v of sys.getVideoTracks()) {
      v.stop()
      sys.removeTrack(v)
    }
    if (!sys.getAudioTracks().length) {
      for (const s of streams) s.getTracks().forEach((t) => t.stop())
      throw new Error('Системный звук недоступен — записывается только микрофон')
    }
    streams.push(sys)
    const src = ctx.createMediaStreamSource(sys)
    src.connect(dest)
    src.connect(analyser)
  }

  const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const started = performance.now()
  rec.start(1000)
  const buf = new Uint8Array(analyser.fftSize)

  const release = () => {
    for (const s of streams) s.getTracks().forEach((t) => t.stop())
    void ctx.close()
  }
  return {
    level() {
      analyser.getByteTimeDomainData(buf)
      let peak = 0
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128))
      return Math.min(1, peak / 90)
    },
    stop() {
      return new Promise((resolve) => {
        rec.onstop = () => {
          release()
          resolve({ blob: new Blob(chunks, { type: 'audio/webm' }), durationSec: (performance.now() - started) / 1000 })
        }
        rec.stop()
      })
    },
    cancel() {
      rec.onstop = null
      if (rec.state !== 'inactive') rec.stop()
      release()
    },
  }
}

/** Any audio blob → 16 kHz mono 16-bit WAV (what whisper.cpp reads). */
export async function toWav16k(blob: Blob): Promise<Uint8Array> {
  const src = await new AudioContext().decodeAudioData(await blob.arrayBuffer())
  const rate = 16_000
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(src.duration * rate)), rate)
  const node = off.createBufferSource()
  node.buffer = src
  node.connect(off.destination)
  node.start()
  const pcm = (await off.startRendering()).getChannelData(0)
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2))
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  out.setUint32(4, 36 + pcm.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  out.setUint32(16, 16, true)
  out.setUint16(20, 1, true) // PCM
  out.setUint16(22, 1, true) // mono
  out.setUint32(24, rate, true)
  out.setUint32(28, rate * 2, true)
  out.setUint16(32, 2, true)
  out.setUint16(34, 16, true)
  str(36, 'data')
  out.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true)
  return new Uint8Array(out.buffer)
}

/** Transcribe a note's audio: fetch the file, convert, run whisper in main. */
export async function transcribeNote(day: string, noteId: string, file: string): Promise<string> {
  const bytes = await window.qa.readAudio(file)
  const wav = await toWav16k(new Blob([bytes as BlobPart], { type: 'audio/webm' }))
  return window.qa.transcribeNote(day, noteId, wav)
}

/** A recording with its live state (level meter, timer) — the same in every place that records. */
export function useRecorder() {
  const rec = shallowRef<{ r: Recording; kind: 'voice' | 'call'; at: number }>()
  const sec = ref(0)
  const level = ref(0)
  const error = ref('')
  let timer: ReturnType<typeof setInterval> | undefined

  async function start(kind: 'voice' | 'call', at = Date.now()): Promise<boolean> {
    if (rec.value) return false
    error.value = ''
    try {
      rec.value = { r: await startRecording(kind), kind, at }
      sec.value = 0
      const t0 = Date.now()
      timer = setInterval(() => {
        level.value = rec.value?.r.level() ?? 0
        sec.value = (Date.now() - t0) / 1000
      }, 120)
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    }
  }
  /** Stops; undefined if nothing was recorded (or under a second). */
  async function stop(): Promise<{ blob: Blob; durationSec: number; at: number; kind: 'voice' | 'call' } | undefined> {
    const cur = rec.value
    if (!cur) return undefined
    rec.value = undefined
    clearInterval(timer)
    const { blob, durationSec } = await cur.r.stop()
    return durationSec < 1 ? undefined : { blob, durationSec, at: cur.at, kind: cur.kind }
  }
  function cancel(): void {
    clearInterval(timer)
    rec.value?.r.cancel()
    rec.value = undefined
  }
  onBeforeUnmount(cancel)
  return { rec, sec, level, error, start, stop, cancel }
}

/**
 * Saves a recording as an audio note (optionally linked to a block) and, if switched on, transcribes it
 * in the background. Resolves when saved; the transcript arrives later (the day updates by itself).
 */
export async function saveRecording(
  day: string,
  r: { blob: Blob; durationSec: number; at: number; kind: 'voice' | 'call' },
  opts: { id?: string; text?: string; entryId?: string } = {},
): Promise<Note> {
  const id = opts.id ?? crypto.randomUUID()
  const note = await window.qa.saveAudioNote(day, { id, at: r.at, durationSec: r.durationSec, kind: r.kind, text: opts.text, entryId: opts.entryId }, new Uint8Array(await r.blob.arrayBuffer()))
  const s = await window.qa.getSettings()
  if (s.voice.enabled && s.voice.autoTranscribe && note.audio && (await window.qa.voiceState()).modelReady)
    transcribeNote(day, id, note.audio.file).catch(() => undefined) // shown by the note itself; a cancelled one is fine
  return note
}

/**
 * A WebM from MediaRecorder has no duration in its header: the player shows 0:00 until it is played.
 * Seeking far makes the browser read to the end and learn it; then back to the start.
 */
export function fixDuration(a: HTMLAudioElement): void {
  a.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(a.duration)) return
    const back = () => {
      a.removeEventListener('durationchange', back)
      a.currentTime = 0
    }
    a.addEventListener('durationchange', back)
    a.currentTime = 1e101
  })
}

export const fmtSec = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

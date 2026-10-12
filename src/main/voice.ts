import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { WHISPER_MODELS, type WhisperModelId } from '../shared/voice'
import type { VoiceState } from '../shared/types'

/**
 * Voice notes and call recordings — all local:
 *  audio      — saved as files in data/audio/<day>/<id>.webm;
 *  transcribe — whisper.cpp (whisper-cli, MIT, shipped with the app) + a model of the user's choice,
 *               Russian, on the CPU, no network; models are downloaded on request (checked by SHA-256)
 *               and can be deleted to free the space.
 */
export class Voice {
  private downloading?: { id: WhisperModelId; progress: number }
  private error?: string
  private busy: string[] = []

  constructor(
    private root: string,
    private model: () => WhisperModelId,
    private onChange: (s: VoiceState) => void,
  ) {}

  private path(id: WhisperModelId): string {
    return join(this.root, 'models', `ggml-${id}.bin`)
  }

  private ready(id: WhisperModelId): boolean {
    const m = WHISPER_MODELS.find((x) => x.id === id)
    const p = this.path(id)
    return !!m && existsSync(p) && statSync(p).size === m.bytes
  }

  state(): VoiceState {
    const model = this.model()
    return {
      modelReady: this.ready(model),
      model,
      models: WHISPER_MODELS.map((m) => ({ id: m.id, ready: this.ready(m.id) })),
      downloading: this.downloading ? { ...this.downloading } : undefined,
      error: this.error,
      busy: [...this.busy],
    }
  }

  private changed(): void {
    this.onChange(this.state())
  }

  private get cli(): string {
    const dir = app.isPackaged ? join(process.resourcesPath, 'whisper') : join(app.getAppPath(), 'resources', 'whisper')
    return join(dir, 'whisper-cli.exe')
  }

  // ---------- audio files ----------

  /** Saves a recording; returns its path relative to the data folder. */
  saveAudio(day: string, id: string, bytes: Uint8Array): string {
    const rel = join('audio', day, `${id}.webm`)
    const file = join(this.root, rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, bytes)
    return rel.replace(/\\/g, '/')
  }

  private audioPath(rel: string): string {
    const file = join(this.root, rel)
    // only files inside data/audio
    if (!file.startsWith(join(this.root, 'audio'))) throw new Error('Недопустимый путь')
    return file
  }

  readAudio(rel: string): Uint8Array {
    return readFileSync(this.audioPath(rel))
  }

  /** When the recording was saved (its file time) — to recover a note's moment. */
  audioTime(rel: string): number | undefined {
    try {
      return statSync(this.audioPath(rel)).mtimeMs
    } catch {
      return undefined
    }
  }

  removeAudio(rel: string): void {
    rmSync(this.audioPath(rel), { force: true })
  }

  // ---------- models ----------

  async downloadModel(id: WhisperModelId): Promise<void> {
    const m = WHISPER_MODELS.find((x) => x.id === id)
    if (!m) throw new Error('Неизвестная модель')
    if (this.ready(id)) return
    if (this.downloading) throw new Error('Уже скачивается другая модель')
    const target = this.path(id)
    mkdirSync(dirname(target), { recursive: true })
    const part = `${target}.part`
    this.downloading = { id, progress: 0 }
    this.error = undefined
    this.changed()
    try {
      const res = await fetch(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${id}.bin`)
      if (!res.ok || !res.body) throw new Error(`Загрузка модели: HTTP ${res.status}`)
      const hash = createHash('sha256')
      const out = createWriteStream(part)
      let got = 0
      let lastReport = 0
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk)
        got += chunk.length
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
        if (Date.now() - lastReport > 300) {
          lastReport = Date.now()
          this.downloading = { id, progress: got / m.bytes }
          this.changed()
        }
      }
      await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())))
      if (hash.digest('hex') !== m.sha256) throw new Error('Контрольная сумма модели не совпала — файл удалён')
      renameSync(part, target)
    } catch (e) {
      rmSync(part, { force: true })
      this.error = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      this.downloading = undefined
      this.changed()
    }
  }

  deleteModel(id: WhisperModelId): void {
    rmSync(this.path(id), { force: true })
    this.changed()
  }

  // ---------- speech to text: one at a time, cancellable ----------

  /** The running whisper process (only one at a time — several would starve the CPU). */
  private running?: { noteId: string; proc: ChildProcess }
  /** Waiting jobs (FIFO); a cancelled one is simply dropped. */
  private queue: Array<{ noteId: string; start: () => void; cancel: () => void }> = []
  private cancelled = new Set<string>()

  /** Stops a transcription of the note (running or queued) — e.g. the note is being deleted. */
  cancel(noteId: string): void {
    const q = this.queue.findIndex((j) => j.noteId === noteId)
    if (q >= 0) this.queue.splice(q, 1)[0].cancel()
    if (this.running?.noteId === noteId) {
      this.cancelled.add(noteId)
      this.running.proc.kill()
    }
  }

  /** WAV (16 kHz mono, prepared by the renderer) → text, with whisper-cli on the CPU (queued). */
  transcribe(noteId: string, wav: Uint8Array): Promise<string> {
    const id = this.model()
    if (!this.ready(id)) return Promise.reject(new Error('Модель распознавания не скачана — Настройки → «Распознавание речи»'))
    if (!existsSync(this.cli)) return Promise.reject(new Error('whisper-cli не найден в составе приложения'))
    this.busy = [...this.busy.filter((x) => x !== noteId), noteId]
    this.changed()
    return new Promise<string>((resolve, reject) => {
      const done = () => {
        this.busy = this.busy.filter((x) => x !== noteId)
        this.changed()
        const next = this.queue.shift()
        if (next) next.start()
      }
      const start = () => {
        this.run(noteId, id, wav)
          .then(resolve, reject)
          .finally(() => {
            this.running = undefined
            done()
          })
      }
      const cancel = () => {
        reject(new Error('Расшифровка отменена'))
        this.busy = this.busy.filter((x) => x !== noteId)
        this.changed()
      }
      if (this.running) this.queue.push({ noteId, start, cancel })
      else start()
    })
  }

  private async run(noteId: string, model: WhisperModelId, wav: Uint8Array): Promise<string> {
    const base = join(tmpdir(), `qvarch-${randomUUID()}`)
    try {
      writeFileSync(`${base}.wav`, wav)
      const threads = String(Math.max(2, Math.min(8, cpus().length - 1)))
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(this.cli, ['-m', this.path(model), '-f', `${base}.wav`, '-l', 'ru', '-t', threads, '-nt', '-otxt', '-of', base], {
          windowsHide: true,
          cwd: dirname(this.cli),
        })
        this.running = { noteId, proc }
        let err = ''
        proc.stderr.on('data', (d) => (err = (err + String(d)).slice(-2000)))
        proc.on('error', reject)
        proc.on('exit', (code) => {
          if (this.cancelled.delete(noteId)) reject(new Error('Расшифровка отменена'))
          else if (code === 0) resolve()
          else reject(new Error(`whisper-cli: код ${code}. ${err.split('\n').slice(-3).join(' ')}`))
        })
      })
      return readFileSync(`${base}.txt`, 'utf8')
        .replace(/\[[^\]]*\]/g, ' ') // [music], [BLANK_AUDIO] …
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    } finally {
      // temp files never stay behind, whatever happened
      rmSync(`${base}.wav`, { force: true })
      rmSync(`${base}.txt`, { force: true })
    }
  }

  /** On quit: stop whatever is running, drop the queue. */
  stop(): void {
    for (const j of this.queue.splice(0)) j.cancel()
    if (this.running) {
      this.cancelled.add(this.running.noteId)
      this.running.proc.kill()
    }
  }
}

import { EMIT_BATCH_SIZE, EMIT_FLUSH_MS, EMIT_VAR_MAX, type EmitBatch, type EmitMode, type EmitPart } from '../../notebook/domain/emits'

/** The `emit` a run's code is given: a list (emit), one text (emit.text), one object (emit.merge). */
export type EmitFn = ((name: string, value: unknown) => void) & { text: (name: string, value: unknown) => void; merge: (name: string, value: unknown) => void }

const isName = (s: string) => /^[A-Za-z_$][\w$]*$/.test(s)
const WORD: Record<EmitMode, string> = { append: 'emit', text: 'emit.text', merge: 'emit.merge' }

/**
 * The parts a run's code puts into variables, sent in batches (every EMIT_FLUSH_MS, or sooner when big): numbered
 * 1, 2, 3… — the window adds them in that order. A part is copied when it is put (a list changed later in the code
 * does not change what was sent). A name gathers one way (a list, a text, an object) — another way is an error at
 * once; a name past EMIT_VAR_MAX — an error too (never cut silently). `close()` sends what is left: the run's last
 * message says how many batches there were.
 */
export class Emitter {
  private parts: EmitPart[] = []
  private size = 0
  private seq = 0
  private timer?: ReturnType<typeof setTimeout>
  private closed = false
  private readonly modes = new Map<string, EmitMode>()
  private readonly sizes = new Map<string, number>()

  constructor(
    private readonly send: (batch: EmitBatch) => void,
    /** A value as it can cross to the app (functions… become text). */
    private readonly plain: (v: unknown) => unknown,
  ) {}

  /** The function the code calls. */
  readonly emit: EmitFn = Object.assign((name: string, value: unknown) => this.put('append', name, value), {
    text: (name: string, value: unknown) => this.put('text', name, value),
    merge: (name: string, value: unknown) => this.put('merge', name, value),
  })

  private put(mode: EmitMode, name: string, value: unknown): void {
    // (the run is over — a timer of the code left behind: nothing goes any more)
    if (this.closed) return
    if (typeof name !== 'string' || !isName(name)) throw new Error(`${WORD[mode]}: «${String(name)}» — не имя переменной`)
    const was = this.modes.get(name)
    if (was && was !== mode) throw new Error(`${WORD[mode]}('${name}'): «${name}» уже накапливается через ${WORD[was]} — у переменной один способ`)
    if (mode === 'merge' && (!value || typeof value !== 'object' || Array.isArray(value))) throw new TypeError(`emit.merge('${name}', …): нужен объект`)
    const v = mode === 'text' ? (typeof value === 'string' ? value : String(value)) : this.plain(value)
    const n = typeof v === 'string' ? v.length : (JSON.stringify(v) ?? '').length
    const total = (this.sizes.get(name) ?? 0) + n
    if (total > EMIT_VAR_MAX) throw new Error(`${WORD[mode]}('${name}'): переполнение — больше ${Math.round(EMIT_VAR_MAX / 1024 / 1024)} МБ за запуск (копите меньше или пишите в файл)`)
    this.modes.set(name, mode)
    this.sizes.set(name, total)
    this.parts.push({ name, mode, value: v })
    this.size += n
    if (this.size >= EMIT_BATCH_SIZE) this.flush()
    else this.timer ??= setTimeout(() => this.flush(), EMIT_FLUSH_MS)
  }
  /** What is gathered sent now. */
  flush(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (!this.parts.length) return
    const parts = this.parts
    this.parts = []
    this.size = 0
    this.send({ seq: ++this.seq, parts })
  }
  /** The run is over: what is left sent, nothing more taken; the batches' count (the run's last message says it). */
  close(): number {
    this.flush()
    this.closed = true
    return this.seq
  }
}

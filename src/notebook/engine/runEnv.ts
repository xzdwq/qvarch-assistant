import { toRaw } from 'vue'
import type { ValueSource } from '../domain/blockInfo'
import { findLoops, loopAt, type LoopRange } from '../domain/loop'
import { jsonClone, type Values } from '../domain/values'
import { noteRun, noteValues, publishToNote } from './runStore'
import type { BlockRun, LoopRun, PassRun } from './runTypes'

/**
 * Where a block runs: the values it sees, where what it publishes goes, where its run is kept, and the id its run
 * goes by in the main process (to stop it). The note's own (NoteEnv) — its context; a loop's pass (PassEnv) — the
 * pass's values over the note's (or the outer pass's), what it publishes kept with the pass.
 */
export abstract class RunEnv {
  constructor(readonly notePath: string) {}
  /** '' — the note's; `@<loop>#<n>…` — a pass's (nested passes add up). */
  abstract readonly id: string
  /** The blocks' runs kept here. */
  abstract readonly runs: Record<string, BlockRun>
  /** The loops' runs kept here. */
  abstract readonly loops: Record<string, LoopRun>
  /** The values a block here sees, by name. */
  abstract values(): Values
  /** A value a block here published (by its name, or set() of code). */
  abstract publish(name: string, value: unknown, from: ValueSource, block: string): void
  /** The id a block's (or a loop's) run goes by in the main process. */
  runSlot(key: string): string {
    return `${this.notePath}#${key}${this.id}`
  }
  /** A block's run written here (and wherever it is shown); the run as kept. */
  recordRun(key: string, run: BlockRun): BlockRun {
    this.runs[key] = run
    this.onRunRecorded(key, run)
    return run
  }
  /** A run written: the env shows it elsewhere too (a pass — on the note's block when it is the pass shown). */
  protected onRunRecorded(_key: string, _run: BlockRun): void {}
}

/** The note itself: its context, its blocks' runs. */
export class NoteEnv extends RunEnv {
  readonly id = ''
  get runs(): Record<string, BlockRun> {
    return noteRun(this.notePath).runs
  }
  get loops(): Record<string, LoopRun> {
    return noteRun(this.notePath).loops
  }
  values(): Values {
    return noteValues(this.notePath)
  }
  publish(name: string, value: unknown, from: ValueSource, block: string): void {
    publishToNote(this.notePath, name, value, from, block)
  }
}

/** A loop's pass: its values over the outer ones; what it publishes — its own (set() — the outer's too, when serial). */
export class PassEnv extends RunEnv {
  readonly id: string
  constructor(
    readonly outer: RunEnv,
    readonly loopKey: string,
    /** The pass (as the loop's run holds it — Vue's proxy: what reads it follows it). */
    readonly pass: PassRun,
    /** Passes go one after another: a set() of this pass is the outer env's at once (the next passes see it). */
    readonly serial: boolean,
    readonly loopRun: LoopRun,
  ) {
    super(outer.notePath)
    this.id = `${outer.id}@${loopKey}#${pass.n}`
  }
  // (made on first use: an old pass of a long loop has let its runs go — reading its values writes nothing)
  get runs(): Record<string, BlockRun> {
    return (this.pass.runs ??= {})
  }
  get loops(): Record<string, LoopRun> {
    return (this.pass.loops ??= {})
  }
  values(): Values {
    // (read through Vue — a computed of a table / a value in the loop follows the pass's values)
    for (const k in this.pass.values) void this.pass.values[k]
    return { ...this.outer.values(), ...(jsonClone(this.pass.vars) as object), loop: { n: this.pass.n, index: this.pass.n - 1 }, ...toRaw(this.pass.values) }
  }
  publish(name: string, value: unknown, from: ValueSource, block: string): void {
    this.pass.values[name] = jsonClone(value)
    if (from === 'set' && this.serial) this.outer.publish(name, value, from, block)
  }
  /** This pass is the one the loop shows (picked, or the last). */
  isShown(): boolean {
    const lr = this.loopRun
    return toRaw(lr.passes[lr.sel ?? lr.passes.length - 1]) === toRaw(this.pass)
  }
  protected onRunRecorded(key: string, run: BlockRun): void {
    if (this.isShown()) noteRun(this.notePath).runs[key] = run
  }
}

/**
 * A block's env by its place: in a loop — the pass shown of that loop (a block run alone in a loop runs in that pass
 * again: its values, its result kept with it); otherwise the note's.
 */
export function envAtLine(path: string, line: number, text: string): RunEnv {
  return envResolver(path, text)(line)
}
/**
 * The envs of a text's lines, its loops found once (the editor asks for many lines at a time: {{ value }} chips).
 */
export function envResolver(path: string, text: string): (line: number) => RunEnv {
  const loops = findLoops(text.split('\n'))
  // (by the loop's place: two loops may share a key — a duplicated one)
  const byLoop = new Map<number, RunEnv>()
  const note = new NoteEnv(path)
  const envOf = (l: LoopRange | undefined): RunEnv => {
    if (!l) return note
    const known = byLoop.get(l.line0)
    if (known) return known
    const outer = envOf(loopAt(loops, l.line0))
    const lr = noteRun(path).loops[l.key]
    const p = lr?.passes[lr.sel ?? lr.passes.length - 1]
    const env = p ? new PassEnv(outer, l.key, p, l.info.parallel <= 1, lr) : outer
    byLoop.set(l.line0, env)
    return env
  }
  return (line) => envOf(loopAt(loops, line))
}

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanJob, dueBetween, jobTitle, nextDue, withRun, type CronJob, type CronRun, type RunTrigger } from '../../shared/cronJobs'

/** «Выполнить всё» of a note done by the window (in the background); where it stopped, if it did. */
export type RunNote = (note: string, trigger: RunTrigger) => Promise<{ error?: string }>

/** The longest wait between two looks at the clock (a sleep, a changed clock — never trusted to one long timer). */
const LOOK_MS = 60_000

/**
 * Notes run on a schedule (data/crons.json): the jobs kept, each run at its time by the window («Выполнить всё»,
 * its `trigger` — the schedule), its journal kept. Due while the app was closed (or asleep) — not run late: the
 * journal says how many were missed. One still going when due again — that one skipped. Its note renamed or moved —
 * the job follows it.
 */
export class CronSchedule {
  private readonly file: string
  private jobs: CronJob[] = []
  /** The last look at the clock (ms; kept: what fell due while the app was closed is told on start). */
  private lookedAt = Date.now()
  private timer?: ReturnType<typeof setTimeout>
  private run?: RunNote
  /** The jobs going on (a job is not started twice). */
  private readonly going = new Set<string>()
  private readonly listeners = new Set<(jobs: CronJob[]) => void>()

  constructor(root: string) {
    this.file = join(root, 'crons.json')
    try {
      if (existsSync(this.file)) {
        const d = JSON.parse(readFileSync(this.file, 'utf8')) as { jobs?: unknown[]; lookedAt?: number }
        this.jobs = (d.jobs ?? []).flatMap((x) => cleanJob(x) ?? [])
        if (typeof d.lookedAt === 'number') this.lookedAt = d.lookedAt
      }
    } catch {
      // a broken file — no jobs (it is written anew on the first change)
    }
  }

  /** The schedule started: what fell due while the app was closed — told; then each job at its time. */
  start(run: RunNote): void {
    this.run = run
    const now = Date.now()
    const missed = this.noteMissed(this.lookedAt, now, 'приложение было закрыто')
    this.lookedAt = now
    if (missed) this.tell()
    this.tick()
  }
  stop(): void {
    clearTimeout(this.timer)
    this.timer = undefined
  }
  list(): CronJob[] {
    return this.jobs
  }
  onChange(fn: (jobs: CronJob[]) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** A job made or changed (its id — the one changed; a broken expression — refused with why). */
  save(patch: Partial<CronJob>): CronJob {
    const was = patch.id ? this.jobs.find((j) => j.id === patch.id) : undefined
    const job = cleanJob({ ...was, ...patch, runs: was?.runs ?? [] })
    if (!job) throw new Error('Расписание не сохранено: нужна заметка и верное cron-выражение (5 полей или 6 с секундами)')
    this.jobs = was ? this.jobs.map((j) => (j.id === job.id ? job : j)) : [...this.jobs, job]
    this.changed()
    return job
  }
  remove(id: string): void {
    this.jobs = this.jobs.filter((j) => j.id !== id)
    this.changed()
  }
  /** Run now by hand (the schedule as it is; one going — refused). */
  async runNow(id: string): Promise<CronRun> {
    const job = this.jobs.find((j) => j.id === id)
    if (!job) throw new Error('Такого расписания нет')
    return this.fire(job, true)
  }
  /** Notes renamed / moved: their jobs follow (`to` none — deleted: the jobs stay, their runs say the note is gone). */
  remap(from: string, to?: string): void {
    if (to === undefined) return
    let moved = false
    this.jobs = this.jobs.map((j) => {
      if (j.note !== from && !j.note.startsWith(`${from}/`)) return j
      moved = true
      return { ...j, note: to + j.note.slice(from.length) }
    })
    if (moved) this.changed()
  }

  // ---------- the clock ----------
  /** Due since the last look — run (each once, however many times it fell due meanwhile); the next look set. */
  private tick(): void {
    clearTimeout(this.timer)
    const now = Date.now()
    // (a gap far beyond the look's step: the computer slept — what fell due meanwhile is missed, not run late)
    const slept = now - this.lookedAt > LOOK_MS * 3
    const from = this.lookedAt
    // (moved on first: whatever is told below looks from here — never at the same gap again)
    this.lookedAt = now
    const due = slept ? [] : this.jobs.filter((job) => job.on && dueBetween(job.expr, from, now, 1).length)
    const missed = slept && this.noteMissed(from, now, 'компьютер спал или приложение не отвечало')
    this.saveFile()
    const next = Math.min(...this.jobs.flatMap((j) => nextDue(j, now) ?? []), now + LOOK_MS)
    this.timer = setTimeout(() => this.tick(), Math.max(250, next - now + 50))
    if (missed) this.tell()
    for (const job of due) void this.fire(job, false)
  }
  /** The jobs due within (from, to] that could not run — put in their journals (told by the caller). */
  private noteMissed(from: number, to: number, why: string): boolean {
    let any = false
    for (const job of this.jobs) {
      if (!job.on) continue
      const due = dueBetween(job.expr, from, to)
      if (!due.length) continue
      any = true
      this.put(job.id, { at: due[due.length - 1], state: 'missed', count: due.length, error: why })
    }
    return any
  }
  private async fire(job: CronJob, hand: boolean): Promise<CronRun> {
    const at = Date.now()
    if (this.going.has(job.id)) {
      const run: CronRun = { at, state: 'missed', count: 1, error: 'прошлый запуск ещё идёт', ...(hand ? { hand } : {}) }
      this.put(job.id, run)
      this.changed()
      return run
    }
    this.going.add(job.id)
    let run: CronRun
    try {
      if (!this.run) throw new Error('Расписание ещё не запущено')
      const r = await this.run(job.note, { by: 'cron', at, cron: { id: job.id, title: jobTitle(job), expr: job.expr } })
      run = { at, state: r.error ? 'error' : 'ok', ms: Date.now() - at, ...(r.error ? { error: r.error } : {}), ...(hand ? { hand } : {}) }
    } catch (e) {
      run = { at, state: 'error', ms: Date.now() - at, error: e instanceof Error ? e.message : String(e), ...(hand ? { hand } : {}) }
    } finally {
      this.going.delete(job.id)
    }
    this.put(job.id, run)
    this.changed()
    return run
  }
  /** A run put into its job's journal (the job gone meanwhile — nothing). */
  private put(id: string, run: CronRun): void {
    this.jobs = this.jobs.map((j) => (j.id === id ? withRun(j, run) : j))
  }
  /** A job made, changed, run: kept, the next look at its time, the window told. */
  private changed(): void {
    this.saveFile()
    if (this.run) this.tick()
    this.tell()
  }
  private tell(): void {
    this.saveFile()
    for (const fn of this.listeners) fn(this.jobs)
  }
  /** Written whole (a temp file + rename: never half a file). */
  private saveFile(): void {
    try {
      writeFileSync(`${this.file}.tmp`, JSON.stringify({ lookedAt: this.lookedAt, jobs: this.jobs }, null, 1))
      renameSync(`${this.file}.tmp`, this.file)
    } catch {
      // not kept this time — the next change writes it
    }
  }
}

import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { shiftBy, type RepeatRule } from '../../shared/repeat'
import { dayEnd, dayKey, firstFreeLane, pinLanes, putEntry, shiftDay } from '../../shared/timeline'
import type { Entry } from '../../shared/types'
import type { AppContext } from '../app/appContext'
import { moveEntry, OUTLOOK_RO, removeEntry } from './dayEdits'

/**
 * Repeated series of blocks: copies every hour / day / week / year, edited and deleted together. A small index
 * (series id → day + block id) says where they are; it is checked against the days.
 */
type SeriesIndex = Record<string, Array<{ day: string; id: string }>>

export class Series {
  constructor(private readonly app: AppContext) {}
  private get file(): string {
    return join(this.app.store.root, 'series.json')
  }
  private read(): SeriesIndex {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as SeriesIndex
    } catch {
      return {}
    }
  }
  private write(ix: SeriesIndex): void {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(ix))
    renameSync(`${this.file}.tmp`, this.file)
  }
  /** The blocks of a series that still exist (a block moved to another day by hand is found there too). */
  private items(sid: string): Array<{ day: string; e: Entry }> {
    const { store } = this.app
    const out: Array<{ day: string; e: Entry }> = []
    for (const it of this.read()[sid] ?? []) {
      let e = store.day(it.day).entries.find((x) => x.id === it.id)
      let day = it.day
      if (!e)
        for (const dk of [shiftDay(it.day, -1), shiftDay(it.day, 1)]) {
          e = store.day(dk).entries.find((x) => x.id === it.id)
          if (e) {
            day = dk
            break
          }
        }
      if (e?.series?.id === sid) out.push({ day, e })
    }
    return out
  }
  /** Copies of a block (count in all, the block included) — a series; how many there are. */
  repeat(day: string, id: string, rule: RepeatRule, count: number): number {
    const { store } = this.app
    const d = store.day(day)
    const src = d.entries.find((x) => x.id === id)
    if (!src) throw new Error('Блок не найден')
    if (src.outlook) throw new Error(OUTLOOK_RO)
    const n = Math.max(1, Math.min(366, Math.round(count)))
    const sid = randomUUID()
    src.series = { id: sid, rule }
    store.markDirty(day)
    const items = [{ day, id: src.id }]
    for (let k = 1; k < n; k++) {
      const start = shiftBy(src.start, rule, k)
      const dk = dayKey(start)
      const end = Math.min(dayEnd(dk), start + (src.end - src.start))
      if (!(end > start)) continue
      const copy: Entry = {
        id: randomUUID(),
        start,
        end,
        kind: src.kind,
        label: src.label,
        ...(src.description ? { description: src.description } : {}),
        ...(src.task ? { task: { ...src.task } } : {}),
        source: 'manual',
        // a reminder tied to the start goes with each copy; a set moment moves by the same step
        ...(src.remind ? { remind: src.remind.at !== undefined ? { at: shiftBy(src.remind.at, rule, k) } : { before: src.remind.before } } : {}),
        series: { id: sid, rule },
      }
      const t = store.day(dk)
      copy.lane = firstFreeLane(t.entries, copy.start, copy.end, copy.id)
      t.entries = pinLanes(putEntry(t.entries, copy), copy.id)
      store.markDirty(dk)
      items.push({ day: dk, id: copy.id })
    }
    this.write({ ...this.read(), [sid]: items })
    store.flush()
    this.app.broadcast()
    return items.length
  }
  /** One block's edit → every block of its series: the same time shift and length, text, kind, task, reminder. */
  save(day: string, input: Entry): void {
    const { store } = this.app
    const old = store.day(day).entries.find((x) => x.id === input.id)
    if (!old?.series) throw new Error('Блок не из серии')
    const delta = input.start - old.start
    const dur = input.end - input.start
    const ix = this.read()
    const sid = old.series.id
    const moved: Array<{ day: string; id: string }> = []
    for (const it of this.items(sid)) {
      const e = it.e
      e.kind = input.kind
      e.label = input.label.trim()
      if (input.description) e.description = input.description
      else delete e.description
      if (input.task) e.task = { ...input.task }
      else delete e.task
      if (input.remind) e.remind = { before: input.remind.before, at: input.remind.at !== undefined ? input.remind.at - old.start + e.start : undefined }
      else delete e.remind
      store.markDirty(it.day)
      const start = e.start + delta
      const to = dayKey(start)
      const end = Math.min(dayEnd(to), start + dur)
      if (start !== e.start || end !== e.end) moveEntry(this.app, it.day, to, e.id, start, end)
      moved.push({ day: to, id: e.id })
    }
    ix[sid] = moved
    this.write(ix)
    store.flush()
    this.app.broadcast()
  }
  /** The whole series of a block deleted (a block of no series — itself). */
  remove(day: string, id: string): void {
    const e = this.app.store.day(day).entries.find((x) => x.id === id)
    if (!e?.series) return removeEntry(this.app, day, id)
    for (const it of this.items(e.series.id)) removeEntry(this.app, it.day, it.e.id)
    this.app.store.flush()
    this.app.broadcast()
  }
}

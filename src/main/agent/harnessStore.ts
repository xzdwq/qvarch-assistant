import { readJsonFile, writeJsonAtomic } from '../fsAtomic'
import { join } from 'node:path'
import type { HarnessSettings } from '../../shared/agent/harness/constants'
import type { HarnessRun } from '../../shared/agent/harness/model'
import { cleanHarnessSettings, isHarnessRun } from '../../shared/agent/harness/settings'

/** Runs kept at most (the latest of each room; the oldest finished ones go first). */
const RUNS_MAX = 50

/** Rooms whose own settings are kept at most (the ones set last stay). */
const ROOMS_MAX = 200

type HarnessState = { settings: HarnessSettings; rooms: Record<string, HarnessSettings>; runs: HarnessRun[] }

/**
 * The harness on the disk (data/harness.json): its settings (a new chat's), each room's own (set in its chat — kept
 * when its run is taken off) and each room's last run — kept after every step, so a run survives the app closing (it
 * is shown stopped then, «Продолжить» goes on).
 */
export class HarnessStore {
  private readonly file: string
  constructor(root: string) {
    this.file = join(root, 'harness.json')
  }
  state(): HarnessState {
    const d = this.read()
    const rooms = d.rooms && typeof d.rooms === 'object' ? Object.fromEntries(Object.entries(d.rooms).map(([k, v]) => [k, cleanHarnessSettings(v)])) : {}
    return { settings: cleanHarnessSettings(d.settings), rooms, runs: Array.isArray(d.runs) ? d.runs.filter(isHarnessRun) : [] }
  }
  saveSettings(s: unknown): HarnessSettings {
    const settings = cleanHarnessSettings(s)
    this.write({ ...this.state(), settings })
    return settings
  }
  /** A room's own settings kept (the one set last goes to the end: the oldest go first). */
  saveRoomSettings(room: string, s: unknown): HarnessSettings {
    const settings = cleanHarnessSettings(s)
    const st = this.state()
    const rest = Object.entries(st.rooms).filter(([k]) => k !== room)
    this.write({ ...st, rooms: Object.fromEntries([...rest, [room, settings]].slice(-ROOMS_MAX)) })
    return settings
  }
  /** A room's run kept (its earlier one replaced). */
  saveRun(run: unknown): void {
    if (!isHarnessRun(run)) throw new Error('Запуск harness не подходит')
    const st = this.state()
    const runs = [...st.runs.filter((r) => r.room !== run.room), run].slice(-RUNS_MAX)
    this.write({ ...st, runs })
  }
  /** The rules note of before (the instructions were a note then): its path, once — forgotten here after. */
  takeOldRulesNote(): string {
    const d = this.read()
    const s = (d.settings ?? {}) as { rulesNote?: unknown }
    if (typeof s.rulesNote !== 'string' || !s.rulesNote.trim()) return ''
    this.write(this.state())
    return s.rulesNote.trim()
  }
  dropRun(room: string): void {
    const st = this.state()
    this.write({ ...st, runs: st.runs.filter((r) => r.room !== room) })
  }

  private read(): { settings?: unknown; rooms?: Record<string, unknown>; runs?: unknown[] } {
    // (a broken file is set aside, not overwritten)
    return readJsonFile<{ settings?: unknown; rooms?: Record<string, unknown>; runs?: unknown[] }>(this.file) ?? {}
  }
  private write(v: HarnessState): void {
    writeJsonAtomic(this.file, { v: 1, ...v })
  }
}

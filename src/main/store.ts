import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { Db } from './db'
import { join } from 'node:path'
import { DEFAULT_KINDS } from '../shared/kinds'
import { DEFAULT_UI, mergeUi } from '../shared/ui'
import { dayKey, unnest } from '../shared/timeline'
import { nextTaskKey, taskNo } from '../shared/board'
import type { DayData, KindDef, LocalTask, PublicSettings, SearchHit, Settings, SettingsPatch } from '../shared/types'

const DEFAULT_SETTINGS: Settings = {
  schedule: { start: '09:00', end: '18:00', lunchStart: '13:00', lunchEnd: '14:00', workDays: [1, 2, 3, 4, 5] },
  kinds: DEFAULT_KINDS,
  captureTitles: false,
  countKeys: true,
  jira: { projects: ['DOS', 'RND', 'AI'], site: 'https://aoavant.atlassian.net', syncMin: 10 },
  // the user's own app registration "Qvarch Assistant" (ids are not secrets; no client secret is used)
  outlook: { source: 'local', clientId: '5c35351a-f465-4638-9b90-dce342691ad3', tenantId: 'fe57acdf-2f79-4073-bfea-a0011702442f', syncMin: 10, meetings: true, presence: true },
  voice: { enabled: true, autoTranscribe: true, model: 'small' },
  idleThresholdSec: 300,
  sampleIntervalMs: 2000,
  autoStart: true,
  island: {},
  ui: DEFAULT_UI,
}

/** Settings keys of removed integrations / features (OpenAI, Microsoft, the AI analysis) — dropped from disk. */
const LEGACY_SETTINGS = ['openai', 'graph', 'ai'] as const
/** The current Jira settings; anything else under "jira" is the old API-token integration and is dropped. */
const JIRA_KEYS = ['clientId', 'projects', 'site', 'syncMin']

function writeAtomic(file: string, data: string): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, data, 'utf8')
  renameSync(tmp, file)
}

function readJson<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return undefined
  }
}

export class Store {
  readonly root = join(app.getPath('userData'), 'data')
  private days = new Map<string, DayData>()
  private dirty = new Set<string>()
  private settings: Settings
  /** Days, own tasks and the search index live in SQLite (data/qvarch.db). */
  readonly db: Db

  constructor() {
    mkdirSync(this.root, { recursive: true })
    this.db = new Db(join(this.root, 'qvarch.db'))
    this.dropRemovedData()
    this.importJsonDays()
    this.numberTasks()
    const raw = (readJson<Settings>(this.settingsFile) ?? {}) as Settings & Record<string, unknown>
    let hadLegacy = LEGACY_SETTINGS.some((k) => k in raw)
    for (const k of LEGACY_SETTINGS) delete raw[k]
    const jira = raw.jira as Record<string, unknown> | undefined
    if (jira) for (const k of Object.keys(jira)) if (!JIRA_KEYS.includes(k)) {
      delete jira[k]
      hadLegacy = true
    }
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...raw,
      schedule: { ...DEFAULT_SETTINGS.schedule, ...raw.schedule },
      // the old "nested" flag of kinds is dropped
      kinds: raw.kinds?.length ? raw.kinds.map(({ nested: _n, ...k }: KindDef & { nested?: boolean }) => k) : DEFAULT_KINDS,
      island: { ...DEFAULT_SETTINGS.island, ...raw.island },
      jira: { ...DEFAULT_SETTINGS.jira, ...raw.jira },
      outlook: { ...DEFAULT_SETTINGS.outlook, ...raw.outlook },
      voice: { ...DEFAULT_SETTINGS.voice, ...raw.voice },
      ui: mergeUi(DEFAULT_UI, raw.ui),
    }
    delete (this.settings.island as Record<string, unknown>).windowHours
    if (hadLegacy) {
      // integrations were removed: their tokens and the Microsoft token cache must not stay on disk
      writeAtomic(this.settingsFile, JSON.stringify(this.settings, null, 2))
      rmSync(join(this.root, 'msal-cache.bin'), { force: true })
    }
  }

  private get settingsFile(): string {
    return join(this.root, 'settings.json')
  }

  /**
   * One-off move of the old per-day JSON files into SQLite. The files are kept (folder renamed to
   * days-json-backup) — nothing is deleted.
   */
  private importJsonDays(): void {
    const dir = join(this.root, 'days')
    if (!existsSync(dir)) return
    const files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    const days = files.map((f) => readJson<DayData>(join(dir, f))).filter((d): d is DayData => !!d?.day)
    if (days.length) this.db.importDays(days)
    let backup = join(this.root, 'days-json-backup')
    for (let i = 2; existsSync(backup); i++) backup = join(this.root, `days-json-backup-${i}`)
    renameSync(dir, backup)
    console.warn(`[store] imported ${days.length} days from JSON into SQLite; the files are kept in ${backup}`)
  }

  /**
   * Once (0.83): the history of active programs and the links between things are removed from every stored
   * day — those features are gone. A consistent copy of the database is made first (qvarch.db.before-0.83.bak).
   */
  private dropRemovedData(): void {
    const mark = join(this.root, '.dropped-0.83')
    if (existsSync(mark)) return
    const backup = join(this.root, 'qvarch.db.before-0.83.bak')
    if (!existsSync(backup)) this.db.db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`)
    let n = 0
    for (const day of this.db.listDays()) {
      const d = this.db.getDay(day) as (DayData & Record<string, unknown>) | undefined
      if (!d || !('activity' in d || 'links' in d || 'linkDismissed' in d)) continue
      delete d.activity
      delete d.links
      delete d.linkDismissed
      this.db.putDay(d)
      n++
    }
    // the AI analysis is gone too: its key must not stay on disk
    rmSync(join(this.root, 'ai-secrets.bin'), { force: true })
    writeFileSync(mark, `${new Date().toISOString()} — ${n} days cleaned\n`)
    console.warn(`[store] removed the programs history and links from ${n} days (backup: ${backup})`)
  }

  day(day: string): DayData {
    let d = this.days.get(day)
    if (d) {
      // the most recently used go last (the cache drops from the front)
      this.days.delete(day)
      this.days.set(day, d)
    } else {
      d = this.db.getDay(day) ?? { day, calls: [], entries: [], notes: [] }
      d.calls ??= []
      d.notes ??= []
      // "nested" blocks are gone: they move to a parallel lane
      const un = unnest(d.entries)
      if (un.changed) {
        d.entries = un.entries
        this.dirty.add(day)
      }
      const legacy = d as DayData & { calendar?: unknown; aiSummary?: unknown }
      // data of removed integrations
      if (legacy.calendar || legacy.aiSummary) {
        delete legacy.calendar
        delete legacy.aiSummary
        d.calls = d.calls.filter((c) => c.source === 'mic' || c.source === 'teams')
        this.dirty.add(day)
      }
      this.days.set(day, d)
    }
    return d
  }

  /** A day for reading only: the cached one (unsaved changes included) or straight from the database — not cached. */
  peek(day: string): DayData | undefined {
    return this.days.get(day) ?? this.db.getDay(day)
  }

  markDirty(day: string): void {
    this.dirty.add(day)
  }

  /** Writes changed days to SQLite (and re-indexes them for search); cheap to call often. */
  flush(): void {
    for (const day of this.dirty) {
      const d = this.days.get(day)
      if (d) this.db.putDay(d)
    }
    this.dirty.clear()
    // Keep memory bounded: the least recently used days go. Never today / yesterday — the tracker holds
    // their objects (a future day touched by the Outlook sync once pushed today out, and its time stopped).
    const live = [dayKey(Date.now()), dayKey(Date.now() - 86_400_000)]
    for (const k of [...this.days.keys()]) {
      if (this.days.size <= 7) break
      if (!live.includes(k)) this.days.delete(k)
    }
  }

  get cfg(): Settings {
    return this.settings
  }

  publicSettings(): PublicSettings {
    return this.settings
  }

  update(patch: SettingsPatch): void {
    const s = this.settings
    if (patch.schedule) s.schedule = { ...s.schedule, ...patch.schedule }
    if (patch.kinds?.length) s.kinds = patch.kinds
    if (patch.captureTitles !== undefined) s.captureTitles = patch.captureTitles
    if (patch.countKeys !== undefined) s.countKeys = patch.countKeys
    if (patch.jira) s.jira = { ...s.jira, ...patch.jira, syncMin: Math.max(1, Math.min(240, Number(patch.jira.syncMin ?? s.jira.syncMin) || 10)) }
    if (patch.outlook) s.outlook = { ...s.outlook, ...patch.outlook, syncMin: Math.max(1, Math.min(240, Number(patch.outlook.syncMin ?? s.outlook.syncMin) || 10)) }
    if (patch.voice) s.voice = { ...s.voice, ...patch.voice }
    if (patch.island) s.island = { ...s.island, ...patch.island }
    if (patch.ui) s.ui = mergeUi(s.ui, patch.ui)
    if (patch.idleThresholdSec !== undefined) s.idleThresholdSec = patch.idleThresholdSec
    if (patch.sampleIntervalMs !== undefined) s.sampleIntervalMs = patch.sampleIntervalMs
    if (patch.autoStart !== undefined) s.autoStart = patch.autoStart
    writeAtomic(this.settingsFile, JSON.stringify(s, null, 2))
  }

  /** Days that have data, YYYY-MM-DD, ascending (unsaved changes of cached days included). */
  listDays(): string[] {
    return [...new Set([...this.db.listDays(), ...this.dirty])].sort()
  }

  search(q: string): SearchHit[] {
    this.flush()
    return this.db.search(q)
  }

  tasks(): LocalTask[] {
    return this.db.tasks()
  }

  /** Saves an own task; a new one gets the next number (Q-n). */
  putTask(t: LocalTask): LocalTask {
    const task = t.key ? t : { ...t, key: nextTaskKey(this.tasks(), this.lastTaskNo()) }
    this.db.putTask(task)
    if (taskNo(task.key) > this.lastTaskNo()) this.setLastTaskNo(taskNo(task.key))
    return task
  }
  /** Older own tasks got no number: they get theirs once, in the order they were made. */
  private numberTasks(): void {
    const all = this.db.tasks()
    for (const t of all.filter((x) => !x.key).sort((a, b) => a.created - b.created)) this.putTask(t)
  }
  /** The last own task number given out (meta.json) — numbers are never reused. */
  private lastTaskNo(): number {
    return readJson<{ lastTaskNo?: number }>(join(this.root, 'meta.json'))?.lastTaskNo ?? 0
  }
  private setLastTaskNo(n: number): void {
    writeAtomic(join(this.root, 'meta.json'), JSON.stringify({ ...readJson<object>(join(this.root, 'meta.json')), lastTaskNo: n }, null, 2))
  }

  deleteTask(id: string): void {
    this.db.deleteTask(id)
  }

  close(): void {
    this.flush()
    this.db.close()
  }
}

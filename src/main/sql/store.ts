import { safeStorage } from 'electron'
import { ProcessSupervisor } from '../process/processSupervisor'
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DB_DEFAULTS, connName, sqlTemplates, type DbConn, type DbSchema, type SqlMode, type SqlRun, type SqlRunOut, type SqlTemplate } from '../../shared/sql'
import type { Vault } from '../vault'

/**
 * «Базы данных»: the connections (data/databases.json; a password encrypted by Windows, never in a note, never back
 * to the page) and the queries run against them — each in a process of its own, watched: past its time, or stopped,
 * the process is asked to cancel the query on the server and close its connection, then killed.
 */
type Stored = Omit<DbConn, 'password' | 'hasPassword'> & { enc?: string; plain?: string }
/** Queries at once against one connection, at most (a note's «Выполнить всё» and a click — not a flood). */
const PER_CONN = 3

export class SqlStore {
  private file: string
  /**
   * The queries going on, each in a process of its own: stopped — asked to cancel the query on the server and close
   * its connection (it answers — ended); if it does not in 10 s, killed (its socket goes with it).
   */
  private readonly queries: ProcessSupervisor<SqlRunOut>
  /** The connection of each query going on (queries at once per connection are limited). */
  private readonly runConn = new Map<string, string>()
  constructor(
    root: string,
    worker: string,
    private vault: Vault,
  ) {
    this.file = join(root, 'databases.json')
    this.queries = new ProcessSupervisor<SqlRunOut>({
      script: () => worker,
      serviceName: 'Qvarch SQL',
      memoryMb: 512,
      failure: (error, ms) => ({ ok: false, error, ms }),
      stop: { kind: 'ask', message: { type: 'stop' }, graceMs: 10_000 },
      restart: 'stop',
    })
  }

  private read(): Stored[] {
    if (!existsSync(this.file)) return []
    try {
      const d = JSON.parse(readFileSync(this.file, 'utf8')) as { conns?: Stored[] }
      return Array.isArray(d.conns) ? d.conns : []
    } catch {
      return []
    }
  }
  private write(list: Stored[]): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify({ v: 1, conns: list }, null, 2))
    renameSync(tmp, this.file)
  }
  private password(s: Stored): string | undefined {
    if (s.enc)
      try {
        return safeStorage.decryptString(Buffer.from(s.enc, 'base64'))
      } catch {
        return undefined
      }
    return s.plain
  }
  /** The connections as the page sees them: no password, only whether there is one. */
  conns(): DbConn[] {
    return this.read().map(({ enc, plain, ...c }) => ({ ...c, hasPassword: !!(enc || plain) }))
  }
  /** Saved (a password given — encrypted; none given — the old one kept; '' — taken away). */
  save(c: DbConn): DbConn[] {
    const name = String(c.name ?? '').trim()
    if (!connName(name)) throw new Error('Имя подключения: буквы, цифры, «_», «-», «.» — без пробелов (так его пишут в заметке: db=имя)')
    const list = this.read()
    if (list.some((x) => x.name === name && x.id !== c.id)) throw new Error(`Подключение «${name}» уже есть`)
    const old = list.find((x) => x.id === c.id)
    const { password, hasPassword: _h, ...rest } = c
    const next: Stored = { ...rest, name, id: c.id || Math.random().toString(36).slice(2, 10) }
    if (password === undefined) {
      if (old?.enc) next.enc = old.enc
      if (old?.plain) next.plain = old.plain
    } else if (password) {
      if (safeStorage.isEncryptionAvailable()) next.enc = safeStorage.encryptString(password).toString('base64')
      else next.plain = password
    }
    this.write(old ? list.map((x) => (x.id === old.id ? next : x)) : [...list, next])
    return this.conns()
  }
  remove(id: string): DbConn[] {
    this.write(this.read().filter((x) => x.id !== id))
    return this.conns()
  }

  /** A query run (or explained) on a connection by its name; `runId` — to stop it. */
  run(runId: string, connRef: string, sql: string, values: unknown[], mode: SqlMode): Promise<SqlRunOut> {
    return this.exec(runId, connRef, sql, values, mode, false)
  }
  private schemas = new Map<string, DbSchema>()
  /** The connection's tables and columns, kept 5 minutes (a query's typing asks often). */
  async schema(connRef: string, fresh = false): Promise<DbSchema | { error: string }> {
    const s = this.read().find((x) => x.name === connRef || x.id === connRef)
    if (!s) return { error: `Нет подключения «${connRef}»` }
    const kept = this.schemas.get(s.id)
    if (kept && !fresh && Date.now() - kept.at < 5 * 60_000) return kept
    const out = await this.exec(`schema#${s.id}`, s.id, '', [], 'run', true)
    const sc = (out.run as { schema?: DbSchema } | undefined)?.schema
    if (!out.ok || !sc) return { error: out.error ?? 'Схему не прочитать' }
    this.schemas.set(s.id, sc)
    return sc
  }
  private exec(runId: string, connRef: string, sql: string, values: unknown[], mode: SqlMode, schema: boolean): Promise<SqlRunOut> {
    const s = this.read().find((x) => x.name === connRef || x.id === connRef)
    if (!s) return Promise.resolve({ ok: false, error: connRef ? `Нет подключения «${connRef}» — добавьте его в «Базы данных»` : 'Не выбрано подключение', ms: 0 })
    if (this.queries.count((id) => id !== runId && this.runConn.get(id) === s.id) >= PER_CONN) return Promise.resolve({ ok: false, error: `К «${s.name}» уже идут ${PER_CONN} запроса — дождитесь их или остановите`, ms: 0 })
    const { enc: _e, plain: _p, ...base } = s
    const conn: DbConn = { ...base, password: this.password(s) }
    const sec = (conn.timeoutSec ?? DB_DEFAULTS.timeoutSec) + DB_DEFAULTS.connectSec + 15
    const t0 = Date.now()
    this.runConn.set(runId, s.id)
    const done = this.queries.start(runId, {
      job: { conn, sql, values, mode, schema },
      timeoutSec: sec,
      // the server's own limit failed to stop it, the process did not answer: stopped from here
      timeoutError: `Нет ответа дольше ${sec} с — запрос снят, соединение закрыто`,
      onMessage: (raw, run) => {
        const m = raw as { ok: boolean; run?: SqlRun; error?: string }
        run.finish({ ok: !!m.ok, run: m.run, error: m.error, ms: Date.now() - t0 })
      },
      exitError: (code) => (code ? `Процесс запроса завершился (код ${code})` : 'Процесс запроса завершился'),
    })
    void done.finally(() => {
      if (!this.queries.has(runId)) this.runConn.delete(runId)
    })
    return done
  }
  /**
   * Stopped: the process asked to cancel the query on the server and close its connection (it answers — ended); if it
   * does not in 10 s, killed (its socket goes with it; the server's own limits end the rest).
   */
  stop(runId: string, reason = 'Запрос остановлен — на сервере снят, соединение закрыто'): void {
    this.queries.stop(runId, reason)
  }
  /** Every query stopped (the app closing). */
  stopAll(): void {
    this.queries.stopAll('Приложение закрывается')
  }

  // ---------- the library: every query of the notebook ----------
  private cache = new Map<string, { mtime: number; list: SqlTemplate[] }>()
  /** The notebook's queries (each note read again only when it changed). */
  library(): SqlTemplate[] {
    const out: SqlTemplate[] = []
    const seen = new Set<string>()
    const walk = (nodes: ReturnType<Vault['tree']>) => {
      for (const n of nodes) {
        if (n.dir) {
          walk(n.children ?? [])
          continue
        }
        if (!/\.md$/i.test(n.path)) continue
        seen.add(n.path)
        let mtime = n.mtime
        try {
          mtime = statSync(join(this.vault.root, n.path)).mtimeMs
        } catch {
          // (gone meanwhile)
        }
        const c = this.cache.get(n.path)
        if (c && c.mtime === mtime) {
          out.push(...c.list)
          continue
        }
        let text = ''
        try {
          text = this.vault.read(n.path)
        } catch {
          continue
        }
        const list = /```\s*sql\b[^\n]*\bdb=/i.test(text) ? sqlTemplates(n.path, text) : []
        this.cache.set(n.path, { mtime, list })
        out.push(...list)
      }
    }
    walk(this.vault.tree())
    for (const k of [...this.cache.keys()]) if (!seen.has(k)) this.cache.delete(k)
    return out
  }
}

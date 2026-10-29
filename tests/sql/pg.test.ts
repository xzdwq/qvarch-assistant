import { rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import { readSchema, runSql } from '../../src/main/sql/engine'
import { bindSql, erAround, guardSql, type DbConn } from '../../src/shared/sql'
import { erCatalogOf, readEr } from '../../src/main/sql/erCatalog'
import { testDir } from '../testTemp'

/**
 * The PostgreSQL side against a real server (embedded, its own folder and port): read only by the server too, a lock
 * of another session not waited for, a query too long cancelled, «Стоп» cancelling it on the server — and no
 * connection of ours left behind after any of it.
 */
/** A free port of its own each run (a server of a run killed midway may still hold the one before). */
let PORT = 0
const freePort = () =>
  new Promise<number>((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port
      s.close(() => ok(p))
    })
  })
let server: EmbeddedPostgres
let dir: string
let admin: pg.Client
const conn = (over: Partial<DbConn> = {}): DbConn => ({ id: 't', name: 't', kind: 'pg', host: '127.0.0.1', port: PORT, database: 'qa', user: 'postgres', password: 'pw', ...over })
/** Our sessions on the server now (application_name «qvarch»). */
const ours = async () => Number((await admin.query("select count(*) from pg_stat_activity where application_name = 'qvarch'")).rows[0].count)
/** Our sessions closing a moment after the client is gone (the server sees the socket drop). */
const noneLeft = async () => {
  for (let i = 0; i < 40 && (await ours()) > 0; i++) await new Promise((r) => setTimeout(r, 100))
  return ours()
}

beforeAll(async () => {
  PORT = await freePort()
  dir = testDir('pg-')
  server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: PORT, persistent: false, onLog: () => undefined, onError: () => undefined, // (no I/O worker processes: on Windows they outlive the server's stop)
    postgresFlags: ['-c', 'io_method=sync'] })
  await server.initialise()
  await server.start()
  await server.createDatabase('qa')
  admin = new pg.Client({ host: '127.0.0.1', port: PORT, database: 'qa', user: 'postgres', password: 'pw', application_name: 'admin' })
  await admin.connect()
  await admin.query('create table items (id int primary key, name text, cat int)')
  await admin.query("insert into items select g, 'item ' || g, g % 100 from generate_series(1, 50000) g")
  await admin.query('analyze items')
  // a function that writes, called from a plain SELECT: the query's words pass — the server must refuse
  await admin.query('create table log (t text)')
  await admin.query("create function sneaky() returns int language plpgsql as $$ begin insert into log values ('x'); return 1; end $$")
}, 180_000)
afterAll(async () => {
  await admin?.end().catch(() => undefined)
  await server?.stop().catch(() => undefined)
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // (the server's files may still be held a moment)
  }
}, 60_000)

describe('PostgreSQL: read, safely', () => {
  it('rows read up to the limit, the rest not fetched; the connection closed', async () => {
    const r = await runSql(conn({ maxRows: 100 }), 'select id, name from items order by id', [], 'run')
    expect(r.result!.columns.map((c) => c.name)).toEqual(['id', 'name'])
    expect(r.result!.rows).toHaveLength(100)
    expect(r.result!.rows[0]).toEqual([1, 'item 1'])
    expect(r.result!.more).toBe(true)
    expect(await noneLeft()).toBe(0)
  })

  it('the schema: tables with their columns and types (for completion)', async () => {
    const sc = await readSchema(conn())
    expect(sc.defaultSchema).toBe('public')
    const items = sc.tables.find((t) => t.name === 'items')!
    expect(items.schema).toBe('public')
    expect(items.columns).toEqual([{ name: 'id', type: 'integer' }, { name: 'name', type: 'text' }, { name: 'cat', type: 'integer' }])
    expect(await noneLeft()).toBe(0)
  })

  it('dates and times as the server wrote them (no time-zone shift)', async () => {
    const r = await runSql(conn(), "select date '2024-01-01' as d, timestamp '2024-01-01 10:20:30' as ts", [], 'run')
    expect(r.result!.rows).toEqual([['2024-01-01', '2024-01-01 10:20:30']])
  })

  it('a bigint that fits a number — a number', async () => {
    expect((await runSql(conn(), 'select count(*) as n, 9007199254740993::bigint as big from items', [], 'run')).result!.rows).toEqual([[50000, '9007199254740993']])
  })

  it("the note's values go as parameters, not glued into the text", async () => {
    const b = bindSql("select name from items where id = {{x.id}} and name <> '{{x.name}}'", 'pg', (p) => ({ ok: true, value: p === 'x.id' ? 7 : "it's" }))
    expect(b.text).toBe('select name from items where id = $1 and name <> $2')
    const r = await runSql(conn(), b.text, b.values, 'run')
    expect(r.result!.rows).toEqual([['item 7']])
  })

  it('an injection through a value finds nothing and changes nothing (the server gets it as a parameter)', async () => {
    for (const evil of ["' or '1'='1", "x' ; delete from items; --", "x\\' or 1=1 --"]) {
      const b = bindSql("select count(*) as n from items where name = '{{v}}' or name like E'%{{v}}%'", 'pg', () => ({ ok: true, value: evil }))
      expect((await runSql(conn(), b.text, b.values, 'run')).result!.rows).toEqual([[0]])
    }
    expect(Number((await admin.query('select count(*) from items')).rows[0].count)).toBe(50000)
  })

  it('writing refused: by the words, and by the server (a function that writes, called from a SELECT)', async () => {
    await expect(runSql(conn(), "insert into log values ('x')", [], 'run')).rejects.toThrow(/только чтение|Только чтение/i)
    await expect(runSql(conn(), 'with d as (delete from log returning *) select * from d', [], 'run')).rejects.toThrow(/DELETE/)
    await expect(runSql(conn(), 'select * from items for update', [], 'run')).rejects.toThrow(/FOR UPDATE/)
    await expect(runSql(conn(), 'select 1; drop table items', [], 'run')).rejects.toThrow(/Несколько запросов/)
    await expect(runSql(conn(), 'select pg_advisory_lock(1)', [], 'run')).rejects.toThrow(/блокировку/)
    await expect(runSql(conn(), 'select sneaky()', [], 'run')).rejects.toThrow(/Только чтение/)
    expect(Number((await admin.query('select count(*) from log')).rows[0].count)).toBe(0)
    expect(await noneLeft()).toBe(0)
  })

  it("another session's lock: not waited for — refused in seconds, nothing queued behind it", async () => {
    const holder = new pg.Client({ host: '127.0.0.1', port: PORT, database: 'qa', user: 'postgres', password: 'pw', application_name: 'holder' })
    await holder.connect()
    await holder.query('begin')
    await holder.query('lock table items in access exclusive mode')
    try {
      const t0 = Date.now()
      await expect(runSql(conn({ lockSec: 1 }), 'select count(*) from items', [], 'run')).rejects.toThrow(/заняты другим сеансом — ждали 1 с/)
      expect(Date.now() - t0).toBeLessThan(4000)
      expect(await noneLeft()).toBe(0)
    } finally {
      await holder.query('rollback')
      await holder.end()
    }
  })

  it('too long: the server cancels it', async () => {
    const t0 = Date.now()
    await expect(runSql(conn({ timeoutSec: 1 }), 'select pg_sleep(5)', [], 'run')).rejects.toThrow(/дольше 1 с/)
    expect(Date.now() - t0).toBeLessThan(4000)
    expect(await noneLeft()).toBe(0)
  })

  it('«Стоп»: the query cancelled on the server (not left running), the connection closed', async () => {
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 700)
    const t0 = Date.now()
    await expect(runSql(conn(), 'select pg_sleep(30)', [], 'run', ac.signal)).rejects.toThrow(/остановлен/)
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(await noneLeft()).toBe(0)
    expect(Number((await admin.query("select count(*) from pg_stat_activity where query like '%pg_sleep(30)%' and pid <> pg_backend_pid()")).rows[0].count)).toBe(0)
  })

  it('the plan: without running it, and run (ANALYZE) — a full scan of 50 thousand rows for a filter is said', async () => {
    const est = await runSql(conn(), 'select * from items where cat = 5', [], 'plan')
    expect(est.plan!.analyzed).toBe(false)
    expect(est.plan!.root.op).toBe('Seq Scan')
    expect(est.plan!.root.on).toBe('items')
    const run = await runSql(conn(), 'select * from items where cat = 5', [], 'analyze')
    expect(run.plan!.analyzed).toBe(true)
    expect(run.plan!.root.act!.rows).toBe(500)
    expect(run.plan!.executionMs).toBeGreaterThan(0)
    expect(run.plan!.findings.map((f) => f.text).join('\n')).toMatch(/Полный просмотр items: прочитано 50 тыс\. строк, подошло 500 — индекс по условию «\(cat = 5\)»/)
    expect(await noneLeft()).toBe(0)
  })

  it('not connecting: refused in the connect time, not hanging', async () => {
    const t0 = Date.now()
    await expect(runSql(conn({ port: 1 }), 'select 1', [], 'run')).rejects.toThrow(/не принимает подключение|подключиться/)
    expect(Date.now() - t0).toBeLessThan(12_000)
  }, 15_000)
})

describe('PostgreSQL: the structure for an ER diagram', () => {
  it('columns (type, null, default, comment), keys — a composite one too —, references, a self-reference; nothing left open', async () => {
    await admin.query('create schema er')
    await admin.query("create table er.customers (id serial primary key, email text not null unique, boss int references er.customers(id))")
    await admin.query("comment on table er.customers is 'Клиенты'; comment on column er.customers.email is 'Почта клиента'")
    await admin.query('create table er.orders (id int primary key, customer_id int not null references er.customers(id), line int, note text)')
    await admin.query('create table er.order_lines (order_id int, line int, qty int default 1, primary key (order_id, line), foreign key (order_id) references er.orders(id))')
    const s = await readEr(conn())
    const t = (name: string) => s.tables.find((x) => x.schema === 'er' && x.name === name)!
    expect(t('customers').comment).toBe('Клиенты')
    const email = t('customers').columns.find((c) => c.name === 'email')!
    expect(email).toMatchObject({ type: 'text', nullable: false, unique: true, comment: 'Почта клиента', pk: false })
    expect(t('customers').columns.find((c) => c.name === 'boss')!.fk).toEqual([expect.objectContaining({ schema: 'er', table: 'customers', column: 'id' })])
    expect(t('orders').columns.find((c) => c.name === 'customer_id')!).toMatchObject({ nullable: false, fk: [expect.objectContaining({ table: 'customers', column: 'id' })] })
    const lines = t('order_lines')
    expect(lines.columns.filter((c) => c.pk).map((c) => c.name)).toEqual(['order_id', 'line'])
    expect(lines.columns.find((c) => c.name === 'qty')!.default).toBe('1')
    expect(erAround(s, ['er.order_lines'], 2).sort()).toEqual(['er.customers', 'er.order_lines', 'er.orders'])
    expect(await noneLeft()).toBe(0)
  })
  it('the catalogue’s queries pass the guard (read only)', () => {
    for (const q of Object.values(erCatalogOf('pg'))) expect(guardSql(q, 'pg')).toEqual({ ok: true })
  })
})

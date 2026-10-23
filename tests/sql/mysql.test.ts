import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDB } from 'mysql-memory-server'
import mysql from 'mysql2/promise'
import { readSchema, runSql } from '../../src/main/sql/engine'
import { bindSql, type DbConn } from '../../src/shared/sql'

/**
 * The MySQL side against a real server (downloaded once, run apart): the same as PostgreSQL's — read only, a lock of
 * another session not waited for, a long query cancelled by the server, «Стоп» killing it there, nothing left open.
 */
let db: Awaited<ReturnType<typeof createDB>>
let admin: mysql.Connection
const conn = (over: Partial<DbConn> = {}): DbConn => ({ id: 't', name: 't', kind: 'mysql', host: '127.0.0.1', port: db.port, database: db.dbName, user: db.username, ...over })
/** Sessions on the server but the test's own (admin, a lock holder) and the server's. */
const ours = async (skip: number[] = []) => {
  const [rows] = await admin.query(`select count(*) as n from information_schema.processlist where id <> connection_id() and user = ? and command <> 'Daemon'${skip.length ? ` and id not in (${skip.join(',')})` : ''}`, [db.username])
  return Number((rows as Array<{ n: number }>)[0].n)
}
const noneLeft = async (skip: number[] = []) => {
  for (let i = 0; i < 40 && (await ours(skip)) > 0; i++) await new Promise((r) => setTimeout(r, 100))
  return ours(skip)
}

beforeAll(async () => {
  db = await createDB({ logLevel: 'ERROR' })
  admin = await mysql.createConnection({ host: '127.0.0.1', port: db.port, user: db.username, database: db.dbName })
  await admin.query('create table items (id int primary key, name varchar(50), cat int)')
  await admin.query('set session cte_max_recursion_depth = 100000')
  await admin.query("insert into items with recursive g(n) as (select 1 union all select n + 1 from g where n < 20000) select n, concat('item ', n), n % 100 from g")
  await admin.query('analyze table items')
}, 600_000)
afterAll(async () => {
  await admin?.end().catch(() => undefined)
  await db?.stop().catch(() => undefined)
}, 60_000)

describe('MySQL: read, safely', () => {
  it('rows up to the limit (the rest not fetched — the query killed there); the connection closed', async () => {
    const r = await runSql(conn({ maxRows: 50 }), 'select id, name from items order by id', [], 'run')
    expect(r.result!.columns.map((c) => c.name)).toEqual(['id', 'name'])
    expect(r.result!.rows).toHaveLength(50)
    expect(r.result!.rows[0]).toEqual([1, 'item 1'])
    expect(r.result!.more).toBe(true)
    expect(await noneLeft()).toBe(0)
  })

  it('the schema of the database', async () => {
    const sc = await readSchema(conn())
    expect(sc.tables.find((t) => t.name === 'items')!.columns.map((c) => c.name)).toEqual(['id', 'name', 'cat'])
  })

  it('values as parameters; a list for IN', async () => {
    const b = bindSql('select id from items where id in ({{ids}}) order by id', 'mysql', () => ({ ok: true, value: [3, 5] }))
    expect(b.text).toBe('select id from items where id in (?) order by id')
    expect((await runSql(conn(), b.text, b.values, 'run')).result!.rows).toEqual([[3], [5]])
  })

  it('an injection through a value (a backslash before the quote — MySQL reads it so) finds nothing', async () => {
    for (const evil of ["' or '1'='1", "x\\' or 1=1 -- ", "x\\'; update items set name = 'x'; -- "]) {
      const b = bindSql("select count(*) from items where name = '{{v}}'", 'mysql', () => ({ ok: true, value: evil }))
      expect((await runSql(conn(), b.text, b.values, 'run')).result!.rows).toEqual([[0]])
    }
    const [rows] = await admin.query("select count(*) as n from items where name = 'x'")
    expect(Number((rows as Array<{ n: number }>)[0].n)).toBe(0)
  })

  it('writing and locking reads refused', async () => {
    await expect(runSql(conn(), "update items set name = 'x'", [], 'run')).rejects.toThrow(/Только чтение/)
    await expect(runSql(conn(), 'select * from items lock in share mode', [], 'run')).rejects.toThrow(/LOCK IN SHARE MODE/)
    await expect(runSql(conn(), 'select get_lock("a", 10)', [], 'run')).rejects.toThrow(/блокировку/)
    await expect(runSql(conn(), "select * from items into outfile '/tmp/x'", [], 'run')).rejects.toThrow(/INTO/)
  })

  it("another session's lock (LOCK TABLES … WRITE): not waited for — refused in seconds", async () => {
    const holder = await mysql.createConnection({ host: '127.0.0.1', port: db.port, user: db.username, database: db.dbName })
    const hid = holder.threadId
    await holder.query('lock tables items write')
    try {
      const t0 = Date.now()
      await expect(runSql(conn({ lockSec: 1 }), 'select count(*) from items', [], 'run')).rejects.toThrow(/заняты другим сеансом — ждали 1 с/)
      expect(Date.now() - t0).toBeLessThan(5000)
      expect(await noneLeft([hid])).toBe(0)
    } finally {
      await holder.query('unlock tables')
      await holder.end()
    }
  })

  it('too long: the server cancels it', async () => {
    const t0 = Date.now()
    await expect(runSql(conn({ timeoutSec: 1 }), 'select count(*) from items a, items b where a.id + b.id = 1', [], 'run')).rejects.toThrow(/дольше 1 с/)
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(await noneLeft()).toBe(0)
  })

  it('«Стоп»: killed on the server, the connection closed', async () => {
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 700)
    const t0 = Date.now()
    await expect(runSql(conn(), 'select count(*) from items a, items b where a.id + b.id = 1', [], 'run', ac.signal)).rejects.toThrow(/остановлен/)
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(await noneLeft()).toBe(0)
  })

  it('the plan: estimated (JSON) and run (EXPLAIN ANALYZE) — a full scan said', async () => {
    const est = await runSql(conn(), 'select * from items where cat = 5', [], 'plan')
    expect(est.plan!.analyzed).toBe(false)
    // (the JSON's format by the server's version: 1 — access_type ALL; 2 (MySQL 8.3+) — Table scan)
    expect(JSON.stringify(est.plan!.root)).toMatch(/полный просмотр/)
    expect(est.plan!.findings.map((f) => f.text).join('\n')).toMatch(/Полный просмотр items: ожидается [12]\d тыс\. строк — индекс по условию/)
    const run = await runSql(conn(), 'select * from items where cat = 5', [], 'analyze')
    expect(run.plan!.analyzed).toBe(true)
    expect(JSON.stringify(run.plan!.root)).toMatch(/Table scan/)
    expect(await noneLeft()).toBe(0)
  })
})

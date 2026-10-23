import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readSchema, runSql } from '../../src/main/sql/engine'
import ExcelJS from 'exceljs'
import { rowsXlsx } from '../../src/main/sql/export'
import { formatCode } from '../../src/shared/codeformat'
import { bindSql, guardSql, rowsAsObjects, rowsCsv, sqlTemplates, sqlTitle, withTitle } from '../../src/shared/sql'

describe('what may be sent: one reading statement', () => {
  const ok = (s: string, kind: 'pg' | 'mysql' | 'sqlite' = 'pg') => guardSql(s, kind).ok
  it('reading ones pass — names that look like words too', () => {
    expect(ok('select * from t')).toBe(true)
    expect(ok('  -- comment\n  WITH x AS (select 1) select * from x;')).toBe(true)
    expect(ok('select start, release, load, analyze, "update" from events')).toBe(true)
    expect(ok("select 'delete from t; drop table t' as s")).toBe(true)
    expect(ok('select $$insert into t$$')).toBe(true)
    expect(ok('select t.update from t')).toBe(true)
    expect(ok('explain select 1')).toBe(true)
    expect(ok('show tables', 'mysql')).toBe(true)
    expect(ok('pragma table_info(t)', 'sqlite')).toBe(true)
  })
  it('writing, locking, several statements, server functions — refused', () => {
    expect(ok('insert into t values (1)')).toBe(false)
    expect(ok('delete from t')).toBe(false)
    expect(ok('with d as (delete from t returning *) select * from d')).toBe(false)
    expect(ok('select 1; drop table t')).toBe(false)
    // «#» — PostgreSQL's operator, not a comment: what follows it is looked at
    expect(ok('select 1 # 2; drop table t')).toBe(false)
    expect(ok("select 1 # comment; drop table t\n", 'mysql')).toBe(true)
    // MySQL: a backslash escapes the quote — the string goes on
    expect(ok("select 'a\\'; drop table t'", 'mysql')).toBe(true)
    expect(ok("select 'a\\'; drop table t", 'pg')).toBe(false)
    expect(ok('select 1 /* ; */ ; ; ')).toBe(true)
    expect(ok('select * into t2 from t')).toBe(false)
    expect(ok('select * from t for update')).toBe(false)
    expect(ok('select * from t for no key update')).toBe(false)
    expect(ok('select * from t lock in share mode', 'mysql')).toBe(false)
    expect(ok('select pg_advisory_lock(1)')).toBe(false)
    expect(ok('select pg_terminate_backend(123)')).toBe(false)
    expect(ok("select set_config('default_transaction_read_only', 'off', false)")).toBe(false)
    expect(ok("select get_lock('a', 10)", 'mysql')).toBe(false)
    expect(ok('lock table t')).toBe(false)
    expect(ok('begin')).toBe(false)
    expect(ok("copy t to '/tmp/x'")).toBe(false)
    expect(ok('pragma journal_mode = delete', 'sqlite')).toBe(false)
    expect(ok('pragma x', 'pg')).toBe(false)
    expect(ok('')).toBe(false)
  })
})

describe("the note's values into the query", () => {
  const ctx = (p: string) => ({ ok: p !== 'nope', value: { id: 5, name: "O'Neil", ids: [1, 2], obj: { a: 1 } }[p.replace(/^x\./, '')] })
  it('never into the text: outside quotes — parameters; a quoted string with values — one parameter; unknown — said', () => {
    const b = bindSql("select * from t where id = {{x.id}} and n like '%{{x.name}}%' and j = {{x.obj}} and z = {{nope}}", 'pg', ctx)
    expect(b.text).toBe('select * from t where id = $1 and n like $2 and j = $3 and z = {{nope}}')
    expect(b.values).toEqual([5, "%O'Neil%", '{"a":1}'])
    expect(b.missing).toEqual(['nope'])
    expect(bindSql('select * from t where id in ({{x.ids}})', 'mysql', ctx)).toMatchObject({ text: 'select * from t where id in (?)', values: [[1, 2]] })
  })
  it('an injection attempt stays a value: quotes, backslashes, comments, «;» — the text of the query never changes', () => {
    const evil = "x\\' or 1=1; drop table t -- "
    for (const kind of ['pg', 'mysql', 'sqlite'] as const)
      for (const q of ["select * from t where n = '{{v}}'", "select * from t where n = E'{{v}}'", 'select * from t where n = {{v}}']) {
        const b = bindSql(q, kind, () => ({ ok: true, value: evil }))
        expect(b.text, `${kind}: ${q}`).not.toContain('drop')
        expect(b.text).not.toContain('{{')
        expect(b.values).toEqual([evil])
        expect(guardSql(b.text, kind).ok).toBe(true)
      }
    // the literal's own escapes read, the value kept as it is
    expect(bindSql("select 'it''s {{v}}'", 'pg', () => ({ ok: true, value: "a'b" })).values).toEqual(["it's a'b"])
    expect(bindSql("select 'a\\'b {{v}}'", 'mysql', () => ({ ok: true, value: 1 })).values).toEqual(["a'b 1"])
  })
  it('a name or a $$-string with a value — refused (a parameter cannot be a name)', () => {
    expect(bindSql('select * from "{{t}}"', 'pg', () => ({ ok: true, value: 'x' })).error).toMatch(/имени в кавычках/)
    expect(bindSql('select * from `{{t}}`', 'mysql', () => ({ ok: true, value: 'x' })).error).toMatch(/имени в кавычках/)
    expect(bindSql('select $$a {{t}}$$', 'pg', () => ({ ok: true, value: 'x' })).error).toMatch(/\$\$/)
  })
  it('rows as objects (a repeated column — name_2)', () => {
    expect(rowsAsObjects({ columns: [{ name: 'id' }, { name: 'id' }], rows: [[1, 2]] })).toEqual([{ id: 1, id_2: 2 }])
  })
})

describe('the rows as files', () => {
  const columns = [{ name: 'id' }, { name: 'name' }, { name: 'meta' }]
  const rows = [[1, 'Болт, M6', { a: 1 }], [2, 'Гайка "M6"', null]]
  it('CSV: a BOM, commas, quotes doubled, objects as JSON', () => {
    expect(rowsCsv(columns, rows)).toBe('﻿id,name,meta\r\n1,"Болт, M6","{""a"":1}"\r\n2,"Гайка ""M6""",\r\n')
  })
  it('Excel: a header, the rows, numbers as numbers', async () => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load((await rowsXlsx(columns, rows)) as unknown as ArrayBuffer)
    const ws = wb.worksheets[0]
    expect(ws.getRow(1).values).toEqual([undefined, 'id', 'name', 'meta'])
    expect(ws.getRow(2).values).toEqual([undefined, 1, 'Болт, M6', '{"a":1}'])
    expect(ws.getRow(3).getCell(1).value).toBe(2)
  })
})

describe('formatting a query', () => {
  it("the note's values kept whole, the title comment kept, the dialect's own words", async () => {
    const pg = await formatCode('sql', "-- Позиции по списку\nselect id, name from items where id = any({{ids}}) and name <> '{{x.name}}' order by id", { sqlDialect: 'postgresql' })
    expect(pg).toContain('-- Позиции по списку')
    expect(pg).toContain('ANY ({{ids}})')
    expect(pg).toContain("'{{x.name}}'")
    expect(pg).toMatch(/^SELECT$/m)
    const my = await formatCode('sql', 'select * from t where id in ({{ids}}) limit 5', { sqlDialect: 'mysql' })
    expect(my).toContain('IN ({{ids}})')
  })
})

describe('the library: the notebook\'s queries', () => {
  it('each ```sql db=… block with its title (the first comment), plain ```sql — not', () => {
    const text = ['# Запросы', '```sql db=app-dev name=items', '-- Позиции заказа', 'select * from items', '```', '```sql', 'select 1', '```', '```sql db=local', 'select count(*) from items', '```'].join('\n')
    const t = sqlTemplates('Работа/Запросы.md', text)
    expect(t.map((x) => [x.title, x.db, x.line])).toEqual([
      ['Позиции заказа', 'app-dev', 2],
      ['select count(*) from items', 'local', 9],
    ])
    expect(t[0].name).toBe('items')
  })
  it('the title set, changed, taken away', () => {
    expect(withTitle('select 1', 'Один')).toBe('-- Один\nselect 1')
    expect(withTitle('-- Один\nselect 1', 'Два')).toBe('-- Два\nselect 1')
    expect(withTitle('-- Один\nselect 1', '')).toBe('select 1')
    expect(sqlTitle('\n-- Два\nselect 1')).toBe('Два')
  })
})

describe('SQLite: a file read only', () => {
  let dir: string
  let file: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'qa-sqlite-'))
    file = join(dir, 'db.sqlite')
    const db = new DatabaseSync(file)
    db.exec('create table items (id integer primary key, name text, cat int); create table log (t text)')
    const ins = db.prepare('insert into items values (?, ?, ?)')
    db.exec('begin')
    for (let i = 1; i <= 3000; i++) ins.run(i, `item ${i}`, i % 10)
    db.exec('commit')
    db.close()
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const conn = (over = {}) => ({ id: 't', name: 't', kind: 'sqlite' as const, file, ...over })
  it('the schema: tables and columns', async () => {
    const sc = await readSchema(conn())
    expect(sc.tables.map((t) => [t.name, t.columns.map((c) => c.name).join(',')])).toEqual([['items', 'id,name,cat'], ['log', 't']])
  })
  it('rows up to the limit, parameters', async () => {
    const r = await runSql(conn({ maxRows: 10 }), 'select id, name from items where cat = ? order by id', [3], 'run')
    expect(r.result!.columns.map((c) => c.name)).toEqual(['id', 'name'])
    expect(r.result!.rows[0]).toEqual([3, 'item 3'])
    expect(r.result!.rows).toHaveLength(10)
    expect(r.result!.more).toBe(true)
  })
  it('the plan: a full scan said; an index used — not', async () => {
    const p = await runSql(conn(), 'select * from items where cat = 3', [], 'plan')
    expect(p.plan!.findings.map((f) => f.text).join('\n')).toMatch(/Полный просмотр items/)
    const q = await runSql(conn(), 'select * from items where id = 3', [], 'analyze')
    expect(q.plan!.findings.some((f) => /Полный просмотр/.test(f.text))).toBe(false)
    expect(q.plan!.analyzed).toBe(true)
  })
  it('writing refused by the words; the file is opened read-only besides', async () => {
    await expect(runSql(conn(), "insert into log values ('x')", [], 'run')).rejects.toThrow(/Только чтение/)
    const db = new DatabaseSync(file)
    expect((db.prepare('select count(*) as n from log').get() as { n: number }).n).toBe(0)
    db.close()
  })
})

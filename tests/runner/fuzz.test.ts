import { rmSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { chromium, type Browser, type Page } from 'playwright-core'
import { makeQa } from '../../src/main/runner/qaRuntime'
import type { QaCheck } from '../../src/shared/qaChecks'
import type { FuzzSpec } from '../../src/shared/fuzz'
import { testDir } from '../testTemp'

/**
 * «Перебор параметров запроса» run as a scenario runs it, against a server of its own (routed) that has the bugs it is
 * meant to find: a query's list read as Express qs reads it (over 20 indexes — an object: nothing found), a JSON
 * search falling over on 21 values; its login a token the page's own code puts in a header.
 */
let browser: Browser
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true })
}, 60_000)
/** The run's folders (its pictures, traces) — taken away after: nothing left in the temp folder. */
const made: string[] = []
const tmpDir = () => {
  const d = testDir('run-')
  made.push(d)
  return d
}
afterAll(async () => {
  await browser?.close()
  for (const d of made) rmSync(d, { recursive: true, force: true })
}, 30_000)

const ORIGIN = 'http://qa.test'
const TOKEN = 'Bearer t-123'
const PAGE = `<!doctype html><meta charset="utf-8"><title>Список</title><div id="n"></div>
<script>
const h = { authorization: '${TOKEN}', 'content-type': 'application/json' }
fetch('/api/items?filter[ids][0]=1&filter[ids][1]=2&limit=50', { headers: h }).then((r) => r.json()).then((d) => (n.textContent = d.total))
</script>`
const ROWS = Array.from({ length: 200 }, (_, i) => i + 1)

async function serve(page: Page) {
  const seen: { auth: Array<string | undefined> } = { auth: [] }
  await page.route(`${ORIGIN}/**`, async (route) => {
    const r = route.request()
    const u = new URL(r.url())
    seen.auth.push(r.headers().authorization)
    if (u.pathname === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE })
    if (r.headers().authorization !== TOKEN) return route.fulfill({ status: 401, body: '{"error":"unauthorized"}', contentType: 'application/json' })
    if (u.pathname === '/api/items') {
      // Express qs: arrayLimit 20 — an index over it makes the list an object (its keys «0»…«20»), the filter then finds nothing
      const idx = [...u.searchParams.keys()].map((k) => /^filter\[ids\]\[(\d+)\]$/.exec(k)?.[1]).filter((x): x is string => x !== undefined).map(Number)
      const asList = idx.length > 0 && Math.max(...idx) <= 20
      const ids = asList ? idx.map((i) => Number(u.searchParams.get(`filter[ids][${i}]`))) : []
      const found = asList ? ROWS.filter((x) => ids.includes(x)) : []
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: found.slice(0, 50), total: found.length }) })
    }
    if (u.pathname === '/api/export') {
      // an export: its rows by the filter — a code with leading zeros finds nothing (the file comes empty)
      const code = (JSON.parse(r.postData() ?? '{}') as { code?: string }).code ?? ''
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Позиции')
      ws.addRow(['Код', 'Наименование'])
      if (!/^0/.test(code)) for (let i = 1; i <= 3; i++) ws.addRow([`${code}-${i}`, `Позиция ${i}`])
      return route.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: Buffer.from(await wb.xlsx.writeBuffer()) })
    }
    if (u.pathname === '/api/search') {
      const b = JSON.parse(r.postData() ?? '{}') as { ids?: number[] }
      if ((b.ids?.length ?? 0) > 20) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"too many parameters"}' })
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: ROWS.filter((x) => b.ids?.includes(x)) }) })
    }
    return route.fulfill({ status: 404, body: '' })
  })
  return seen
}

async function run(spec: FuzzSpec) {
  const page = await browser.newPage()
  const seen = await serve(page)
  const checks: QaCheck[] = []
  const qa = makeQa(page, async (_n, fn) => fn(), checks, tmpDir())
  await page.goto(`${ORIGIN}/`)
  await page.waitForFunction(() => document.getElementById('n')?.textContent !== '')
  const before = seen.auth.length
  await qa.fuzz(spec).catch(() => undefined)
  await page.close()
  return { check: checks.find((c) => c.kind === 'fuzz')!, seen, sent: seen.auth.length - before }
}
const sizes = [1, 2, 20, 21, 22].map((n) => ({ label: `${n}`, value: `size(${n}, (i) => i + 1)` }))

describe('перебор параметров запроса', () => {
  it('the request the page sent, its list over 20 — «больше значений → меньше найденных» (известная ошибка: qs с arrayLimit 20), with the page\'s login', async () => {
    const { check, seen } = await run({ request: 'GET /api/items', params: [{ path: 'query.filter.ids', cases: sizes, monotonic: true }] })
    expect(check.state).toBe('warn')
    // (qs keeps index 20 — the 21st — in the list; the 22nd makes it an object)
    expect(check.summary).toContain('при 22 найдено меньше, чем при 21 (0 < 21)')
    expect(check.rows!.map((r) => r[4])).toEqual(['1', '2', '20', '21', '0'])
    // every request with the token the page's code put in (never written in the spec)
    expect(seen.auth.slice(1).every((a) => a === TOKEN)).toBe(true)
  }, 60_000)

  it('a request the scenario did not send — the example\'s; the border «ломается с 21»', async () => {
    const { check } = await run({
      request: 'POST /api/search',
      sample: { url: `${ORIGIN}/api/search`, body: '{"ids":[1,2]}' },
      params: [{ path: 'body.ids', cases: sizes, monotonic: true }],
    })
    expect(check.state).toBe('fail')
    expect(check.summary).toContain('body.ids: ломается с 21 элемента')
    expect(check.rows!.map((r) => r[2])).toEqual(['200', '200', '200', '500', '500'])
    expect(check.rows![3][5]).toContain('too many parameters')
  }, 60_000)

  it('an export: its file\'s rows counted, an empty file marked (выгрузка без строк)', async () => {
    const { check } = await run({
      request: 'POST /api/export',
      sample: { url: `${ORIGIN}/api/export`, body: '{"code":"A1"}' },
      params: [{ path: 'body.code', cases: [{ label: 'Ведущие нули', value: "'000123'" }, { label: 'Другой код', value: "'B2'" }] }],
    })
    expect(check.summary).toContain('найдено 3')
    expect(check.rows!.map((r) => [r[4], r[5]])).toEqual([['0', 'пустой файл (0 строк)'], ['3', 'ок']])
    expect(check.state).toBe('warn')
  }, 60_000)

  it('no values put down — nothing sent', async () => {
    const { check, sent } = await run({ request: 'GET /api/items', params: [{ path: 'query.limit', cases: [] }] })
    expect(check.state).toBe('warn')
    expect(sent).toBe(0)
  }, 30_000)
})

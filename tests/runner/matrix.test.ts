import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright-core'
import { makeQa } from '../../src/main/runner/qaRuntime'
import type { QaCheck } from '../../src/shared/qaChecks'

/**
 * The field matrix run as a scenario runs it — the runner's own code against a real page (the installed Edge,
 * headless) and a server of its own (routed): a record's form whose dialog's OK and list send their own changes
 * before the save, and a save the server answers slowly. The outcome is the save's answer — never a change before
 * it, never a snapshot taken while the save is still on its way.
 */
let browser: Browser
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true })
}, 60_000)
/** The run's folders (its pictures, traces) — taken away after: nothing left in the temp folder. */
const made: string[] = []
const tmpDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'qa-'))
  made.push(d)
  return d
}
afterAll(async () => {
  await browser?.close()
  for (const d of made) rmSync(d, { recursive: true, force: true })
}, 30_000)

const ORIGIN = 'http://qa.test'
const PAGE = `<!doctype html><meta charset="utf-8"><title>Запись</title>
<div id="dlg" role="dialog"><button id="ok">OK</button></div>
<form id="f" style="display:none"><input id="name" type="text"><button type="button" id="save">Сохранить</button><div id="msg"></div></form>
<script>
const post = (u, b) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
fetch('/api/item').then((r) => r.json()).then((d) => (window.loaded = d))
document.getElementById('ok').onclick = async () => {
  await post('/api/lookup', { q: 'kind' })
  document.getElementById('dlg').remove()
  document.getElementById('f').style.display = ''
}
document.getElementById('save').onclick = async () => {
  const r = await post('/api/save', { item: { name: document.getElementById('name').value } })
  document.getElementById('msg').textContent = r.ok ? 'Сохранено' : 'Ошибка'
}
</script>`

/** A page with its server: what was saved is what the item gives next. */
async function serve(page: Page, saveMs: number) {
  let stored = 'Болт'
  const saves: string[] = []
  await page.route(`${ORIGIN}/**`, async (route) => {
    const r = route.request()
    const path = new URL(r.url()).pathname
    if (path === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE })
    if (path === '/api/item') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ item: { name: stored } }) })
    if (path === '/api/lookup') return route.fulfill({ contentType: 'application/json', body: '{"items":[]}' })
    if (path === '/api/save') {
      const name = (JSON.parse(r.postData() ?? '{}') as { item: { name: string } }).item.name
      saves.push(name)
      await new Promise((ok) => setTimeout(ok, saveMs))
      stored = name
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 1, name }) })
    }
    return route.fulfill({ status: 404, body: '' })
  })
  return saves
}

describe('field matrix: the outcome is the save, waited for', () => {
  it('a slow save after the page\'s own changes (a dialog\'s OK) — judged by its answer', async () => {
    const page = await browser.newPage()
    const saves = await serve(page, 2000)
    const checks: QaCheck[] = []
    const qa = makeQa(page, async (_n, fn) => fn(), checks, tmpDir())
    await qa.fieldMatrix(
      { f1: { name: 'Наименование', value: 'Гайка', field: () => page.locator('#name'), cases: [{ label: 'другое', value: 'Шайба' }] } },
      async (v) => {
        await page.goto(`${ORIGIN}/`)
        await page.getByRole('button', { name: 'OK' }).click()
        await page.locator('#name').fill(v.f1)
        await page.getByRole('button', { name: 'Сохранить' }).click()
      },
    )
    const m = checks.find((c) => c.kind === 'matrix')
    expect(m?.state, m?.summary).not.toBe('fail')
    // the reference, the try, the record back
    expect(saves).toEqual(['Гайка', 'Шайба', 'Гайка'])
    await page.close()
  }, 90_000)

  it('no values put down — not a run (each run would save a record for nothing)', async () => {
    const page = await browser.newPage()
    const saves = await serve(page, 0)
    const checks: QaCheck[] = []
    const qa = makeQa(page, async (_n, fn) => fn(), checks, tmpDir())
    await qa.fieldMatrix({ f1: { name: 'Наименование', value: 'Гайка', field: () => page.locator('#name') } }, async (v) => {
      await page.goto(`${ORIGIN}/`)
      await page.getByRole('button', { name: 'OK' }).click()
      await page.locator('#name').fill(v.f1)
      await page.getByRole('button', { name: 'Сохранить' }).click()
    })
    expect(checks.find((c) => c.kind === 'matrix')?.state).toBe('warn')
    expect(saves).toEqual([])
    await page.close()
  }, 30_000)
})

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { CDPSession, Locator, Page } from 'playwright-core'
import { MUT, Traffic, type Exchange } from './traffic'
import { changes, endpointOf, saveOf as saveCarrying, upload, valuesIn, type OutcomeAdapter } from './outcome'
import type { QaCheck } from '../../shared/qaChecks'
import { UNSAVED_TEXT } from '../../shared/check'
import { answerText, judgeFile, type TestFile } from '../../shared/testFiles'
import { findPaths, getAt, judge, type FieldInfo, type MatrixCase } from '../../shared/qaMatrix'
import { decodeRequest, encodeRequest, endpointKey, evalCase, foundIn, getPath, judgeFuzz, parsePath, setPath, type FuzzResult, type FuzzSpec, type ReqParts } from '../../shared/fuzz'
import { gen } from '../../shared/gen'

/**
 * `qa` of a Playwright block: ready checks around recorded actions. It watches the page's requests (what is on
 * the way, what answered what), waits for the page to settle after an action, and judges: an «unsaved changes»
 * dialog after a good save, a page not the same after a reload, a save sent twice, what a repeat changes.
 * Each check goes to `checks` (shown in the block); a failed one fails the run.
 */
type Step = <T>(name: string, fn: () => Promise<T> | T) => Promise<T>
type Sent = Exchange
/** 1 поле, 2 поля, 5 полей. */
const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10
  const dd = n % 100
  return d === 1 && dd !== 11 ? one : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many
}
const pathOf = (u: string) => {
  try {
    const x = new URL(u)
    return x.pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
  } catch {
    return u
  }
}
/** A step's failure in words: «Timeout exceeded» says little — what it waited for (Playwright's call log names it). */
const stepError = (e: unknown, sec: number) => {
  const m = (e instanceof Error ? e.message : String(e)).replace(/\u001b\[[\d;]*m/g, '')
  const what = /waiting for (.+)/.exec(m)?.[1]
  return /Timeout \d+ms exceeded/.test(m) && what ? `не найден или недоступен за ${sec} с: ${what.trim()}` : m.split('\n')[0]
}
/** The rows of an Excel answer (its first sheet, the header row not counted); not a workbook — none. */
async function xlsxRows(buf: Buffer): Promise<number | undefined> {
  try {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as unknown as ArrayBuffer)
    const ws = wb.worksheets[0]
    if (!ws) return 0
    let n = 0
    ws.eachRow(() => n++)
    return Math.max(0, n - 1)
  } catch {
    return undefined
  }
}
const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s)
const line = (x: Sent) => `${x.method} ${pathOf(x.url)} → ${x.status === undefined ? '…' : x.status === 0 ? 'не дошёл' : x.status}`

/** What the page shows wrong in its geometry now (the layout check), each with its box in the page. */
interface Flaw {
  kind: string
  text: string
  x: number
  y: number
  w: number
  h: number
}
/** The page's geometry looked at (runs in the page). */
const probe = () => {
  const out: Array<{ kind: string; text: string; x: number; y: number; w: number; h: number }> = []
  const W = innerWidth
  const vis = (e: Element) => {
    const r = e.getBoundingClientRect()
    return r.width > 1 && r.height > 1 && getComputedStyle(e).visibility !== 'hidden'
  }
  const txt = (e: Element) => ((e as HTMLElement).innerText ?? e.textContent ?? '').replace(/\s+/g, ' ').trim()
  const add = (kind: string, el: Element, text: string, box?: DOMRect | { left: number; top: number; width: number; height: number }) => {
    if (out.length >= 60) return
    const r = box ?? el.getBoundingClientRect()
    out.push({ kind, text: text.slice(0, 80), x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height })
  }
  /**
   * The part of an element one really sees: its box cut by every ancestor that clips (a table's own scroll,
   * a panel with overflow hidden). A cell scrolled away inside its table is not «past the edge» — it is hidden.
   */
  const shown = (el: Element): { left: number; top: number; right: number; bottom: number; width: number; height: number } | undefined => {
    const r = el.getBoundingClientRect()
    let l = r.left
    let t = r.top
    let rt = r.right
    let b = r.bottom
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const st = getComputedStyle(p)
      if (st.overflowX !== 'visible' || st.overflowY !== 'visible') {
        const c = p.getBoundingClientRect()
        if (st.overflowX !== 'visible') ((l = Math.max(l, c.left)), (rt = Math.min(rt, c.right)))
        if (st.overflowY !== 'visible') ((t = Math.max(t, c.top)), (b = Math.min(b, c.bottom)))
      }
      if (rt - l <= 1 || b - t <= 1) return undefined
    }
    return { left: l, top: t, right: rt, bottom: b, width: rt - l, height: b - t }
  }
  /** Stuck to the screen (a sticky header, a fixed bar): content scrolls under it — that is no overlap. */
  const stuck = (el: Element) => {
    for (let p: Element | null = el; p && p !== document.documentElement; p = p.parentElement) {
      const pos = getComputedStyle(p).position
      if (pos === 'sticky' || pos === 'fixed') return true
    }
    return false
  }
  const over = document.documentElement.scrollWidth - W
  const hscroll = over > 4 && getComputedStyle(document.documentElement).overflowX !== 'hidden' ? over : 0
  // text out of its cell (spilling over the neighbours)
  const cells = document.querySelectorAll('td, th, [role="cell"], [role="gridcell"], [role="columnheader"]')
  for (let i = 0; i < cells.length && i < 3000; i++) {
    const el = cells[i]
    if (el.scrollWidth <= el.clientWidth + 2 || !vis(el)) continue
    const s = getComputedStyle(el)
    if (s.overflowX !== 'visible' || s.textOverflow === 'ellipsis') continue
    let cut = false
    for (const k of [...el.querySelectorAll('*')].slice(0, 50)) {
      const ks = getComputedStyle(k)
      if (ks.textOverflow === 'ellipsis' || (ks.overflowX !== 'visible' && k.scrollWidth > k.clientWidth)) cut = true
    }
    if (cut) continue
    const range = document.createRange()
    range.selectNodeContents(el)
    const tr = range.getBoundingClientRect()
    const cr = el.getBoundingClientRect()
    if (txt(el) && (tr.right > cr.right + 2 || tr.left < cr.left - 2)) add('Текст вылезает из ячейки', el, txt(el))
  }
  // text cut off (a button, a label, a tab — hidden overflow, no ellipsis)
  const labels = document.querySelectorAll('button, .q-btn, label, .q-field__label, .q-tab, [role="tab"], a')
  for (let i = 0; i < labels.length && i < 1500; i++) {
    const el = labels[i]
    if (el.scrollWidth <= el.clientWidth + 2 || !vis(el)) continue
    const s = getComputedStyle(el)
    if ((s.overflowX === 'hidden' || s.overflowX === 'clip') && s.textOverflow !== 'ellipsis' && txt(el)) add('Текст обрезан', el, txt(el))
  }
  // controls: out past the right edge; on top of each other
  // (only what is seen: a control hidden in its container's scroll is neither past the edge nor overlapping)
  /** Not seen at all: transparent (a checkbox's native input stretched over it), hidden from people. */
  const ghost = (el: Element) => {
    if (el.closest('[aria-hidden="true"]')) return true
    if (el instanceof HTMLInputElement && /^(checkbox|radio|file|range|color)$/.test(el.type)) return true
    for (let p: Element | null = el; p && p !== document.documentElement; p = p.parentElement) if (Number(getComputedStyle(p).opacity) < 0.05) return true
    return false
  }
  const ctl = [...document.querySelectorAll('button, .q-btn, a[href], input:not([type="hidden"]), select, textarea, .q-field, [role="button"], [role="tab"]')]
    .filter((el) => vis(el) && !ghost(el))
    .map((el) => ({ el, r: shown(el) }))
    .filter((x): x is { el: Element; r: NonNullable<ReturnType<typeof shown>> } => !!x.r)
    .slice(0, 300)
  for (const { el, r } of ctl) if (r.right > W + 2) add('За правым краем экрана', el, txt(el) || el.getAttribute('aria-label') || el.tagName.toLowerCase(), r)
  const boxes = ctl.filter((x) => !stuck(x.el))
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left)
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top)
      if (w <= 0 || h <= 0) continue
      const small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height)
      if (small > 0 && (w * h) / small > 0.3) add('Перекрываются', a.el, `${txt(a.el) || a.el.tagName.toLowerCase()} ↔ ${txt(b.el) || b.el.tagName.toLowerCase()}`, a.r)
    }
  return { hscroll, items: out }
}

/** A field as the page has it (runs in the page, on the field's element or its wrapper). */
const fieldProbe = (el: Element) => {
  const txt = (e: Element | null | undefined) => (e ? ((e as HTMLElement).innerText ?? e.textContent ?? '').replace(/\s+/g, ' ').trim() : '')
  const inp = (el.matches('input, textarea, select, [contenteditable="true"]') ? el : el.querySelector('input, textarea, select, [contenteditable="true"]')) as HTMLInputElement | null
  const fld = el.closest('.q-field') ?? el.querySelector('.q-field') ?? el
  // its label: Quasar's own, aria, else the words beside it in its row
  let label = txt(fld.querySelector('.q-field__label')) || inp?.getAttribute('aria-label') || ''
  if (!label) {
    let b: Element = fld
    for (let up = 0; up < 3 && b.parentElement && !label; up++) {
      for (let p = b.previousElementSibling; p && !label; p = p.previousElementSibling) {
        if (p.querySelector('input, textarea, select, .q-field')) break
        const t = txt(p)
        if (t && t.length < 80) label = t
      }
      b = b.parentElement
    }
  }
  const num = (s: string | null | undefined) => (s !== null && s !== undefined && s !== '' && !Number.isNaN(Number(s)) ? Number(s) : undefined)
  return {
    tag: (inp ?? el).tagName.toLowerCase(),
    type: inp?.getAttribute('type') ?? (inp?.tagName === 'TEXTAREA' ? 'textarea' : 'text'),
    inputmode: inp?.getAttribute('inputmode') ?? undefined,
    maxlength: inp && inp.maxLength > 0 ? inp.maxLength : num(fld.querySelector('[maxlength]')?.getAttribute('maxlength')),
    min: num(inp?.getAttribute('min')),
    max: num(inp?.getAttribute('max')),
    required: !!inp?.required || inp?.getAttribute('aria-required') === 'true' || /\*/.test(label) || !!fld.closest('.required, .is-required'),
    readonly: !!inp && (inp.readOnly || inp.disabled),
    select: !!el.closest('.q-select') || !!el.querySelector('.q-select') || inp?.tagName === 'SELECT',
    label: label.replace(/[:*]\s*$/, ''),
  }
}
/** What the page tells now: field errors, alerts, notifications (their words; at most a few). */
const hintProbe = () => {
  const out: string[] = []
  const vis = (e: Element) => (e as HTMLElement).getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'
  const sel =
    '.q-field--error .q-field__messages, .q-field__bottom .text-negative, .q-notification, [role="alert"], .el-form-item__error, .el-message--error, .invalid-feedback, .ant-form-item-explain-error, .Vue-Toastification__toast--error, .toast-error, .error-message'
  for (const e of document.querySelectorAll(sel)) {
    const t = ((e as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim()
    if (t && vis(e) && !out.includes(t)) out.push(t.slice(0, 160))
    if (out.length >= 5) break
  }
  // a field marked wrong without words: its label
  for (const e of document.querySelectorAll('[aria-invalid="true"]')) {
    if (!vis(e) || out.length >= 5) continue
    const lbl = e.closest('.q-field')?.querySelector('.q-field__label')?.textContent?.trim() || e.getAttribute('aria-label') || e.getAttribute('name') || 'поле'
    const t = `поле «${lbl}» отмечено как неверное`
    if (!out.includes(t)) out.push(t)
  }
  return out
}

export function makeQa(page: Page, step: Step, checks: QaCheck[], dir: string, filesRoot = '') {
  // the run's traffic (every request, in order); which of them a result rests on — an outcome adapter's choice
  const traffic = new Traffic(page)
  const sent = traffic.list
  /** «Набор/файл» of the notebook's test files → its path (nothing outside their folder). */
  const fileOf = (rel: string) => {
    const parts = String(rel).split(/[\\/]/).filter(Boolean)
    if (!filesRoot) throw new Error('qa.file: папка тестовых файлов неизвестна')
    if (parts.length !== 2 || parts.some((p) => p.startsWith('.') || /[:*?"<>|]/.test(p))) throw new Error(`qa.file('${rel}'): ожидается 'Набор/файл'`)
    const p = join(filesRoot, parts[0], parts[1])
    if (!existsSync(p)) throw new Error(`Нет тестового файла «${rel}» — он удалён или переименован в «Тестовых файлах»`)
    return p
  }
  const api = Traffic.data
  /** JS errors of the page (their time; a run per file says which came during it). */
  const pageErrors: Array<{ at: number; text: string }> = []
  page.on('pageerror', (e) => {
    pageErrors.push({ at: Date.now(), text: (e.message || String(e)).split('\n')[0].slice(0, 200) })
    // (a page throwing in a loop: the newest kept)
    if (pageErrors.length > 200) pageErrors.splice(0, 100)
  })
  const busy = Traffic.busy
  /** The page settled: no request of its own on the way for `idle` ms (at most `max`). */
  async function quiet(idle = 700, max = 20000): Promise<void> {
    const t0 = Date.now()
    let last = Date.now()
    while (Date.now() - t0 < max) {
      if (sent.some(busy)) last = Date.now()
      else if (Date.now() - last >= idle) break
      await page.waitForTimeout(100)
    }
    // the statuses come a moment after «finished»
    await page.waitForTimeout(150)
  }
  const mutations = (from: number) => sent.slice(from).filter((x) => MUT.test(x.method) && api(x))
  const ok2 = (x: Sent) => !!x.status && x.status >= 200 && x.status < 300
  /** A check written down; a failed one stops the run (as a failed expect). */
  function verdict(c: QaCheck): void {
    checks.push(c)
    if (c.state === 'fail') throw new Error(`Проверка «${c.name}» не прошла: ${c.summary}`)
  }

  /** What the page shows: its fields (by their labels) and its tables' rows. */
  const snap = () =>
    page.evaluate(() => {
      const out: Record<string, string> = {}
      const vis = (e: Element) => (e as HTMLElement).getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'
      const txt = (e: Element | null | undefined) => (e ? ((e as HTMLElement).innerText ?? e.textContent ?? '').replace(/\s+/g, ' ').trim() : '')
      const put = (k: string, v: string) => {
        let key = k
        for (let n = 2; key in out; n++) key = `${k} (${n})`
        out[key] = v
      }
      const labelOf = (el: Element, i: number): string => {
        const fld = el.closest('.q-field')
        const ql = fld?.querySelector('.q-field__label')
        if (ql && txt(ql)) return txt(ql)
        const aria = el.getAttribute('aria-label')
        if (aria) return aria
        // the label beside it in its row
        let b: Element = fld ?? el
        for (let up = 0; up < 3 && b.parentElement; up++) {
          for (let p = b.previousElementSibling; p; p = p.previousElementSibling) {
            if (p.querySelector('input, textarea, select, .q-field')) break
            const t = txt(p)
            if (t && t.length < 60) return t.replace(/[:*]\s*$/, '')
          }
          b = b.parentElement
        }
        return (el as HTMLInputElement).placeholder || el.getAttribute('name') || `поле ${i + 1}`
      }
      let i = 0
      for (const el of document.querySelectorAll('input, textarea, select, .q-select')) {
        if (!vis(el)) continue
        if (el instanceof HTMLInputElement && /^(hidden|password|file|submit|button|image|reset)$/.test(el.type)) continue
        // a Quasar select: its shown value (its own input is a search box)
        if (el.closest('.q-select') && el.tagName === 'INPUT') continue
        const v = el.matches('.q-select')
          ? txt(el.querySelector('.q-field__native'))
          : el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')
            ? el.checked ? 'да' : 'нет'
            : el instanceof HTMLSelectElement
              ? txt(el.selectedOptions[0])
              : (el as HTMLInputElement).value
        put(labelOf(el, i++), v)
      }
      let t = 0
      for (const table of document.querySelectorAll('table')) {
        if (!vis(table) || t >= 3) continue
        t++
        let r = 0
        for (const tr of table.querySelectorAll('tbody tr')) {
          if (!vis(tr) || r >= 100) continue
          put(`Таблица ${t}, строка ${++r}`, txt(tr).slice(0, 300))
        }
      }
      return out
    })
  /** Snapshots remembered by name (the context check). */
  const snaps = new Map<string, Record<string, string>>()
  const fieldsOnly = (x: Record<string, string>) => Object.fromEntries(Object.entries(x).filter(([k]) => !/^Таблица \d+, строка/.test(k)))
  /**
   * The page as it is now: its layout faults (each counted into `seen` by its kind and words, the screen noted), the
   * faults outlined on a picture of it (the outlines taken off after). Returns this screen's faults.
   */
  async function shoot(cdp: CDPSession, file: string, where: string, seen: Map<string, { kind: string; text: string; where: string[] }>): Promise<Flaw[]> {
    const r = ((await page.evaluate(probe).catch(() => undefined)) as { hscroll: number; items: Flaw[] } | undefined) ?? { hscroll: 0, items: [] }
    const flaws = [...r.items, ...(r.hscroll ? [{ kind: 'Прокрутка вбок', text: `страница шире окна на ${r.hscroll}px`, x: 0, y: 0, w: 0, h: 0 }] : [])]
    for (const x of flaws) {
      // (a page wider than the window — one finding, its widest overrun)
      const k = x.kind === 'Прокрутка вбок' ? x.kind : `${x.kind}|${x.text}`
      const e = seen.get(k) ?? { kind: x.kind, text: x.text, where: [] }
      if (x.kind === 'Прокрутка вбок') e.text = `страница шире окна (до ${Math.max(r.hscroll, Number(/\d+/.exec(e.text)?.[0] ?? 0))}px)`
      e.where.push(where)
      seen.set(k, e)
    }
    await page
      .evaluate((boxes: Flaw[]) => {
        const layer = document.createElement('div')
        layer.id = '__qa_layout'
        layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none'
        for (const b of boxes) {
          if (!b.w || !b.h) continue
          const d = document.createElement('div')
          d.style.cssText = `position:absolute;left:${b.x - 2}px;top:${b.y - 2}px;width:${b.w + 4}px;height:${b.h + 4}px;border:2px solid #ef4444;border-radius:3px;background:rgba(239,68,68,.12)`
          // what is wrong — on the outline itself
          const tag = document.createElement('span')
          tag.textContent = b.kind
          tag.style.cssText = 'position:absolute;left:-2px;top:-18px;padding:1px 5px;border-radius:3px;background:#ef4444;color:#fff;font:600 11px/15px system-ui,sans-serif;white-space:nowrap'
          d.appendChild(tag)
          layer.appendChild(d)
        }
        document.body.appendChild(layer)
      }, r.items)
      .catch(() => undefined)
    const pic = (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }).catch(() => undefined)) as { data: string } | undefined
    if (pic) writeFileSync(join(dir, file), Buffer.from(pic.data, 'base64'))
    await page.evaluate(() => document.getElementById('__qa_layout')?.remove()).catch(() => undefined)
    return flaws
  }
  const rowsNow = () => page.evaluate(() => [...document.querySelectorAll('table tbody tr')].filter((e) => (e as HTMLElement).getClientRects().length > 0).length)

  return {
    /**
     * The window as it was when recorded: its size in CSS px and its pixel density (the browser's zoom changes
     * both — a page lays itself out by them).
     */
    window: async (o: { width: number; height: number; dpr?: number }) => {
      await page.setViewportSize({ width: Math.round(o.width), height: Math.round(o.height) })
      if (o.dpr && Math.abs(o.dpr - 1) > 0.001) {
        const cdp = await page.context().newCDPSession(page)
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: Math.round(o.width), height: Math.round(o.height), deviceScaleFactor: o.dpr, mobile: false })
      }
    },
    /** A test file of the notebook: qa.file('Набор/файл.xlsx') → its path (for setInputFiles). */
    file: (rel: string) => fileOf(rel),
    /** The files of a set (their paths), by name. */
    files: (set: string) => {
      const d = join(filesRoot, set)
      return existsSync(d) ? readdirSync(d).filter((n) => !n.startsWith('.')).sort((a, b) => a.localeCompare(b, 'ru')).map((n) => fileOf(`${set}/${n}`)) : []
    },
    /**
     * Files dropped onto an element (a «перетащите файл сюда» area): the drag's events with the files, as a person's
     * drop gives them.
     */
    dropFiles: async (target: Locator, files: string | string[]) => {
      const MIME: Record<string, string> = { '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls': 'application/vnd.ms-excel', '.csv': 'text/csv', '.json': 'application/json', '.txt': 'text/plain', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.xml': 'application/xml', '.zip': 'application/zip', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
      const list = (Array.isArray(files) ? files : [files]).map((p) => ({ name: basename(p), type: MIME[extname(p).toLowerCase()] ?? '', b64: readFileSync(p).toString('base64') }))
      await target.scrollIntoViewIfNeeded().catch(() => undefined)
      await target.evaluate((el, fl) => {
        const dt = new DataTransfer()
        for (const f of fl) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.type }))
        for (const t of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }))
      }, list)
    },
    /**
     * The scenario once per file of a set (an upload, an import): what the server answered, what the page said,
     * against what each file should lead to (its mark in «Тестовые файлы»: take / refuse).
     */
    eachFile: (
      o: {
        set: string
        recorded?: string
        /** The upload's request (its endpoint, «POST /api/files/:id») — seen while recording; none — found by the file's content. */
        upload?: string
      },
      run: (file: string) => Promise<unknown>,
    ) =>
      step(`Проверка: сценарий с каждым файлом набора «${o.set}»`, async () => {
        const name = `С каждым файлом набора «${o.set}»`
        const d = join(filesRoot, o.set)
        let meta: Record<string, { expect?: TestFile['expect']; note?: string }> = {}
        try {
          meta = JSON.parse(readFileSync(join(d, '.meta.json'), 'utf8')) as typeof meta
        } catch {
          // no marks
        }
        const names = existsSync(d) ? readdirSync(d).filter((n) => !n.startsWith('.')).sort((a, b) => a.localeCompare(b, 'ru')) : []
        if (!names.length) return verdict({ kind: 'files', name, state: 'fail', summary: `в наборе «${o.set}» нет файлов — добавьте их в «Тестовых файлах»` })
        const head = ['Файл', 'Ожидание', 'Итог', 'Запросы загрузки', 'Подробно']
        const rows: string[][] = []
        const marks: Array<'ok' | 'warn' | 'fail'> = []
        const tally = { ok: 0, warn: 0, fail: 0 }
        // the answers kept: the upload's (its id) is what the requests after it are traced by
        const keepOff = traffic.keep()
        page.setDefaultNavigationTimeout(30000)
        page.setDefaultTimeout(10000)
        try {
          for (const n of names) {
            // the file before's requests still on their way — let go first
            for (let t = Date.now(); Date.now() - t < 60000 && sent.some((x) => !x.done && MUT.test(x.method)); ) await page.waitForTimeout(200)
            const from = traffic.mark()
            const t0 = Date.now()
            const path = fileOf(`${o.set}/${n}`)
            // what this file's result rests on: the upload recorded with the scenario, else the request carrying the file
            const adapter: OutcomeAdapter = upload({ name: basename(path), bytes: readFileSync(path) }, o.upload)
            let error: string | undefined
            await step(n, async () => {
              try {
                await run(path)
              } catch (e) {
                error = stepError(e, 10)
              }
            })
            // an import may take long: its requests let finish (up to 2 min), then the page's word
            for (let t = Date.now(); Date.now() - t < 120000 && traffic.from(from).some((x) => !x.done && MUT.test(x.method)); ) await page.waitForTimeout(200)
            await quiet(700, 8000)
            const picked = adapter.pick(traffic.from(from))
            const hints = (await page.evaluate(hintProbe).catch(() => [])) as string[]
            const expect = meta[n]?.expect
            const jsErrors = pageErrors.filter((x) => x.at >= t0).map((x) => x.text)
            const v = judgeFile(expect, {
              ...(error ? { error } : {}),
              muts: picked.map((x) => ({ status: x.status, res: x.res, line: line(x) })),
              hints,
              pageErrors: jsErrors,
              ...(picked.length ? {} : { others: changes(traffic.from(from)).map((x) => `${endpointOf(x)} → ${x.status ?? '…'}`) }),
            })
            tally[v.state]++
            const reqs = picked.length ? picked.map((x) => `${endpointOf(x)} → ${x.status ?? '…'}${x.res && (x.status ?? 0) >= 400 ? ` ${answerText(x.res)}` : ''}`).join('\n') : '— (запрос с файлом не найден)'
            rows.push([n, expect === 'ok' ? 'принять' : expect === 'bad' ? 'отклонить' : '—', v.result, reqs, [v.detail, meta[n]?.note ? `заметка: ${meta[n]!.note}` : ''].filter(Boolean).join('; ')])
            // this file's bodies (its upload's bytes, its answers) are done with
            traffic.release(traffic.mark())
            marks.push(v.state)
          }
        } finally {
          keepOff()
          page.setDefaultTimeout(30000)
        }
        const all = names.length
        // (a failure is the server's, or the scenario's own: it never got through to what it tests)
        const broke = rows.filter((r) => r[2] === 'Сценарий не прошёл').length
        const server = tally.fail - broke
        const summary = `файлов ${all}${broke ? `, сценарий не прошёл с ${broke} — шаг не выполнился, см. «Подробно»` : ''}${server ? `, ошибок сервера ${server}` : ''}${tally.warn ? `, не как ожидалось / стоит посмотреть ${tally.warn}` : ''}${!tally.fail && !tally.warn ? ' — все как ожидалось' : ''}`
        verdict({ kind: 'files', name, state: tally.fail ? 'fail' : tally.warn ? 'warn' : 'ok', summary, head, rows, marks })
      }),

    /** The save done by `save`; then the page left (back — or by `leave`): no «unsaved changes» may show. */
    saveAndLeave: (save: () => Promise<unknown>, leave?: () => Promise<unknown>) =>
      step('Проверка: сохранить и уйти', async () => {
        const name = 'Сохранить и уйти'
        await quiet()
        const from = sent.length
        await save()
        await quiet()
        const muts = mutations(from)
        const good = muts.filter(ok2)
        if (!muts.length) return verdict({ kind: 'leave', name, state: 'fail', summary: 'сохранение не отправило на сервер ни одного запроса (POST / PUT / PATCH / DELETE)' })
        if (!good.length) return verdict({ kind: 'leave', name, state: 'fail', summary: `сохранение не прошло: ${muts.map(line).join(', ')}`, head: ['Запрос', 'Ответ'], rows: muts.map((x) => [`${x.method} ${pathOf(x.url)}`, String(x.status ?? '…')]) })
        let native = ''
        const onDialog = (d: { message(): string; dismiss(): Promise<void> }) => {
          native = d.message() || 'окно браузера «Покинуть страницу?»'
          void d.dismiss().catch(() => undefined)
        }
        page.on('dialog', onDialog)
        const at = page.url()
        try {
          if (leave) await leave()
          else if (await page.evaluate(() => history.length > 1).catch(() => false)) {
            // back (in an app it is often the same document — no «navigation» for Playwright, the dialog shows anyway)
            await page.goBack({ timeout: 5000 }).catch(() => null)
          } else {
            // nowhere back: away from the site (its own «leave the site?» prompt comes here)
            await page.goto('about:blank', { timeout: 5000 }).catch(() => undefined)
          }
          await page.waitForTimeout(1200)
        } finally {
          page.off('dialog', onDialog)
        }
        const shown = await page
          .evaluate((src) => {
            const rx = new RegExp(src, 'i')
            for (const d of document.querySelectorAll('.q-dialog, [role="dialog"], [role="alertdialog"], .el-message-box, .modal.show, .ant-modal')) {
              const t = (d.textContent ?? '').replace(/\s+/g, ' ').trim()
              if (rx.test(t)) return t.slice(0, 200)
            }
            return ''
          }, UNSAVED_TEXT.source)
          .catch(() => '')
        const saved = good.map(line).join(', ')
        const dialog = shown || native
        // left to an empty tab (back from the scenario's first page — a new tab's history starts at about:blank — or
        // away): the page opened again, so the lines after it (the layout, a reload…) see it, not a blank tab
        if (page.url().startsWith('about:') && !at.startsWith('about:')) {
          await page.goto(at, { timeout: 30000 }).catch(() => undefined)
          await quiet()
        }
        if (dialog)
          return verdict({
            kind: 'leave',
            name,
            state: 'fail',
            summary: `после успешного сохранения при уходе со страницы появилось «${dialog}»`,
            head: ['Что', 'Как было'],
            rows: [
              ['Сохранение', saved],
              ['Уход', leave ? 'своим действием' : 'назад'],
              ['Окно', dialog],
            ],
          })
        verdict({ kind: 'leave', name, state: 'ok', summary: `сохранено (${saved}), со страницы ушли — окна о несохранённых изменениях нет` })
      }),

    /** The page's fields and tables before and after a reload: they must be the same (what was saved stays). */
    sameAfterReload: () =>
      step('Проверка: сравнить с перезагрузкой', async () => {
        const name = 'Сравнить с перезагрузкой'
        if (page.url().startsWith('about:')) return verdict({ kind: 'reload', name, state: 'warn', summary: `вкладка пустая (${page.url()}) — сравнивать нечего` })
        await quiet()
        const a = await snap()
        await page.reload({ waitUntil: 'load' })
        await quiet(1000, 30000)
        const b = await snap()
        const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
        const diff = keys.filter((k) => (a[k] ?? '') !== (b[k] ?? '')).map((k) => [k, a[k] ?? '— нет —', b[k] ?? '— нет —'])
        const fields = Object.keys(a).filter((k) => !/^Таблица \d+, строка/.test(k)).length
        const rows = Object.keys(a).length - fields
        if (diff.length) return verdict({ kind: 'reload', name, state: 'fail', summary: `после перезагрузки страница другая: отличий ${diff.length}`, head: ['Что', 'До перезагрузки', 'После'], rows: diff.slice(0, 40) })
        verdict({ kind: 'reload', name, state: 'ok', summary: `полей ${fields}, строк таблиц ${rows} — после перезагрузки всё так же` })
      }),

    /** The click twice in a row (as a hurried hand): the same request must not go twice. */
    doubleSubmit: (target: Locator) =>
      step('Проверка: двойной клик', async () => {
        const name = 'Двойной клик по сохранению'
        await quiet()
        const from = sent.length
        await target.click()
        // the second one at once; a button that went disabled / away refuses it — that is the protection
        await target.click({ timeout: 1500 }).catch(() => undefined)
        await quiet()
        const muts = mutations(from)
        const groups = new Map<string, Sent[]>()
        for (const x of muts) {
          const k = `${x.method} ${x.url} ${x.body ?? ''}`
          groups.set(k, [...(groups.get(k) ?? []), x])
        }
        const twice = [...groups.values()].filter((g) => g.length > 1)
        if (twice.length)
          return verdict({
            kind: 'double',
            name,
            state: 'fail',
            summary: `ушло два одинаковых запроса: ${twice.map((g) => `${g[0].method} ${pathOf(g[0].url)} ×${g.length}`).join(', ')}`,
            head: ['Запрос', 'Ответы'],
            rows: twice.map((g) => [`${g[0].method} ${pathOf(g[0].url)}`, g.map((x) => String(x.status ?? '…')).join(', ')]),
          })
        if (!muts.length) return verdict({ kind: 'double', name, state: 'warn', summary: 'клики не отправили запросов на сервер — нечего было дублировать (это точно кнопка сохранения?)' })
        verdict({ kind: 'double', name, state: 'ok', summary: `второй клик не отправил повтор: ${muts.map(line).join(', ')}` })
      }),

    /** The actions twice in a row: what each time sent and how the tables' rows changed. */
    repeat: (actions: () => Promise<unknown>) =>
      step('Проверка: повторить дважды', async () => {
        const name = 'Повторить действия дважды'
        await quiet()
        const r0 = await rowsNow()
        const f1 = sent.length
        await step('1-й раз', actions)
        await quiet()
        const m1 = mutations(f1)
        const r1 = await rowsNow()
        const f2 = sent.length
        await step('2-й раз', actions)
        await quiet()
        const m2 = mutations(f2)
        const r2 = await rowsNow()
        const head = ['Что', '1-й раз', '2-й раз']
        const rows = [
          ['Запросы на изменение', m1.map(line).join('\n') || '—', m2.map(line).join('\n') || '—'],
          ['Строк в таблицах', `${r0} → ${r1}`, `${r1} → ${r2}`],
        ]
        const bad2 = m2.filter((x) => !ok2(x))
        if (bad2.length) return verdict({ kind: 'repeat', name, state: 'fail', summary: `во 2-й раз сервер ответил ошибкой: ${bad2.map(line).join(', ')}`, head, rows })
        if (r1 > r0 && r2 > r1) return verdict({ kind: 'repeat', name, state: 'warn', summary: `каждый раз добавлялись строки (${r0} → ${r1} → ${r2}) — если повтор не должен создавать дубль, это баг`, head, rows })
        verdict({ kind: 'repeat', name, state: 'ok', summary: 'повтор прошёл без ошибок сервера', head, rows })
      }),

    /**
     * «Перебор параметров запроса»: the request the scenario sent (else the API map's example of it) — sent again
     * with each chosen parameter tried, the others as they were; with the page's own login (its cookies, the headers
     * of its own requests to that site — a token never written anywhere). What each answer was, where it breaks.
     */
    fuzz: (spec: FuzzSpec) =>
      step('Проверка: перебор параметров запроса', async () => {
        const name = 'Перебор параметров запроса'
        const head = ['Параметр', 'Вариант', 'Статус', 'Время', 'Найдено', 'Итог']
        if (!spec.request.trim()) return verdict({ kind: 'fuzz', name, state: 'warn', summary: 'запрос не выбран — выберите его в «Параметры перебора»' })
        if (!spec.params.some((p) => p.cases.length)) return verdict({ kind: 'fuzz', name, state: 'warn', summary: 'не задано ни одного варианта — добавьте параметры и их значения в «Параметры перебора»' })
        await quiet()
        const [method, path] = spec.request.trim().split(/\s+/, 2)
        const sentIt = [...sent].reverse().find((x) => x.method.toUpperCase() === method.toUpperCase() && endpointKey(x.method, x.url) === `${method.toUpperCase()} ${path}`)
        const header = (h: Record<string, string>, k: string) => Object.entries(h).find(([n]) => n.toLowerCase() === k)?.[1]
        const tpl: ReqParts | undefined = sentIt
          ? { method: sentIt.method, url: sentIt.url, body: sentIt.body, contentType: header(sentIt.reqHeaders, 'content-type') }
          : spec.sample?.url
            ? { method: method.toUpperCase(), url: spec.sample.url, body: spec.sample.body, contentType: spec.sample.contentType ?? (!spec.sample.body ? undefined : /^\s*[[{]/.test(spec.sample.body) ? 'application/json' : /^[^=&\s]+=[^&]*(&|$)/.test(spec.sample.body) ? 'application/x-www-form-urlencoded' : undefined) }
            : undefined
        if (!tpl) return verdict({ kind: 'fuzz', name, state: 'fail', summary: `запрос «${spec.request}» сценарий не отправил, и образца нет — допишите в сценарий действие, которое его отправляет (например, «Найти»), или выберите образец из карты API` })
        // the login: the headers the page itself sent to that site (the request itself, else its latest to that origin)
        const origin = new URL(tpl.url).origin
        const own = sentIt ?? [...sent].reverse().find((x) => api(x) && /^(xhr|fetch)$/.test(x.type) && x.url.startsWith(origin) && header(x.reqHeaders, 'authorization')) ?? [...sent].reverse().find((x) => api(x) && /^(xhr|fetch)$/.test(x.type) && x.url.startsWith(origin))
        const SKIP = /^(host|content-length|cookie|connection|accept-encoding|origin|referer|:.*|sec-.*|upgrade-insecure-requests|priority)$/i
        const headers: Record<string, string> = Object.fromEntries(Object.entries(own?.reqHeaders ?? {}).filter(([k]) => !SKIP.test(k)))
        if (tpl.contentType) headers['content-type'] = tpl.contentType
        let d: ReturnType<typeof decodeRequest>
        try {
          d = decodeRequest(tpl)
        } catch (e) {
          return verdict({ kind: 'fuzz', name, state: 'fail', summary: `запрос не разобрать: ${e instanceof Error ? e.message : String(e)}` })
        }
        /**
         * One request — sent by the page itself (its cookies, the browser's network: its proxy, its certificates — as
         * the app sends it): its status, time, how many were found, a word of the server's when it failed.
         */
        type Got = { status: number; ms: number; ct: string; b64: string; bytes: number } | { status: number; ms: number; error: string }
        const send = async (url: string, body?: string) => {
          const r = await page
            .evaluate(
              async ({ url, method, headers, body }) => {
                const t0 = performance.now()
                const ctl = new AbortController()
                const stop = setTimeout(() => ctl.abort(), 60_000)
                try {
                  const res = await fetch(url, { method, headers, body: /^(GET|HEAD)$/i.test(method) || body === undefined || body === '' ? undefined : body, credentials: 'include', signal: ctl.signal })
                  const buf = new Uint8Array(await res.arrayBuffer())
                  const ms = Math.round(performance.now() - t0)
                  // (the bytes back to the runner — an export's file counted there; a huge one cut)
                  let bin = ''
                  const max = Math.min(buf.length, 30_000_000)
                  for (let i = 0; i < max; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, Math.min(i + 0x8000, max)))
                  return { status: res.status, ms, ct: res.headers.get('content-type') ?? '', b64: btoa(bin), bytes: buf.length }
                } catch (e) {
                  return { status: 0, ms: Math.round(performance.now() - t0), error: ctl.signal.aborted ? 'нет ответа за 60 с' : String(e) }
                } finally {
                  clearTimeout(stop)
                }
              },
              { url, method: tpl.method, headers, body },
            )
            .then((x) => x as Got)
            .catch((e: unknown): Got => ({ status: 0, ms: 0, error: e instanceof Error ? e.message.split('\n')[0] : String(e) }))
          if (!('b64' in r)) return { status: 0, ms: r.ms, bytes: 0, error: short(r.error, 120) }
          const buf = Buffer.from(r.b64, 'base64')
          let found: number | undefined
          let said: string | undefined
          let file = false
          const text = /json|text|xml|csv/i.test(r.ct) || !r.ct ? buf.toString('utf8') : ''
          if (/json/i.test(r.ct) || /^\s*[[{]/.test(text.slice(0, 1))) {
            try {
              found = foundIn(JSON.parse(text), spec.found || undefined).n
            } catch {
              // not JSON after all
            }
          } else if (/spreadsheet|excel|octet-stream|zip/i.test(r.ct) && buf.subarray(0, 2).toString() === 'PK') {
            found = await xlsxRows(buf)
            file = found !== undefined
          } else if (/csv/i.test(r.ct)) {
            found = Math.max(0, text.split(/\r?\n/).filter((l) => l.trim()).length - 1)
            file = true
          }
          if (r.status >= 400) said = short(text.replace(/\s+/g, ' ').trim(), 120) || undefined
          return { status: r.status, ms: r.ms, found, bytes: r.bytes, said, file }
        }
        // the original first: it must pass, else every try says nothing
        const base = await step('Исходный запрос', () => send(tpl.url, tpl.body))
        if (!(base.status >= 200 && base.status < 300))
          return verdict({ kind: 'fuzz', name, state: 'fail', summary: `исходный запрос не прошёл: ${tpl.method} ${pathOf(tpl.url)} → ${base.status || base.error}${base.status === 401 || base.status === 403 ? ' — нет входа: включите «вход из Браузера» и войдите на сайт во вкладке Браузера' : ''}${base.said ? ` — ${base.said}` : ''}` })
        const results: FuzzResult[] = []
        let denied = 0
        for (const p of spec.params) {
          const segs = parsePath(p.path)
          const orig = getPath(d.tree, segs)
          for (const c of p.cases) {
            let value: unknown
            try {
              value = evalCase(c.value, orig.value, gen)
            } catch (e) {
              results.push({ param: p.path, label: c.label, value: c.value, status: 0, ms: 0, bytes: 0, error: `значение не вычислить: ${e instanceof Error ? e.message : String(e)}` })
              continue
            }
            const r = encodeRequest(tpl, d, setPath(d.tree, segs, value))
            const out = await step(`${p.path}: ${c.label}`, () => send(r.url, r.body))
            results.push({ param: p.path, label: c.label, value: c.value, size: Array.isArray(value) ? value.length : undefined, ...out })
            // the login gone (three refusals in a row) — the rest would say only that
            denied = out.status === 401 ? denied + 1 : 0
            if (denied >= 3) {
              const v = judgeFuzz(base, results, spec)
              return verdict({ kind: 'fuzz', name, state: 'fail', summary: `вход истёк на «${p.path}: ${c.label}» (401 три раза подряд) — остальные варианты не отправлены`, head, rows: v.rows, marks: v.marks, group: true })
            }
          }
        }
        const v = judgeFuzz(base, results, spec)
        verdict({ kind: 'fuzz', name, state: v.state, summary: `${v.summary}; исходный: ${base.status}, ${base.ms} мс${base.found !== undefined ? `, найдено ${base.found}` : ''}`, head, rows: v.rows, marks: v.marks, group: true })
      }),

    /**
     * The field matrix: the scenario run once as recorded (the reference: the save goes, and where each field's
     * value is in its body), then once per try — one field's value changed, the others as recorded; at the end once
     * more as recorded (the record back as it was). Each try: the changes sent and their answers, what the page
     * told, what the field shows, what went in the body at the field's place.
     */
    fieldMatrix: (
      fields: Record<
        string,
        {
          name: string
          value: string
          field: () => Locator
          /** Values of one's own (gen.… or literals; an object — as JSON); `bad` — the form should refuse it. */
          cases?: Array<{ label: string; value: unknown; bad?: boolean }>
          /** (scenarios of before: the values by the field's type — no more; the values are one's own only) */
          auto?: boolean
        }
      >,
      run: (v: Record<string, string>) => Promise<unknown>,
    ) =>
      step('Проверка: матрица значений полей', async () => {
        const name = 'Матрица значений полей'
        const ids = Object.keys(fields)
        // nothing to try: not a run (each run saves — records made for nothing)
        if (!ids.some((k) => fields[k].cases?.length))
          return verdict({ kind: 'matrix', name, state: 'warn', summary: 'значения не заданы ни для одного поля — добавьте их в «Значения матрицы» (свои или типовые наборы)' })
        const recorded = Object.fromEntries(ids.map((k) => [k, fields[k].value]))
        // (a step's failure said as the other checks say it: what was not found)
        const msg = (e: unknown) => stepError(e, 6)
        const valuesOf = (over: Record<string, string>) => new Proxy({} as Record<string, string>, { get: (_t, k: string) => over[k] ?? recorded[k] })
        // a form that will not save waits its button out: seconds, not the half minute (pages still load as long as they need)
        page.setDefaultNavigationTimeout(30000)
        page.setDefaultTimeout(6000)
        // the answers kept: the page's data loaded before a save — what the try before stored
        const keepOff = traffic.keep()
        try {
          // 1. the fields looked at: the scenario up to its first typing
          const STOP = new Error('__qa_matrix_stop')
          try {
            await run(new Proxy({} as Record<string, string>, { get: () => { throw STOP } }))
          } catch (e) {
            if (e !== STOP) return verdict({ kind: 'matrix', name, state: 'fail', summary: `сценарий не дошёл до первого поля: ${msg(e)}` })
          }
          const info: Record<string, Partial<FieldInfo>> = {}
          for (const k of ids) info[k] = ((await fields[k].field().first().evaluate(fieldProbe, undefined, { timeout: 3000 }).catch(() => undefined)) as Partial<FieldInfo> | undefined) ?? {}

          const saveOf = (x: Sent) => `${x.method} ${pathOf(x.url)}`
          const hintsNow = async () => (await page.evaluate(hintProbe).catch(() => [])) as string[]
          const json = (s?: string) => {
            try {
              return s ? (JSON.parse(s) as unknown) : undefined
            } catch {
              return undefined
            }
          }
          /**
           * One run of the scenario. Before it — only a change still on its way (the try before's late save) is waited
           * for, not the page's quiet (its polling, its live connections never let it be quiet). After it — the save
           * itself (it may go a moment after the click: a form validating on the server, a debounce), or the form's
           * word, or the run's stop. The data the page loaded before saving is kept: the stored values of the try before.
           */
          const once = async (over: Record<string, string>, title: string, saveKey?: string) => {
            for (let t = Date.now(); Date.now() - t < 5000 && sent.some((x) => !x.done && MUT.test(x.method) && api(x)); ) await page.waitForTimeout(100)
            const from = sent.length
            let error: string | undefined
            await step(title, async () => {
              try {
                await run(valuesOf(over))
              } catch (e) {
                error = msg(e)
              }
            })
            // the save: the try's own endpoint once known; before — the change carrying the values typed (not whatever
            // else the page sent on the way: a dialog's OK, a list's search)
            const typed = ids.map((k) => over[k] ?? recorded[k])
            const isSave = (x: Sent) => (saveKey ? saveOf(x) === saveKey : valuesIn(x.body, typed) > 0)
            for (let t = Date.now(); !error && Date.now() - t < 5000; ) {
              const s = mutations(from).filter(isSave)
              if (s.some((x) => x.done && x.status !== undefined)) break
              // gone and not answered yet: its answer is the outcome — waited for below, not cut off here
              if (s.length) break
              if ((await hintsNow()).length) break
              await page.waitForTimeout(200)
            }
            // a change on its way is no outcome: its answer waited for (a slow server — up to half a minute)
            for (let t = Date.now(); Date.now() - t < 30000 && mutations(from).some((x) => !x.done || x.status === undefined); ) await page.waitForTimeout(150)
            // the save answered: a moment for the form to show its word (no quiet — the data loaded before the save is
            // all there is to read; the page's polling would only hold it)
            await page.waitForTimeout(300)
            const part = sent.slice(from)
            const at = part.findIndex((x) => MUT.test(x.method) && api(x) && (!saveKey || saveOf(x) === saveKey))
            // what the try needs, copied: its changes (the save's body and answer), the data loaded before its save
            // (only the endpoints the stored values are in, once they are known) — the run's bodies then let go
            const gets = part
              .slice(0, at < 0 ? part.length : at)
              .filter((x) => x.method === 'GET' && x.res !== undefined && (!storeEps || storeEps.has(saveOf(x))))
              .map((x) => ({ ep: saveOf(x), res: x.res! }))
            const out = { error, muts: mutations(from).map(snap), hints: await hintsNow(), gets }
            traffic.release(traffic.mark())
            return out
          }
          /** A change as a try keeps it (no live request, no bytes). */
          const snap = (x: Sent) => ({ status: x.status, res: x.res, line: line(x), ep: saveOf(x), body: x.body })
          const good = (x?: { status?: number }) => !!x?.status && x.status >= 200 && x.status < 300
          /** The endpoints whose answers hold the fields' stored values (known after the first try's run). */
          let storeEps: Set<string> | undefined
          const valueOf = (k: string) =>
            fields[k]
              .field()
              .first()
              .evaluate((el) => {
                const i = (el.matches('input, textarea') ? el : el.querySelector('input, textarea')) as HTMLInputElement | null
                return i ? i.value : (el as HTMLElement).innerText
              }, undefined, { timeout: 300 })
              .catch(() => undefined) as Promise<string | undefined>

          // 2. the reference: as recorded — the save goes; where each value is in its body
          const ref = await once({}, 'Эталон: записанные значения')
          // the reference must do what the scenario was recorded doing — a step that fails there fails every try
          if (ref.error) return verdict({ kind: 'matrix', name, state: 'fail', summary: `сценарий с записанными значениями не прошёл: ${ref.error} — матрице не на чем перебирать (локатор поля не находит его? перезапишите шаг)` })
          // the save: the change carrying the values typed — not whatever the page happened to send (its tracking, its
          // error reports, a token's refresh)
          const saved = saveCarrying(ref.muts, ids.map((k) => recorded[k]))
          if (!saved) {
            const seen = ref.muts.length ? `изменяющие запросы прогона: ${ref.muts.map((x) => x.line).join(', ')}` : 'изменяющих запросов не было'
            return verdict({ kind: 'matrix', name, state: 'fail', summary: `запрос сохранения с введёнными значениями не найден (${seen}) — сохранение не ушло${ref.hints.length ? `; на форме: ${ref.hints.join(' · ')}` : ''}` })
          }
          if (saved.status === undefined) return verdict({ kind: 'matrix', name, state: 'fail', summary: `сервер не ответил на сохранение за 30 с: ${saved.line}` })
          if (!good(saved)) return verdict({ kind: 'matrix', name, state: 'fail', summary: `с записанными значениями сохранение не прошло: ${saved.line}${saved.res ? ` — ${short(saved.res, 120)}` : ''}` })
          const saveKey = saved.ep
          const refBody = json(saved.body)
          // every place the recorded value is in the body; the one that changes with the field is it
          const where = Object.fromEntries(ids.map((k) => [k, refBody === undefined ? [] : findPaths(refBody, recorded[k])]))
          const sentAt = (k: string, body: unknown) => {
            const all = where[k].map((p) => getAt(body, p)).filter((x) => x.has)
            if (!all.length) return undefined
            const moved = all.filter((x, i) => String(x.value) !== String(getAt(refBody, where[k][i]).value))
            return moved.length === 1 ? moved[0] : all[0]
          }
          // 3. the tries — run first, judged after: what a try stored is seen in the next run's data (the page,
          // opened again, loads the record from the server before anything is typed)
          type Try = { k: string; c: MatrixCase; o: Awaited<ReturnType<typeof once>>; shown?: string }
          /**
           * Where each field's stored value is in the data a page loads (from the run that loaded the record as the
           * reference saved it): every place the recorded value is (a few); the one that moves with the field is it.
           */
          let stores: Record<string, Array<{ ep: string; path: Array<string | number>; was: unknown }>> | undefined
          const locate = (gets: Array<{ ep: string; res: string }>) => {
            stores = Object.fromEntries(
              ids.map((k) => [
                k,
                gets.flatMap((g) => {
                  const b = json(g.res)
                  return b === undefined ? [] : findPaths(b, recorded[k], 3).map((p) => ({ ep: g.ep, path: p, was: getAt(b, p).value }))
                }).slice(0, 6),
              ]),
            )
            storeEps = new Set(Object.values(stores).flatMap((l) => l.map((s) => s.ep)))
          }
          const tries: Array<Try | { k: string; skip: string }> = []
          const show = (s: string) => (s === '' ? '(пусто)' : s.trim() === '' ? `(${s.length} пробела)` : s.length > 32 ? `«${s.slice(0, 24)}…» (${s.length} симв.)` : `«${s}»`)
          for (const k of ids) {
            const f = info[k]
            const own = (fields[k].cases ?? []).map((c): MatrixCase => {
              const raw = typeof c.value === 'function' ? (c.value as () => unknown)() : c.value
              const value = typeof raw === 'string' ? raw : raw === undefined || raw === null ? '' : typeof raw === 'object' ? JSON.stringify(raw) : String(raw)
              return { label: c.label, value, bad: !!c.bad, ...(value.trim() === '' ? { empty: true } : {}) }
            })
            // only the values one put down (the «Значения матрицы»): a field with none is not tried
            if (!own.length) {
              tries.push({ k, skip: f.select ? 'выбор из списка — значений не задано' : f.readonly ? 'поле только для чтения — значений не задано' : 'значений не задано' })
              continue
            }
            for (const c of own) {
              const o = await once({ [k]: c.value }, `${fields[k].name}: ${c.label}`, saveKey)
              tries.push({ k, c, o, shown: await valueOf(k) })
              // the first try's run loaded the record as the reference saved it: where the values are is known now
              if (!stores) locate(o.gets)
            }
          }
          // 4. the record back as recorded (its run's data — what the last try stored)
          const back = await once({}, 'Вернуть записанные значения', saveKey)
          if (!stores) locate(back.gets)
          const edit = ids.some((k) => (stores?.[k] ?? []).length > 0)
          const storedIn = (k: string, gets: Array<{ ep: string; res: string }>): string | undefined => {
            const found = (stores?.[k] ?? []).flatMap((s) => {
              const g = gets.find((x) => x.ep === s.ep)
              const b = g && json(g.res)
              const v = b === undefined ? undefined : getAt(b, s.path)
              return v?.has ? [{ v: v.value, moved: String(v.value) !== String(s.was) }] : []
            })
            if (!found.length) return undefined
            const moved = found.filter((x) => x.moved)
            const v = (moved.length === 1 ? moved[0] : found[0]).v
            return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
          }

          const head = ['Поле', 'Вариант', 'Значение', 'Итог', 'Ушло в запрос', ...(edit ? ['Сохранилось'] : []), 'Подробно']
          const rows: string[][] = []
          const marks: Array<'ok' | 'warn' | 'fail'> = []
          const tally = { ok: 0, warn: 0, fail: 0 }
          tries.forEach((t, i) => {
            if (!('o' in t)) {
              rows.push([fields[t.k].name, '—', '—', 'Пропущено', '—', ...(edit ? ['—'] : []), t.skip])
              marks.push('ok')
              return
            }
            const { k, c, o } = t
            const save = [...o.muts].reverse().find((x) => x.ep === saveKey)
            const body = json(save?.body)
            const went = save && body !== undefined ? sentAt(k, body) : undefined
            // the next run's data (the last try's — the restoring run's)
            const nextGets = (tries.slice(i + 1).find((x): x is Try => 'o' in x)?.o ?? back).gets
            const stored = edit && good(save) ? storedIn(k, nextGets) : undefined
            const v = judge(c, !!info[k].required, {
              ...(o.error ? { error: o.error } : {}),
              // (only the save's own requests: the page's other traffic says nothing of this value)
              muts: o.muts.filter((x) => x.ep === saveKey).map((x) => ({ status: x.status, res: x.res, line: x.line })),
              hints: o.hints,
              ...(t.shown !== undefined ? { shown: t.shown } : {}),
              ...(went ? { sent: went } : {}),
              ...(stored !== undefined ? { stored } : {}),
            })
            tally[v.state]++
            const wentText = !save ? '—' : !good(save) ? `${save.status ?? '…'}` : went ? short(JSON.stringify(went.value)) : refBody === undefined ? 'не JSON' : 'поля в теле нет'
            rows.push([fields[k].name, c.label, show(c.value), v.result, wentText, ...(edit ? [stored === undefined ? '—' : show(stored)] : []), v.detail])
            marks.push(v.state)
          })
          const all = tally.ok + tally.warn + tally.fail
          // (a failure is the server's, or the scenario's own — it never got to the save)
          const broke = rows.filter((r) => r[3] === 'Сценарий не прошёл').length
          const server = tally.fail - broke
          const summary = `вариантов ${all}${broke ? `, сценарий не прошёл в ${broke} — см. «Подробно»` : ''}${server ? `, ошибок сервера ${server}` : ''}${tally.warn ? `, стоит посмотреть ${tally.warn}` : ''} — по ${ids.length} ${plural(ids.length, 'полю', 'полям', 'полям')}; в конце записанные значения возвращены`
          verdict({ kind: 'matrix', name, state: tally.fail ? 'fail' : tally.warn ? 'warn' : 'ok', summary, head, rows, marks, group: true })
        } finally {
          keepOff()
          page.setDefaultTimeout(30000)
        }
      }),

    /**
     * The page as it is now on other screens: widths × the browser's zoom (a zoom Z — the page sees Z% fewer CSS
     * pixels and Z% more density). The faults are outlined on a picture of each; the window goes back after.
     */
    layout: (o: { widths?: number[]; zooms?: number[]; height?: number } = {}) =>
      step('Проверка: вёрстка на разных экранах', async () => {
        const name = 'Вёрстка на разных экранах'
        // nothing to look at: a blank tab (the scenario never opened a page, or left it)
        if (page.url().startsWith('about:'))
          return verdict({ kind: 'layout', name, state: 'warn', summary: `вкладка пустая (${page.url()}) — проверять нечего: поставьте вёрстку после строки, где открыта нужная страница` })
        const widths = o.widths ?? [375, 768, 1280, 1920]
        const zooms = o.zooms ?? [80, 100, 125]
        const H = o.height ?? 900
        const was = page.viewportSize()
        const cdp = await page.context().newCDPSession(page)
        await quiet()
        const shots: NonNullable<QaCheck['shots']> = []
        const seen = new Map<string, { kind: string; text: string; where: string[] }>()
        try {
          for (const w of widths)
            for (const z of zooms) {
              const cw = Math.round((w * 100) / z)
              const ch = Math.round((H * 100) / z)
              await cdp.send('Emulation.setDeviceMetricsOverride', { width: cw, height: ch, deviceScaleFactor: z / 100, mobile: false })
              await page.waitForTimeout(400)
              await quiet(300, 5000)
              const where = `${w} px · ${z}%`
              const file = `layout-${w}x${H}-${z}.png`
              const flaws = await shoot(cdp, file, where, seen)
              shots.push({ file, label: where, bad: flaws.length })
            }
        } finally {
          await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined)
          if (was) await page.setViewportSize(was).catch(() => undefined)
        }
        const list = [...seen.values()]
        const rows = list.slice(0, 40).map((x) => [x.kind, x.text, x.where.length === shots.length ? 'на всех' : x.where.join(', ')])
        if (list.length) return verdict({ kind: 'layout', name, state: 'fail', summary: `найдено проблем: ${list.length} (на ${shots.filter((x) => x.bad).length} из ${shots.length} экранов)`, head: ['Что', 'Где на странице', 'Экраны'], rows, shots })
        verdict({ kind: 'layout', name, state: 'ok', summary: `${shots.length} экранов — без прокрутки вбок, вылезающего и обрезанного текста, перекрытий`, shots })
      }),

    /**
     * The whole scenario on each screen: run anew in a window of each width (× zoom); where it ends — the layout
     * looked at and a picture; a step it could not do there (a button gone into a menu on a narrow screen) — said,
     * with a picture of where it stopped, and the next screen goes on.
     */
    layoutEach: (o: { widths?: number[]; zooms?: number[]; height?: number }, run: () => Promise<unknown>) =>
      step('Проверка: весь сценарий на каждом экране', async () => {
        const name = 'Вёрстка: весь сценарий на каждом экране'
        const widths = o.widths ?? [375, 768, 1280, 1920]
        const zooms = o.zooms ?? [100]
        const H = o.height ?? 900
        const was = page.viewportSize()
        const cdp = await page.context().newCDPSession(page)
        const shots: NonNullable<QaCheck['shots']> = []
        const seen = new Map<string, { kind: string; text: string; where: string[] }>()
        const rows: string[][] = []
        const marks: Array<'ok' | 'warn' | 'fail'> = []
        // a step that cannot be done on this screen says so in seconds, not in half a minute
        page.setDefaultNavigationTimeout(30000)
        page.setDefaultTimeout(8000)
        try {
          for (const w of widths)
            for (const z of zooms) {
              const cw = Math.round((w * 100) / z)
              const ch = Math.round((H * 100) / z)
              // 100% — the window itself (the scenario's clicks land as on a real one); a zoom — the density emulated
              await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined)
              await page.setViewportSize({ width: cw, height: ch })
              if (z !== 100) await cdp.send('Emulation.setDeviceMetricsOverride', { width: cw, height: ch, deviceScaleFactor: z / 100, mobile: false })
              const where = `${w} px · ${z}%`
              let error: string | undefined
              await step(where, async () => {
                try {
                  await run()
                } catch (e) {
                  // «Timeout exceeded» says little: what it waited for (Playwright's call log names it)
                  const m = (e instanceof Error ? e.message : String(e)).replace(/\u001b\[[\d;]*m/g, '')
                  const what = /waiting for (.+)/.exec(m)?.[1]
                  error = /Timeout \d+ms exceeded/.test(m) && what ? `не найден или недоступен за 8 с: ${what.trim()}` : m.split('\n')[0]
                }
              })
              await quiet(300, 4000)
              const file = `layout-${w}x${H}-${z}.png`
              const flaws = await shoot(cdp, file, where, seen)
              shots.push({ file, label: error ? `${where} · не прошёл` : where, bad: flaws.length + (error ? 1 : 0) })
              const said = [...new Set(flaws.map((x) => `${x.kind}: ${x.text}`))].slice(0, 3).join('; ')
              rows.push([where, error ? 'Сценарий не прошёл' : flaws.length ? `Проблем: ${flaws.length}` : 'Без замечаний', error ? `шаг не выполнился: ${error}${said ? `; на странице: ${said}` : ''}` : said])
              marks.push(flaws.length ? 'fail' : error ? 'warn' : 'ok')
            }
        } finally {
          await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined)
          if (was) await page.setViewportSize(was).catch(() => undefined)
          page.setDefaultTimeout(30000)
        }
        const failed = rows.filter((r) => r[1] === 'Сценарий не прошёл').length
        const bad = marks.filter((m) => m === 'fail').length
        const summary = `экранов ${rows.length}${failed ? `, сценарий не прошёл на ${failed}` : ''}${bad ? `, проблемы вёрстки на ${bad}` : ''}${!failed && !bad ? ' — сценарий прошёл везде, без прокрутки вбок, вылезающего и обрезанного текста, перекрытий' : ''}`
        verdict({ kind: 'layout', name, state: bad ? 'fail' : failed ? 'warn' : 'ok', summary, head: ['Экран', 'Итог', 'Подробно'], rows, marks, shots })
      }),

    /**
     * The action again and again (adding a row) up to `upTo` times: at marks — the rows in the DOM, all the nodes,
     * an input's delay, the browser's long tasks, the memory. All the rows in the DOM and a slow input — a virtual
     * scroll is wanted.
     */
    manyRows: (action: () => Promise<unknown>, o: { upTo?: number; marks?: number[] } = {}) =>
      step('Проверка: нагрузка', async () => {
        const name = 'Нагрузка'
        const upTo = Math.max(1, Math.min(2000, o.upTo ?? 300))
        const marks = [...new Set([...(o.marks ?? [10, 50, 100, 200, 300, 500, 1000]).filter((m) => m < upTo), upTo])].sort((a, b) => a - b)
        await quiet()
        await page.evaluate(() => {
          const w = window as unknown as { __qaLong: number[] }
          w.__qaLong = []
          try {
            new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__qaLong.push(e.duration))).observe({ type: 'longtask' })
          } catch {
            // no long tasks here
          }
        })
        const measure = () =>
          page.evaluate(async () => {
            const w = window as unknown as { __qaLong: number[] }
            const rows = document.querySelectorAll('table tbody tr, [role="row"]').length
            const nodes = document.getElementsByTagName('*').length
            const long = w.__qaLong.splice(0)
            const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize
            // an input's delay: a letter typed into the first field, until the page has drawn it
            let delay: number | undefined
            const inp = [...document.querySelectorAll('input[type="text"], input:not([type]), textarea')].find((e) => (e as HTMLElement).getClientRects().length > 0) as HTMLInputElement | undefined
            if (inp) {
              const old = inp.value
              const t0 = performance.now()
              inp.value = old + 'x'
              inp.dispatchEvent(new Event('input', { bubbles: true }))
              await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
              delay = Math.round(performance.now() - t0)
              inp.value = old
              inp.dispatchEvent(new Event('input', { bubbles: true }))
            }
            return { rows, nodes, long, mem, delay }
          })
        const base = await measure()
        const rows: string[][] = []
        let done = 0
        let broke = ''
        let last = base
        for (let i = 1; i <= upTo; i++) {
          try {
            await action()
          } catch (e) {
            broke = (e instanceof Error ? e.message : String(e)).split('\n')[0]
            break
          }
          done = i
          if (i % 10 === 0) await quiet(300, 10000)
          if (marks.includes(i)) {
            await quiet(500, 15000)
            last = await measure()
            rows.push([String(i), String(last.rows), String(last.nodes), last.delay === undefined ? '—' : String(last.delay), last.long.length ? `${last.long.length} / ${Math.round(Math.max(...last.long))}` : '0', last.mem ? (last.mem / 1048576).toFixed(0) : '—'])
          }
        }
        const head = ['Повторов', 'Строк в DOM', 'Узлов DOM', 'Задержка ввода, мс', 'Долгие задачи (шт / макс, мс)', 'Память, МБ']
        const grew = last.rows - base.rows
        const allIn = done >= 50 && grew >= done * 0.9
        const slow = (last.delay ?? 0) > 100 || last.long.some((d) => d > 200)
        const firstSlow = rows.find((r) => Number(r[3]) > 100)?.[0]
        if (broke && !done) return verdict({ kind: 'load', name, state: 'fail', summary: `действие не выполнилось ни разу: ${broke}`, head, rows })
        const tail = broke ? ` Остановилось на ${done}-м повторе: ${broke}` : ''
        if (allIn && slow) return verdict({ kind: 'load', name, state: 'fail', summary: `все ${done} строк в DOM, ввод тормозит${firstSlow ? ` с ~${firstSlow}` : ''} (${last.delay} мс) — нужен виртуальный скролл.${tail}`, head, rows })
        if (allIn) return verdict({ kind: 'load', name, state: 'warn', summary: `все ${done} строк в DOM (${last.nodes} узлов), пока держится — на больших данных станет медленно: стоит виртуальный скролл или постраничность.${tail}`, head, rows })
        if (slow) return verdict({ kind: 'load', name, state: 'warn', summary: `строки не копятся в DOM, но ввод медленный (${last.delay} мс) — дело не в количестве строк.${tail}`, head, rows })
        verdict({ kind: 'load', name, state: broke ? 'warn' : 'ok', summary: `${done} повторов: в DOM ${last.rows} строк, ввод ${last.delay ?? '—'} мс — держится.${tail}`, head, rows })
      }),

    /** The fields remembered under a name (before switching an organisation / a kind…). */
    snapshot: (label: string) =>
      step(`Запомнить поля «${label}»`, async () => {
        await quiet()
        snaps.set(label, fieldsOnly(await snap()))
      }),
    /** The fields now against the remembered: those that kept their value after the switch — to look at. */
    compareWith: (label: string) =>
      step(`Проверка: сравнить с «${label}»`, async () => {
        const name = `Сравнить с «${label}»`
        const a = snaps.get(label)
        if (!a) return verdict({ kind: 'compare', name, state: 'fail', summary: `нет запомненного «${label}» — оно должно быть раньше в сценарии (qa.snapshot)` })
        await quiet()
        const b = fieldsOnly(await snap())
        const kept = Object.keys(b).filter((k) => k in a && a[k] && a[k] === b[k])
        const changed = Object.keys(b).filter((k) => k in a && a[k] !== b[k])
        const rows = [...kept.map((k) => [k, a[k], b[k], 'осталось']), ...changed.map((k) => [k, a[k] || '—', b[k] || '—', 'сменилось'])].slice(0, 60)
        const head = ['Поле', 'До смены', 'После', '']
        if (kept.length) return verdict({ kind: 'compare', name, state: 'warn', summary: `после смены остались прежними ${kept.length} ${plural(kept.length, 'поле', 'поля', 'полей')} — проверьте, должны ли они были смениться (значение могло «протечь» из прошлого контекста)`, head, rows })
        verdict({ kind: 'compare', name, state: 'ok', summary: `после смены ни одно заполненное поле не осталось прежним (сменилось: ${changed.length})`, head, rows })
      }),
  }
}

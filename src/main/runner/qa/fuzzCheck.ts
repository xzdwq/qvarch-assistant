import { decodeRequest, encodeRequest, endpointKey, evalCase, foundIn, getPath, judgeFuzz, parsePath, setPath, type FuzzResult, type FuzzSpec, type ReqParts } from '../../../shared/fuzz'
import { gen } from '../../../shared/gen'
import type { QaContext } from './qaContext'
import { pathOf, short } from './qaText'

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
/** Headers the page's own request carries that a resend must not copy (the browser sets them, or they are its own). */
const SKIP_HEADERS = /^(host|content-length|cookie|connection|accept-encoding|origin|referer|:.*|sec-.*|upgrade-insecure-requests|priority)$/i
const headerOf = (h: Record<string, string>, k: string) => Object.entries(h).find(([n]) => n.toLowerCase() === k)?.[1]

/**
 * «Перебор параметров запроса»: the request the scenario sent (else the API map's example of it) — sent again
 * with each chosen parameter tried, the others as they were; with the page's own login (its cookies, the headers
 * of its own requests to that site — a token never written anywhere). What each answer was, where it breaks.
 */
export function fuzzCheck(ctx: QaContext) {
  const { page, step, sent } = ctx
  return (spec: FuzzSpec) =>
    step('Проверка: перебор параметров запроса', async () => {
      const name = 'Перебор параметров запроса'
      const head = ['Параметр', 'Вариант', 'Статус', 'Время', 'Найдено', 'Итог']
      if (!spec.request.trim()) return ctx.verdict({ kind: 'fuzz', name, state: 'warn', summary: 'запрос не выбран — выберите его в «Параметры перебора»' })
      if (!spec.params.some((p) => p.cases.length)) return ctx.verdict({ kind: 'fuzz', name, state: 'warn', summary: 'не задано ни одного варианта — добавьте параметры и их значения в «Параметры перебора»' })
      await ctx.quiet()
      const [method, path] = spec.request.trim().split(/\s+/, 2)
      const sentIt = [...sent].reverse().find((x) => x.method.toUpperCase() === method.toUpperCase() && endpointKey(x.method, x.url) === `${method.toUpperCase()} ${path}`)
      const tpl: ReqParts | undefined = sentIt
        ? { method: sentIt.method, url: sentIt.url, body: sentIt.body, contentType: headerOf(sentIt.reqHeaders, 'content-type') }
        : spec.sample?.url
          ? { method: method.toUpperCase(), url: spec.sample.url, body: spec.sample.body, contentType: spec.sample.contentType ?? (!spec.sample.body ? undefined : /^\s*[[{]/.test(spec.sample.body) ? 'application/json' : /^[^=&\s]+=[^&]*(&|$)/.test(spec.sample.body) ? 'application/x-www-form-urlencoded' : undefined) }
          : undefined
      if (!tpl) return ctx.verdict({ kind: 'fuzz', name, state: 'fail', summary: `запрос «${spec.request}» сценарий не отправил, и образца нет — допишите в сценарий действие, которое его отправляет (например, «Найти»), или выберите образец из карты API` })
      // the login: the headers the page itself sent to that site (the request itself, else its latest to that origin)
      const origin = new URL(tpl.url).origin
      const own = sentIt ?? [...sent].reverse().find((x) => ctx.api(x) && /^(xhr|fetch)$/.test(x.type) && x.url.startsWith(origin) && headerOf(x.reqHeaders, 'authorization')) ?? [...sent].reverse().find((x) => ctx.api(x) && /^(xhr|fetch)$/.test(x.type) && x.url.startsWith(origin))
      const headers: Record<string, string> = Object.fromEntries(Object.entries(own?.reqHeaders ?? {}).filter(([k]) => !SKIP_HEADERS.test(k)))
      if (tpl.contentType) headers['content-type'] = tpl.contentType
      let d: ReturnType<typeof decodeRequest>
      try {
        d = decodeRequest(tpl)
      } catch (e) {
        return ctx.verdict({ kind: 'fuzz', name, state: 'fail', summary: `запрос не разобрать: ${e instanceof Error ? e.message : String(e)}` })
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
        return ctx.verdict({ kind: 'fuzz', name, state: 'fail', summary: `исходный запрос не прошёл: ${tpl.method} ${pathOf(tpl.url)} → ${base.status || base.error}${base.status === 401 || base.status === 403 ? ' — нет входа: включите «вход из Браузера» и войдите на сайт во вкладке Браузера' : ''}${base.said ? ` — ${base.said}` : ''}` })
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
            return ctx.verdict({ kind: 'fuzz', name, state: 'fail', summary: `вход истёк на «${p.path}: ${c.label}» (401 три раза подряд) — остальные варианты не отправлены`, head, rows: v.rows, marks: v.marks, group: true })
          }
        }
      }
      const v = judgeFuzz(base, results, spec)
      ctx.verdict({ kind: 'fuzz', name, state: v.state, summary: `${v.summary}; исходный: ${base.status}, ${base.ms} мс${base.found !== undefined ? `, найдено ${base.found}` : ''}`, head, rows: v.rows, marks: v.marks, group: true })
    })
}

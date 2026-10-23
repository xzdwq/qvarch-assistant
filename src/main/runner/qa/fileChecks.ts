import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { Locator } from 'playwright-core'
import { answerText, judgeFile, type TestFile } from '../../../shared/testFiles'
import { changes, endpointOf, upload, type OutcomeAdapter } from '../outcome'
import { MUT } from '../traffic'
import type { QaContext } from './qaContext'
import { line, stepError } from './qaText'
import type { QaMark } from '../../../shared/browser/constants'

/** The type each dropped file is given, by its extension. */
const DROP_MIME: Record<string, string> = { '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls': 'application/vnd.ms-excel', '.csv': 'text/csv', '.json': 'application/json', '.txt': 'text/plain', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.xml': 'application/xml', '.zip': 'application/zip', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }

/** `qa` and the notebook's test files: a file's path, a set's files, files dropped, the scenario run per file. */
export function fileChecks(ctx: QaContext) {
  const { page, step, sent, traffic, filesRoot } = ctx
  /** A set's files, by name (the marks file left out). */
  const namesIn = (d: string) => (existsSync(d) ? readdirSync(d).filter((n) => !n.startsWith('.')).sort((a, b) => a.localeCompare(b, 'ru')) : [])
  return {
    /** A test file of the notebook: qa.file('Набор/файл.xlsx') → its path (for setInputFiles). */
    file: (rel: string) => ctx.fileOf(rel),
    /** The files of a set (their paths), by name. */
    files: (set: string) => namesIn(join(filesRoot, set)).map((n) => ctx.fileOf(`${set}/${n}`)),
    /**
     * Files dropped onto an element (a «перетащите файл сюда» area): the drag's events with the files, as a person's
     * drop gives them.
     */
    dropFiles: async (target: Locator, files: string | string[]) => {
      const list = (Array.isArray(files) ? files : [files]).map((p) => ({ name: basename(p), type: DROP_MIME[extname(p).toLowerCase()] ?? '', b64: readFileSync(p).toString('base64') }))
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
        const names = namesIn(d)
        if (!names.length) return ctx.verdict({ kind: 'files', name, state: 'fail', summary: `в наборе «${o.set}» нет файлов — добавьте их в «Тестовых файлах»` })
        const head = ['Файл', 'Ожидание', 'Итог', 'Запросы загрузки', 'Подробно']
        const rows: string[][] = []
        const marks: QaMark[] = []
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
            const path = ctx.fileOf(`${o.set}/${n}`)
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
            await ctx.quiet(700, 8000)
            const picked = adapter.pick(traffic.from(from))
            const hints = await ctx.hints()
            const expect = meta[n]?.expect
            const jsErrors = ctx.pageErrors.filter((x) => x.at >= t0).map((x) => x.text)
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
        ctx.verdict({ kind: 'files', name, state: tally.fail ? 'fail' : tally.warn ? 'warn' : 'ok', summary, head, rows, marks })
      }),
  }
}

import type { Locator } from 'playwright-core'
import { findPaths, getAt, judge, type FieldInfo, type MatrixCase } from '../../../shared/qaMatrix'
import { saveOf as saveCarrying, valuesIn } from '../outcome'
import { MUT, type Exchange } from '../traffic'
import { fieldProbe } from './pageProbes'
import type { QaContext } from './qaContext'
import { line, pathOf, plural, short, stepError } from './qaText'
import type { QaMark } from '../../../shared/browser/constants'

/** A field of the matrix: its name, the value recorded, how it is found, the values to try. */
export type MatrixField = {
  name: string
  value: string
  field: () => Locator
  /** Values of one's own (gen.… or literals; an object — as JSON); `bad` — the form should refuse it. */
  cases?: Array<{ label: string; value: unknown; bad?: boolean }>
  /** (scenarios of before: the values by the field's type — no more; the values are one's own only) */
  auto?: boolean
}
const json = (s?: string) => {
  try {
    return s ? (JSON.parse(s) as unknown) : undefined
  } catch {
    return undefined
  }
}
/** A value as the table shows it: empty, spaces, long — said so. */
const show = (s: string) => (s === '' ? '(пусто)' : s.trim() === '' ? `(${s.length} пробела)` : s.length > 32 ? `«${s.slice(0, 24)}…» (${s.length} симв.)` : `«${s}»`)
const saveOf = (x: Exchange) => `${x.method} ${pathOf(x.url)}`
/** A change as a try keeps it (no live request, no bytes). */
const keptChange = (x: Exchange) => ({ status: x.status, res: x.res, line: line(x), ep: saveOf(x), body: x.body })
const good = (x?: { status?: number }) => !!x?.status && x.status >= 200 && x.status < 300

/**
 * The field matrix: the scenario run once as recorded (the reference: the save goes, and where each field's
 * value is in its body), then once per try — one field's value changed, the others as recorded; at the end once
 * more as recorded (the record back as it was). Each try: the changes sent and their answers, what the page
 * told, what the field shows, what went in the body at the field's place.
 */
export function fieldMatrixCheck(ctx: QaContext) {
  const { page, step, sent, traffic } = ctx
  return (fields: Record<string, MatrixField>, run: (v: Record<string, string>) => Promise<unknown>) =>
    step('Проверка: матрица значений полей', async () => {
      const name = 'Матрица значений полей'
      const ids = Object.keys(fields)
      // nothing to try: not a run (each run saves — records made for nothing)
      if (!ids.some((k) => fields[k].cases?.length))
        return ctx.verdict({ kind: 'matrix', name, state: 'warn', summary: 'значения не заданы ни для одного поля — добавьте их в «Значения матрицы» (свои или типовые наборы)' })
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
          if (e !== STOP) return ctx.verdict({ kind: 'matrix', name, state: 'fail', summary: `сценарий не дошёл до первого поля: ${msg(e)}` })
        }
        const info: Record<string, Partial<FieldInfo>> = {}
        for (const k of ids) info[k] = ((await fields[k].field().first().evaluate(fieldProbe, undefined, { timeout: 3000 }).catch(() => undefined)) as Partial<FieldInfo> | undefined) ?? {}

        /** The endpoints whose answers hold the fields' stored values (known after the first try's run). */
        let storeEps: Set<string> | undefined
        /**
         * One run of the scenario. Before it — only a change still on its way (the try before's late save) is waited
         * for, not the page's quiet (its polling, its live connections never let it be quiet). After it — the save
         * itself (it may go a moment after the click: a form validating on the server, a debounce), or the form's
         * word, or the run's stop. The data the page loaded before saving is kept: the stored values of the try before.
         */
        const once = async (over: Record<string, string>, title: string, saveKey?: string) => {
          for (let t = Date.now(); Date.now() - t < 5000 && sent.some((x) => !x.done && MUT.test(x.method) && ctx.api(x)); ) await page.waitForTimeout(100)
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
          const isSave = (x: Exchange) => (saveKey ? saveOf(x) === saveKey : valuesIn(x.body, typed) > 0)
          for (let t = Date.now(); !error && Date.now() - t < 5000; ) {
            const s = ctx.mutations(from).filter(isSave)
            if (s.some((x) => x.done && x.status !== undefined)) break
            // gone and not answered yet: its answer is the outcome — waited for below, not cut off here
            if (s.length) break
            if ((await ctx.hints()).length) break
            await page.waitForTimeout(200)
          }
          // a change on its way is no outcome: its answer waited for (a slow server — up to half a minute)
          for (let t = Date.now(); Date.now() - t < 30000 && ctx.mutations(from).some((x) => !x.done || x.status === undefined); ) await page.waitForTimeout(150)
          // the save answered: a moment for the form to show its word (no quiet — the data loaded before the save is
          // all there is to read; the page's polling would only hold it)
          await page.waitForTimeout(300)
          const part = sent.slice(from)
          const at = part.findIndex((x) => MUT.test(x.method) && ctx.api(x) && (!saveKey || saveOf(x) === saveKey))
          // what the try needs, copied: its changes (the save's body and answer), the data loaded before its save
          // (only the endpoints the stored values are in, once they are known) — the run's bodies then let go
          const gets = part
            .slice(0, at < 0 ? part.length : at)
            .filter((x) => x.method === 'GET' && x.res !== undefined && (!storeEps || storeEps.has(saveOf(x))))
            .map((x) => ({ ep: saveOf(x), res: x.res! }))
          const out = { error, muts: ctx.mutations(from).map(keptChange), hints: await ctx.hints(), gets }
          traffic.release(traffic.mark())
          return out
        }
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
        if (ref.error) return ctx.verdict({ kind: 'matrix', name, state: 'fail', summary: `сценарий с записанными значениями не прошёл: ${ref.error} — матрице не на чем перебирать (локатор поля не находит его? перезапишите шаг)` })
        // the save: the change carrying the values typed — not whatever the page happened to send (its tracking, its
        // error reports, a token's refresh)
        const saved = saveCarrying(ref.muts, ids.map((k) => recorded[k]))
        if (!saved) {
          const seen = ref.muts.length ? `изменяющие запросы прогона: ${ref.muts.map((x) => x.line).join(', ')}` : 'изменяющих запросов не было'
          return ctx.verdict({ kind: 'matrix', name, state: 'fail', summary: `запрос сохранения с введёнными значениями не найден (${seen}) — сохранение не ушло${ref.hints.length ? `; на форме: ${ref.hints.join(' · ')}` : ''}` })
        }
        if (saved.status === undefined) return ctx.verdict({ kind: 'matrix', name, state: 'fail', summary: `сервер не ответил на сохранение за 30 с: ${saved.line}` })
        if (!good(saved)) return ctx.verdict({ kind: 'matrix', name, state: 'fail', summary: `с записанными значениями сохранение не прошло: ${saved.line}${saved.res ? ` — ${short(saved.res, 120)}` : ''}` })
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
        const marks: QaMark[] = []
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
        ctx.verdict({ kind: 'matrix', name, state: tally.fail ? 'fail' : tally.warn ? 'warn' : 'ok', summary, head, rows, marks, group: true })
      } finally {
        keepOff()
        page.setDefaultTimeout(30000)
      }
    })
}

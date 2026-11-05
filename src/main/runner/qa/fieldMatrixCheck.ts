import type { Locator } from 'playwright-core'
import { findPaths, getAt, judge, type FieldInfo, type MatrixCase } from '../../../shared/qaMatrix'
import { saveOf as saveCarrying, valuesIn } from '../outcome'
import { asked, judgeQuery, valueKey, type MatrixMode } from '../../../shared/qaMatrixQuery'
import { MUT } from '../traffic'
import { matrixRunner, type MatrixRun } from './fieldMatrixRun'
import { fieldProbe } from './pageProbes'
import type { QaContext } from './qaContext'
import { plural, short, stepError } from './qaText'
import type { QaMark } from '../../../shared/browser/constants'
import { UI } from '../../../shared/browser/uiKits'

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
const good = (x?: { status?: number }) => !!x?.status && x.status >= 200 && x.status < 300
/** An address as text (its query decoded — a value typed is looked for in it). */
const decoded = (url: string) => {
  try {
    return decodeURIComponent(url.replace(/\+/g, ' '))
  } catch {
    return url
  }
}
/** A value typed kept whole up to this; a scenario's own measures of one value — up to this as JSON. */
const VALUE_KEPT = 120
const RETURNED_KEPT = 1500
/**
 * What the scenario gave back for a value, kept small (its measures are what matter — a page's text it returned is
 * cut: a matrix of many values never makes a value too big to keep or to read).
 */
function keptSmall(v: unknown): unknown {
  let text: string
  try {
    text = JSON.stringify(v)
  } catch {
    return String(v).slice(0, RETURNED_KEPT)
  }
  if (text === undefined || text.length <= RETURNED_KEPT) return v
  return { cut: `${text.slice(0, RETURNED_KEPT)}…`, size: text.length }
}
/** A value's outcome, as the block's value gives it: what was typed, how it was judged, what the scenario measured. */
export interface MatrixOutcome {
  field: string
  label: string
  value: string
  state: string
  result: string
  detail: string
  status?: number
  found?: number
  error?: string
  returned?: unknown
  /** What it depended on: the scenario without its values (`sig`), the value (`vk`); the request it went in (`query`). */
  sig?: string
  vk?: string
  query?: string
  /** Taken from the run before (its inputs the same, not asked to run anew). */
  reused?: boolean
}
/**
 * How the matrix runs: by the field's save or its request (`mode`); the outcomes of the run before (`memo`) — a
 * value's kept while its inputs are the same (`sig` — the scenario's now); the values asked to run anew (`recheck`).
 */
export interface MatrixOpts {
  mode?: MatrixMode
  memo?: readonly MatrixOutcome[]
  sig?: string
  recheck?: readonly string[]
  /** Each field's values' keys, in their order (their writing in the code: a generated value is new each run). */
  keys?: Record<string, string[]>
  /** The outcomes handed on before the verdict (a failed verdict ends the run: they are the block's value all the same). */
  gathered?: (outcomes: MatrixOutcome[]) => void
}

/**
 * The field matrix: the scenario run once as recorded (the reference: the save goes, and where each field's
 * value is in its body), then once per try — one field's value changed, the others as recorded; at the end once
 * more as recorded (the record back as it was). Each try: the changes sent and their answers, what the page
 * told, what the field shows, what went in the body at the field's place.
 */
export function fieldMatrixCheck(ctx: QaContext) {
  const { page, step, traffic } = ctx
  /** `opts.mode` — how the field is judged: by its save (a form), by its request (a search, a filter); none — found out. */
  return (fields: Record<string, MatrixField>, run: (v: Record<string, string>) => Promise<unknown>, opts: MatrixOpts = {}) =>
    step('Проверка: матрица значений полей', async () => {
      const name = 'Матрица значений полей'
      const ids = Object.keys(fields)
      // nothing to try: not a run (each run saves — records made for nothing)
      if (!ids.some((k) => fields[k].cases?.length))
        return ctx.verdict({ kind: 'matrix', name, state: 'warn', summary: 'значения не заданы ни для одного поля — добавьте их в «Значения матрицы» (свои или типовые наборы)' })
      const recorded = Object.fromEntries(ids.map((k) => [k, fields[k].value]))
      // (a step's failure said as the other checks say it: what was not found)
      const msg = (e: unknown) => stepError(e, 6)
      // a form that will not save waits its button out: seconds, not the half minute (pages still load as long as they need)
      page.setDefaultNavigationTimeout(30000)
      page.setDefaultTimeout(6000)
      // the answers kept: the page's data loaded before a save — what the try before stored
      const keepOff = traffic.keep()
      // the run before's outcomes still true (the same scenario): a field that saves nothing, its request known from them
      const memo = (opts.memo ?? []).filter((o) => !!o && o.sig === opts.sig && !!o.vk)
      const knownQuery = opts.mode !== 'save' ? memo.find((o) => o.query)?.query : undefined
      try {
        // 1. the fields looked at: the scenario up to its first typing (known already — not looked at again)
        const info: Record<string, Partial<FieldInfo>> = {}
        if (!knownQuery) {
          const STOP = new Error('__qa_matrix_stop')
          try {
            await run(new Proxy({} as Record<string, string>, { get: () => { throw STOP } }))
          } catch (e) {
            if (e !== STOP) return ctx.verdict({ kind: 'matrix', name, state: 'fail', summary: `сценарий не дошёл до первого поля: ${msg(e)}` })
          }
          for (const k of ids) info[k] = ((await fields[k].field().first().evaluate(fieldProbe, UI, { timeout: 3000 }).catch(() => undefined)) as Partial<FieldInfo> | undefined) ?? {}
        }

        /** The endpoints whose answers hold the fields' stored values (known after the first try's run). */
        let storeEps: Set<string> | undefined
        /** One run of the scenario (the values `over` in place of the recorded), as the try needs it. */
        const once = matrixRunner(ctx, { ids, recorded, run, msg, storeEps: () => storeEps })
        const valueOf = (k: string) =>
          fields[k]
            .field()
            .first()
            .evaluate((el) => {
              const i = (el.matches('input, textarea') ? el : el.querySelector('input, textarea')) as HTMLInputElement | null
              return i ? i.value : (el as HTMLElement).innerText
            }, undefined, { timeout: 300 })
            .catch(() => undefined) as Promise<string | undefined>

        /** A field's own values to try (the «Значения матрицы»: a generator made into its value now). */
        const casesOf = (k: string): MatrixCase[] =>
          (fields[k].cases ?? []).map((c) => {
            const raw = typeof c.value === 'function' ? (c.value as () => unknown)() : c.value
            const value = typeof raw === 'string' ? raw : raw === undefined || raw === null ? '' : typeof raw === 'object' ? JSON.stringify(raw) : String(raw)
            return { label: c.label, value, bad: !!c.bad, ...(value.trim() === '' ? { empty: true } : {}) }
          })
        /** Each value's outcome, all of them (the block's value: every measure of one run, nothing to run again for). */
        const outcomes: MatrixOutcome[] = []
        const outcome = (field: string, label: string, value: string, v: { state: string; result: string; detail: string; status?: number; found?: number }, o: { error?: string; returned?: unknown }, keys: { vk?: string; query?: string } = {}) =>
          outcomes.push({
            ...(opts.sig ? { sig: opts.sig } : {}),
            ...(keys.vk ? { vk: keys.vk } : {}),
            ...(keys.query ? { query: keys.query } : {}),
            field,
            label,
            // (a long value — its start and its length: «а»×5000 is not kept whole)
            value: value.length > VALUE_KEPT ? `${value.slice(0, 40)}… (${value.length} симв.)` : value,
            state: v.state,
            result: v.result,
            detail: v.detail,
            ...(v.status !== undefined ? { status: v.status } : {}),
            ...(v.found !== undefined ? { found: v.found } : {}),
            ...(o.error ? { error: o.error.slice(0, 500) } : {}),
            ...(o.returned !== undefined ? { returned: keptSmall(o.returned) } : {}),
          })
        /**
         * The tries of a field that saves nothing: each value typed, its request's answer judged (its status, how many
         * found — from the answer), the scenario's own measures kept; the reference first (what the others compare with).
         */
        const queryTries = async (queryKey: string): Promise<MatrixOutcome[]> => {
          const head = ['Поле', 'Вариант', 'Значение', 'Итог', 'Найдено', 'Подробно']
          const rows: string[][] = []
          const marks: QaMark[] = []
          const tally = { ok: 0, warn: 0, fail: 0 }
          let fresh = 0
          /**
           * A value judged: remembered (its inputs the same, not asked anew) — as it was; else run and judged now (a run
           * that broke judged nothing: run again).
           */
          const judged = async (over: Record<string, string>, title: string, c: MatrixCase, field: string, vk: string) => {
            const kept = asked(opts.recheck, c.label, c.value) ? undefined : memo.find((m) => m.vk === vk && !m.error)
            if (kept) {
              outcomes.push({ ...kept, reused: true })
              return { state: kept.state as QaMark, result: kept.result, detail: kept.detail ? `${kept.detail} (прошлый прогон)` : '(прошлый прогон)', ...(kept.found !== undefined ? { found: kept.found } : {}) }
            }
            fresh++
            const o = await once(over, title, undefined, queryKey)
            const req = [...o.reqs].reverse().find((x) => x.ep === queryKey)
            const v = judgeQuery(c, { ...(o.error ? { error: o.error } : {}), hints: o.hints, ...(req ? { req } : {}) })
            outcome(field, c.label, c.value, v, o, { vk, query: queryKey })
            return v
          }
          const refValue = ids.map((k) => recorded[k]).join(' · ')
          const refV = await judged({}, 'Эталон: записанные значения', { label: 'эталон', value: refValue, bad: false }, '—', valueKey('—', refValue))
          rows.push(['—', 'эталон', show(refValue), refV.result, refV.found === undefined ? '—' : String(refV.found), refV.detail])
          marks.push(refV.state)
          for (const k of ids) {
            const cases = casesOf(k)
            for (const [i, c] of cases.entries()) {
              const v = await judged({ [k]: c.value }, `${fields[k].name}: ${c.label}`, c, fields[k].name, opts.keys?.[k]?.[i] ?? valueKey(fields[k].name, c.value))
              tally[v.state]++
              rows.push([fields[k].name, c.label, show(c.value), v.result, v.found === undefined ? '—' : String(v.found), v.detail])
              marks.push(v.state)
            }
          }
          const all = tally.ok + tally.warn + tally.fail
          const kept = all + 1 - fresh
          const summary = `вариантов ${all} (запрос ${queryKey})${tally.fail ? `, сбоев ${tally.fail}` : ''}${tally.warn ? `, стоит посмотреть ${tally.warn}` : ''}${kept > 0 ? `; прогнано сейчас ${fresh}, из прошлого прогона ${kept} (входы не менялись)` : ''} — результаты всех значений в значении блока`
          opts.gathered?.(outcomes)
          ctx.verdict({ kind: 'matrix', name, state: tally.fail ? 'fail' : tally.warn ? 'warn' : 'ok', summary, head, rows, marks, group: true })
          return outcomes
        }

        // (a field that saves nothing, its request known from the run before: straight to its values)
        if (knownQuery) return await queryTries(knownQuery)
        // 2. the reference: as recorded — the save goes; where each value is in its body
        const ref = await once({}, 'Эталон: записанные значения')
        // the reference must do what the scenario was recorded doing — a step that fails there fails every try
        if (ref.error) return ctx.verdict({ kind: 'matrix', name, state: 'fail', summary: `сценарий с записанными значениями не прошёл: ${ref.error} — матрице не на чем перебирать (локатор поля не находит его? перезапишите шаг)` })
        // the save: the change carrying the values typed — not whatever the page happened to send (its tracking, its
        // error reports, a token's refresh)
        const typedRef = ids.map((k) => recorded[k])
        // (told it is a search: a page's POST carrying the text typed — its history, its tracking — is no save)
        const saved = opts.mode === 'query' ? undefined : saveCarrying(ref.muts, typedRef)
        if (!saved) {
          // a field that saves nothing (a search, a filter): the request its value goes in — the tries judged by its answers
          // (a search's own request: one that is not a change, when there is one)
          const carriers = ref.reqs.filter((x) => valuesIn(x.body, typedRef) > 0 || valuesIn(decoded(x.url), typedRef) > 0)
          const carrier = [...carriers].reverse().find((x) => !MUT.test(x.method)) ?? carriers.at(-1)
          if (!carrier && opts.mode === 'save') return ctx.verdict({ kind: 'matrix', name, state: 'fail', summary: 'запрос сохранения с введёнными значениями не найден — сохранение не ушло' })
          if (carrier) return await queryTries(carrier.ep)
          const seen = ref.reqs.length ? `запросы прогона: ${ref.reqs.slice(-6).map((x) => x.line).join(', ')}` : 'запросов не было'
          return ctx.verdict({ kind: 'matrix', name, state: 'fail', summary: `ни сохранения, ни запроса с введённым значением не найдено (${seen})${ref.hints.length ? `; на странице: ${ref.hints.join(' · ')}` : ''}` })
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
        type Try = { k: string; c: MatrixCase; o: MatrixRun; shown?: string }
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
          const own = casesOf(k)
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
          outcome(fields[k].name, c.label, c.value, { ...v, ...(save?.status !== undefined ? { status: save.status } : {}) }, o)
          const wentText = !save ? '—' : !good(save) ? `${save.status ?? '…'}` : went ? short(JSON.stringify(went.value)) : refBody === undefined ? 'не JSON' : 'поля в теле нет'
          rows.push([fields[k].name, c.label, show(c.value), v.result, wentText, ...(edit ? [stored === undefined ? '—' : show(stored)] : []), v.detail])
          marks.push(v.state)
        })
        const all = tally.ok + tally.warn + tally.fail
        // (a failure is the server's, or the scenario's own — it never got to the save)
        const broke = rows.filter((r) => r[3] === 'Сценарий не прошёл').length
        const server = tally.fail - broke
        const summary = `вариантов ${all}${broke ? `, сценарий не прошёл в ${broke} — см. «Подробно»` : ''}${server ? `, ошибок сервера ${server}` : ''}${tally.warn ? `, стоит посмотреть ${tally.warn}` : ''} — по ${ids.length} ${plural(ids.length, 'полю', 'полям', 'полям')}; в конце записанные значения возвращены`
        opts.gathered?.(outcomes)
        ctx.verdict({ kind: 'matrix', name, state: tally.fail ? 'fail' : tally.warn ? 'warn' : 'ok', summary, head, rows, marks, group: true })
        return outcomes
      } finally {
        keepOff()
        page.setDefaultTimeout(30000)
      }
    })
}

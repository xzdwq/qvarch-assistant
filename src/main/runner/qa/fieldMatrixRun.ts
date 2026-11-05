import { valuesIn } from '../outcome'
import { MUT, type Exchange } from '../traffic'
import type { QaContext } from './qaContext'
import { line, pathOf } from './qaText'

/** A request's endpoint: its method and path (how a try's save / request is told from the others). */
export const endpointOf = (x: Exchange) => `${x.method} ${pathOf(x.url)}`
/** A change as a try keeps it (no live request, no bytes). */
const keptChange = (x: Exchange) => ({ status: x.status, res: x.res, line: line(x), ep: endpointOf(x), body: x.body })
/** After the save answered — a moment for the form to show its word (no quiet: the page's polling would hold it). */
const FORM_WORD_MS = 300

/** What one run of the matrix's scenario needs: the fields, their recorded values, the scenario, how a failure is said. */
export interface MatrixRunSetup {
  ids: string[]
  recorded: Record<string, string>
  run: (v: Record<string, string>) => Promise<unknown>
  msg: (e: unknown) => string
  /** The endpoints whose answers hold the fields' stored values (known after the first try's run). */
  storeEps: () => Set<string> | undefined
}

/**
 * One run of the scenario. Before it — only a change still on its way (the try before's late save) is waited
 * for, not the page's quiet (its polling, its live connections never let it be quiet). After it — the save
 * itself (it may go a moment after the click: a form validating on the server, a debounce), or the form's
 * word, or the run's stop. The data the page loaded before saving is kept: the stored values of the try before.
 */
export function matrixRunner(ctx: QaContext, s: MatrixRunSetup) {
  const { step, sent, traffic } = ctx
  const valuesOf = (over: Record<string, string>) => new Proxy({} as Record<string, string>, { get: (_t, k: string) => over[k] ?? s.recorded[k] })
  return async (over: Record<string, string>, title: string, saveKey?: string, queryKey?: string) => {
    await ctx.until(() => !sent.some((x) => !x.done && MUT.test(x.method) && ctx.api(x)), 5000)
    const from = sent.length
    let error: string | undefined
    /** What the scenario gave back for this value (its own measures: what it found, what it saw). */
    let returned: unknown
    await step(title, async () => {
      try {
        returned = await s.run(valuesOf(over))
      } catch (e) {
        error = s.msg(e)
      }
    })
    // a field that saves nothing: its request (the one carrying the value) answered — waited for, up to 30 s
    if (queryKey) await ctx.until(() => !sent.slice(from).some((x) => endpointOf(x) === queryKey && !x.done), 30000, 150)
    // the save: the try's own endpoint once known; before — the change carrying the values typed (not whatever
    // else the page sent on the way: a dialog's OK, a list's search)
    const typed = s.ids.map((k) => over[k] ?? s.recorded[k])
    const isSave = (x: Exchange) => (saveKey ? endpointOf(x) === saveKey : valuesIn(x.body, typed) > 0)
    // gone (answered or not yet: its answer is the outcome — waited for below), or the form's word
    if (!error) await ctx.until(async () => ctx.mutations(from).some(isSave) || (await ctx.hints()).length > 0, 5000, 200)
    // a change on its way is no outcome: its answer waited for (a slow server — up to half a minute)
    await ctx.until(() => !ctx.mutations(from).some((x) => !x.done || x.status === undefined), 30000, 150)
    await ctx.page.waitForTimeout(FORM_WORD_MS)
    const part = sent.slice(from)
    const at = part.findIndex((x) => MUT.test(x.method) && ctx.api(x) && (!saveKey || endpointOf(x) === saveKey))
    // what the try needs, copied: its changes (the save's body and answer), the data loaded before its save
    // (only the endpoints the stored values are in, once they are known) — the run's bodies then let go
    const storeEps = s.storeEps()
    const gets = part
      .slice(0, at < 0 ? part.length : at)
      .filter((x) => x.method === 'GET' && x.res !== undefined && (!storeEps || storeEps.has(endpointOf(x))))
      .map((x) => ({ ep: endpointOf(x), res: x.res! }))
    // the page's requests of the try (their answers — only the request the value goes in: the rest let go)
    const reqs = part.filter((x) => ctx.api(x)).map((x) => ({ ep: endpointOf(x), method: x.method, url: x.url, body: x.body, status: x.done ? x.status : undefined, line: line(x), ...(queryKey && endpointOf(x) === queryKey && x.res !== undefined ? { res: x.res } : {}) }))
    const out = { error, muts: ctx.mutations(from).map(keptChange), hints: await ctx.hints(), gets, reqs, returned }
    traffic.release(traffic.mark())
    return out
  }
}
/** What one run gave: its error, its changes, the page's words, the data it loaded, its requests, its own measures. */
export type MatrixRun = Awaited<ReturnType<ReturnType<typeof matrixRunner>>>

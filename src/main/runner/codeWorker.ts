import vm from 'node:vm'
import { errorText } from './errorText'
import { isName, plain, sandboxConsole, wrapBody, type SandboxLog } from './sandbox'
import { Emitter } from './emitter'

/**
 * A notebook's code block, run in a process of its own (an Electron utility process, made for one run): the
 * app never waits on it, «Стоп» kills it at once, its memory is capped and goes away with it.
 * JS or TS (the types are cut away by Node itself). The context's values are its variables; `return` gives the
 * result, `set(name, value)` publishes more, `emit(name, part)` (`.text`, `.merge`) gathers a variable as it goes;
 * console.* is caught. The «lib» blocks (shared functions) come first.
 */
interface Job {
  code: string
  ts: boolean
  libs: Array<{ code: string; ts: boolean }>
  ctx: Record<string, unknown>
  runs?: Record<string, unknown>
}
const port = process.parentPort

port.on('message', async (e: { data: Job }) => {
  const job = e.data
  const logs: SandboxLog[] = []
  const sets: Record<string, unknown> = {}
  const t0 = performance.now()
  // (the parts as they come: { type: 'emit', batch } before the run's last message — which says how many there were)
  const out = new Emitter((batch) => port.postMessage({ type: 'emit', batch }), plain)
  const cons = sandboxConsole(logs)
  try {
    const vars = Object.fromEntries(Object.entries(job.ctx).filter(([k]) => isName(k)))
    const sandbox = vm.createContext({
      ...vars,
      ctx: job.ctx,
      runs: job.runs ?? {},
      console: cons,
      set: (k: string, v: unknown) => {
        if (!isName(k)) throw new Error(`set: «${k}» — не имя переменной`)
        sets[k] = v
      },
      emit: out.emit,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      structuredClone,
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      fetch,
      AbortController,
      atob,
      btoa,
    })
    // the shared functions first, in the same function (their declarations are the block's)
    const libs = job.libs.map((l) => l.code).join('\n')
    const libLines = libs ? libs.split('\n').length : 0
    const main = wrapBody(libs ? `${libs}\n${job.code}` : job.code, job.ts || job.libs.some((l) => l.ts), '__block')
    const value = await vm.runInContext(`${main}\n__block()`, sandbox, { filename: 'блок', lineOffset: -1 - libLines })
    port.postMessage({ ok: true, value: plain(value), hasValue: value !== undefined, sets: plain(sets), logs, ms: performance.now() - t0, emits: out.close() })
  } catch (err) {
    port.postMessage({ ok: false, error: errorText(err, 'блок'), logs, sets: plain(sets), ms: performance.now() - t0, emits: out.close() })
  }
})

import { runLoopHead, type LoopJob, type PassResult } from './loopCore'

/**
 * A loop's head, run in a process of its own (an Electron utility process, made for one loop run): every pass it
 * asks for goes to the app (the blocks run there), the pass's values come back; «Стоп» / the time limit kill it.
 *   in:  { type: 'start', job } · { type: 'pass', n, result }
 *   out: { type: 'pass', n, vars } · { type: 'end', result }
 */
const port = process.parentPort
const waiting = new Map<number, (r: PassResult) => void>()
port.on('message', (e: { data: { type: 'start'; job: LoopJob } | { type: 'pass'; n: number; result: PassResult } }) => {
  const m = e.data
  if (m.type === 'pass') {
    waiting.get(m.n)?.(m.result)
    waiting.delete(m.n)
    return
  }
  void runLoopHead(m.job, (n, vars) => {
    port.postMessage({ type: 'pass', n, vars })
    return new Promise<PassResult>((done) => waiting.set(n, done))
  }).then((result) => port.postMessage({ type: 'end', result }))
})

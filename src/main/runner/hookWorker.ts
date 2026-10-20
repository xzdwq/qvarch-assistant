import { queryRegex, type HookSearch } from '../../shared/hooks'

/**
 * The hooks' search in the answers — a process of its own, so a huge script never slows the app or the browser.
 * One answer at a time: the matches go back as they are found, the progress every ~150 ms; «skip» stops the one
 * being looked into at once (the search yields between pieces).
 */
type Job = { type: 'search'; id: string; body: string; search: HookSearch; maxHits: number }
type Msg = Job | { type: 'skip'; id: string }

const port = process.parentPort
let skip: string | undefined
const tick = () => new Promise<void>((r) => setImmediate(r))
const CHUNK = 256 * 1024

port.on('message', (e: { data: Msg }) => {
  const m = e.data
  if (m.type === 'skip') skip = m.id
  else void search(m)
})

async function search(j: Job): Promise<void> {
  const re = queryRegex(j.search)
  if (typeof re === 'string') return void port.postMessage({ type: 'done', id: j.id, error: re })
  const body = j.body
  const hits: Array<{ line: number; col: number; snippet: string; mAt: number; mLen: number }> = []
  // lines counted as we go (no copy of the text)
  let line = 1
  let lineStart = 0
  let counted = 0
  const lineOf = (pos: number) => {
    for (let i = body.indexOf('\n', counted); i !== -1 && i < pos; i = body.indexOf('\n', i + 1)) {
      line++
      lineStart = i + 1
    }
    counted = pos
    return { line, col: pos - lineStart + 1 }
  }
  let last = performance.now()
  let next = CHUNK
  re.lastIndex = 0
  for (;;) {
    if (skip === j.id) {
      skip = undefined
      return void port.postMessage({ type: 'done', id: j.id, skipped: true, hits })
    }
    const m = re.exec(body)
    if (!m) break
    const at = m.index
    if (m[0].length === 0) re.lastIndex++
    const { line: l, col } = lineOf(at)
    const a = Math.max(0, at - 60)
    const raw = body.slice(a, Math.min(body.length, at + m[0].length + 60))
    // one line of text around it (new lines shown as spaces)
    const snippet = raw.replace(/[\r\n\t]+/g, ' ')
    hits.push({ line: l, col, snippet, mAt: at - a, mLen: Math.min(m[0].length, 200) })
    if (hits.length >= j.maxHits) break
    // a piece looked through: messages (skip) get their turn, the progress goes out
    if (re.lastIndex >= next) {
      next = re.lastIndex + CHUNK
      if (performance.now() - last > 150) {
        last = performance.now()
        port.postMessage({ type: 'progress', id: j.id, done: re.lastIndex })
      }
      await tick()
    }
  }
  port.postMessage({ type: 'done', id: j.id, hits })
}

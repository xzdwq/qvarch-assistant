import { harnessError, harnessEventOf, harnessReplyText, SseReader } from '../../../shared/agent/harnessWire'

/** A tool the harness used, as its stream told it: when it began (ms from the turn's start), how long it took. */
export interface RemoteTool {
  name: string
  args?: string
  result?: string
  failed?: boolean
  at: number
  ms: number
}
export interface HarnessTurn {
  /** Its address up to /v1. */
  baseUrl: string
  key?: string
  headers: Record<string, string>
  model?: string
  system: string
  prompt: string
  /** The header its conversation is kept by (none — each turn on its own) and the conversation's id. */
  sessionHeader?: string
  sessionId: string
  /** The name of the event it tells its tools' work by. */
  toolEvent?: string
  signal: AbortSignal
  /** A tool of the harness done (told as it ends). */
  onTool: (t: RemoteTool) => void
}

/**
 * A turn of an agent harness elsewhere (Hermes, Atomic Agent…): its own loop and tools — it is given what the chat and
 * the note say and answers; its answer streamed (a long turn — its pieces as they come, keepalives skipped), its tools'
 * work told as it goes. Stopped (the signal) — the request dropped. A server answering in one JSON — read too.
 */
export async function harnessTurn(o: HarnessTurn): Promise<{ text: string }> {
  const t0 = Date.now()
  let res: Response
  try {
    res = await fetch(`${o.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: o.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(o.key ? { Authorization: `Bearer ${o.key}` } : {}),
        ...(o.sessionHeader ? { [o.sessionHeader]: o.sessionId } : {}),
        ...o.headers,
      },
      body: JSON.stringify({
        model: o.model || 'agent',
        stream: true,
        messages: [
          { role: 'system', content: o.system },
          { role: 'user', content: o.prompt },
        ],
      }),
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new Error(`Нет связи с агентом ${o.baseUrl}`)
  }
  if (!res.ok) throw new Error(harnessError(res.status, await res.text()))
  if (!/event-stream/i.test(res.headers.get('content-type') ?? '') || !res.body) return { text: harnessReplyText(JSON.parse(await res.text())).trim() }

  let text = ''
  /** The tools begun and not yet ended, by their call's id, else by name (a harness may run one again before the first ends). */
  const begun = new Map<string, Array<{ name: string; at: number; args?: string }>>()
  const sse = new SseReader()
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let done = false
  const take = (events: ReturnType<SseReader['push']>) => {
    for (const ev of events) {
      const e = harnessEventOf(ev, o.toolEvent)
      if (e.kind === 'text') text += e.text
      else if (e.kind === 'error') throw new Error(`Агент: ${e.message}`)
      else if (e.kind === 'done') done = true
      else if (e.kind === 'tool' && e.phase === 'start') {
        const k = e.id ?? e.name
        ;(begun.get(k) ?? begun.set(k, []).get(k)!).push({ name: e.name, at: Date.now() - t0, ...(e.args ? { args: e.args } : {}) })
      } else if (e.kind === 'tool') {
        const was = begun.get(e.id ?? e.name)?.shift()
        const at = was?.at ?? Date.now() - t0
        o.onTool({ name: e.name, args: e.args ?? was?.args, result: e.result, failed: e.failed, at, ms: Date.now() - t0 - at })
      }
    }
  }
  while (!done) {
    const { value, done: ended } = await reader.read()
    if (ended) break
    take(sse.push(decoder.decode(value, { stream: true })))
  }
  take(sse.end())
  void reader.cancel().catch(() => undefined)
  // (a tool told begun and never ended — kept as it was)
  for (const list of begun.values()) for (const b of list) o.onTool({ name: b.name, args: b.args, at: b.at, ms: Date.now() - t0 - b.at })
  return { text: text.trim() }
}

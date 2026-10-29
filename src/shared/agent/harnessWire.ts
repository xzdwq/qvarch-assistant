/**
 * An agent harness spoken to over a streamed Chat Completions (Hermes, Atomic Agent and the like): its answer comes as
 * Server-Sent Events — pieces of its text (`chat.completion.chunk`), its tools' work (an event of its own name:
 * Hermes' `hermes.tool.progress`), `[DONE]`; comment lines (`: keepalive`) between. Read here piece by piece as the
 * network gives them (a line may be cut anywhere); a server answering in one JSON instead — read too.
 */

/** One event of the stream: its name (none — a plain message) and its data. */
export interface SseEvent {
  event?: string
  data: string
}

/** Server-Sent Events read as they come (pieces cut anywhere): `push` a piece — the events it finished. */
export class SseReader {
  private rest = ''
  private event?: string
  private data: string[] = []

  push(piece: string): SseEvent[] {
    this.rest += piece
    const out: SseEvent[] = []
    let nl: number
    while ((nl = this.rest.indexOf('\n')) >= 0) {
      const line = this.rest.slice(0, nl).replace(/\r$/, '')
      this.rest = this.rest.slice(nl + 1)
      if (line === '') {
        // a blank line ends an event
        if (this.data.length) out.push({ ...(this.event ? { event: this.event } : {}), data: this.data.join('\n') })
        this.event = undefined
        this.data = []
        continue
      }
      // (a comment: `: keepalive`)
      if (line.startsWith(':')) continue
      const at = line.indexOf(':')
      const field = at < 0 ? line : line.slice(0, at)
      const value = at < 0 ? '' : line.slice(at + 1).replace(/^ /, '')
      if (field === 'event') this.event = value
      else if (field === 'data') this.data.push(value)
    }
    return out
  }
  /** The stream ended: an event not closed by a blank line — given too. */
  end(): SseEvent[] {
    const out = this.push('\n\n')
    this.rest = ''
    return out
  }
}

/** What an event says: a piece of the answer, a tool's work, the end, an error — or nothing of use. */
export type HarnessEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; phase: 'start' | 'done'; name: string; id?: string; args?: string; result?: string; failed?: boolean }
  | { kind: 'done' }
  | { kind: 'error'; message: string }
  | { kind: 'none' }

const NONE: HarnessEvent = { kind: 'none' }
const asText = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : typeof v === 'string' ? v : JSON.stringify(v))
const first = (o: Record<string, unknown>, keys: readonly string[]) => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null)

/** A tool's phase by its word (each harness its own — `started`, `tool_start`, `running`…): it began (else — it ended). */
const begins = (w: string) => /start|begin|running|calling|in_progress/.test(w) && !/complet|done|finish|end|result|error|fail/.test(w)
/** A tool's work, read loosely (each harness names its fields its own way). */
function toolOf(o: Record<string, unknown>, eventName?: string): HarnessEvent {
  const name = asText(first(o, ['tool', 'name', 'tool_name', 'function']))
  if (!name) return NONE
  const phaseWord = String(first(o, ['status', 'phase', 'state', 'type']) ?? eventName ?? '').toLowerCase()
  const error = asText(first(o, ['error', 'err']))
  const failed = !!error || /error|fail/.test(phaseWord) || o.ok === false || o.success === false
  const id = asText(first(o, ['toolCallId', 'tool_call_id', 'call_id', 'id']))
  // (Hermes says what it runs in `label`: the command, the address)
  const args = asText(first(o, ['args', 'arguments', 'input', 'params', 'label']))
  const result = asText(first(o, ['result', 'output', 'preview', 'content'])) ?? error
  return { kind: 'tool', phase: begins(phaseWord) ? 'start' : 'done', name, ...(id ? { id } : {}), ...(args ? { args } : {}), ...(result ? { result } : {}), ...(failed ? { failed: true } : {}) }
}

/** The events of a harness's tools besides its own (`toolEvent`): the run streams' (`tool.started`, `tool.completed`). */
const TOOL_EVENTS = new Set(['tool.started', 'tool.completed', 'tool.failed'])

/** An event read: `toolEvent` — the name this harness tells its tools' work by (none — only the common ones). */
export function harnessEventOf(e: SseEvent, toolEvent?: string): HarnessEvent {
  if (e.data.trim() === '[DONE]') return { kind: 'done' }
  let o: Record<string, unknown>
  try {
    o = JSON.parse(e.data) as Record<string, unknown>
  } catch {
    return NONE
  }
  if (!o || typeof o !== 'object') return NONE
  if (e.event && (e.event === toolEvent || TOOL_EVENTS.has(e.event))) return toolOf(o, e.event)
  const err = o.error as { message?: unknown } | string | undefined
  if (err) return { kind: 'error', message: typeof err === 'string' ? err : String(err.message ?? JSON.stringify(err)) }
  const choice = (o.choices as Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }> | undefined)?.[0]
  const text = asText(choice?.delta?.content ?? choice?.message?.content)
  return text ? { kind: 'text', text } : NONE
}

/** A whole answer given in one JSON (a server that does not stream): its text. */
export function harnessReplyText(json: unknown): string {
  const c = (json as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content
  return typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (p as { text?: string }).text ?? '').join('') : ''
}

/** A harness's error said in words (its HTTP status). */
export function harnessError(status: number, body: string): string {
  const said = (() => {
    try {
      const o = JSON.parse(body) as { error?: { message?: string } | string; message?: string }
      return typeof o.error === 'string' ? o.error : (o.error?.message ?? o.message ?? '')
    } catch {
      return body.slice(0, 200)
    }
  })()
  /** What each status means for a harness. */
  const WHY: Record<number, string> = {
    401: 'ключ не подошёл (API-ключ сервера агента)',
    403: 'доступ запрещён',
    404: 'нет такого адреса — адрес нужен до /v1',
    409: 'сессия занята другим входом агента (CLI, мессенджер) — поменяйте заголовок сессии или начните новый чат',
    429: 'агент занят другими запросами — попробуйте позже',
  }
  return `Агент ответил ${status}: ${WHY[status] ?? 'ошибка'}${said ? ` — ${said}` : ''}`
}

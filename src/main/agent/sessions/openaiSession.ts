import type { ModelSession, ModelStep, ToolResult, ToolSpec } from '../../../shared/agent/agentLoop'
import { openAiError, openAiResults, openAiTools, readOpenAiReply, toolsRefused, type OpenAiMessage } from '../../../shared/agent/openaiWire'

/**
 * A conversation over Chat Completions (OpenAI, OpenRouter, Ollama, a compatible server). A model that cannot call
 * tools is asked again without them — it answers from what it was given.
 */
export class OpenAiSession implements ModelSession {
  private readonly messages: OpenAiMessage[]
  private tools: ToolSpec[]
  /** The model answers without tools (it refused them). */
  toolless = false

  constructor(private readonly o: { baseUrl: string; key?: string; headers?: Record<string, string>; model: string; system: string; prompt: string; tools: ToolSpec[] }) {
    this.messages = [
      { role: 'system', content: o.system },
      { role: 'user', content: o.prompt },
    ]
    this.tools = o.tools
  }

  async step(signal: AbortSignal): Promise<ModelStep> {
    const body = { model: this.o.model, messages: this.messages, ...(this.tools.length ? { tools: openAiTools(this.tools) } : {}) }
    const res = await openAiFetch(this.o, '/chat/completions', { method: 'POST', body: JSON.stringify(body), signal })
    const text = await res.text()
    if (!res.ok) {
      if (this.tools.length && toolsRefused(res.status, text)) {
        this.tools = []
        this.toolless = true
        return this.step(signal)
      }
      throw new Error(openAiError(res.status, text))
    }
    const { step, message } = readOpenAiReply(JSON.parse(text))
    this.messages.push(message)
    return step
  }

  answer(results: ToolResult[]): void {
    this.messages.push(...openAiResults(results))
  }
}

type Conn = { baseUrl: string; key?: string; headers?: Record<string, string> }
/** A request to the server (its key, its own headers); no connection — said so, with the address. */
async function openAiFetch(c: Conn, path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${c.baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(c.key ? { Authorization: `Bearer ${c.key}` } : {}), ...c.headers },
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new Error(`Нет связи с ${c.baseUrl}`)
  }
}
/** The models the server offers. */
export async function openAiModels(c: Conn): Promise<string[]> {
  const res = await openAiFetch(c, '/models', { method: 'GET' })
  const text = await res.text()
  if (!res.ok) throw new Error(openAiError(res.status, text))
  const data = (JSON.parse(text) as { data?: Array<{ id?: string }> }).data ?? []
  return data.map((m) => m.id ?? '').filter(Boolean).sort()
}

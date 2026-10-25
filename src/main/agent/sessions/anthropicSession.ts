import Anthropic from '@anthropic-ai/sdk'
import type { ModelSession, ModelStep, ToolResult, ToolSpec } from '../../../shared/agent/agentLoop'

/** A conversation with Claude over the Messages API (the official SDK): its history kept as the API takes it. */
export class AnthropicSession implements ModelSession {
  private readonly client: Anthropic
  private readonly messages: Anthropic.MessageParam[]
  private readonly tools: Anthropic.Tool[]

  constructor(
    private readonly o: { key: string; baseUrl?: string; model: string; system: string; prompt: string; tools: ToolSpec[] },
  ) {
    this.client = new Anthropic({ apiKey: o.key, ...(o.baseUrl ? { baseURL: o.baseUrl } : {}) })
    this.messages = [{ role: 'user', content: o.prompt }]
    this.tools = o.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema as Anthropic.Tool.InputSchema }))
  }

  async step(signal: AbortSignal): Promise<ModelStep> {
    for (;;) {
      const r = await this.client.messages.create(
        { model: this.o.model, max_tokens: 16000, system: this.o.system, messages: this.messages, ...(this.tools.length ? { tools: this.tools } : {}) },
        { signal },
      )
      const text = r.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
      // a server-side pause: the turn goes on as it was
      if (r.stop_reason === 'pause_turn') {
        this.messages.push({ role: 'assistant', content: r.content })
        continue
      }
      if (r.stop_reason === 'refusal') return { text, calls: [], stopped: 'Модель отказалась отвечать' }
      const uses = r.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      // (a tool's arguments cut off by the size limit are never run)
      if (r.stop_reason === 'max_tokens') return { text, calls: [], stopped: uses.length ? 'Ответ модели оборван (лимит длины)' : 'Ответ обрезан по длине' }
      this.messages.push({ role: 'assistant', content: r.content })
      return { text, calls: uses.map((u) => ({ id: u.id, name: u.name, input: (u.input ?? {}) as Record<string, unknown> })) }
    }
  }

  answer(results: ToolResult[]): void {
    this.messages.push({
      role: 'user',
      content: results.map((x): Anthropic.ToolResultBlockParam => ({ type: 'tool_result', tool_use_id: x.id, content: x.text, ...(x.error ? { is_error: true } : {}) })),
    })
  }
}

/** The models of the account (their ids, newest first as the API lists them). */
export async function anthropicModels(key: string, baseUrl?: string): Promise<string[]> {
  const client = new Anthropic({ apiKey: key, ...(baseUrl ? { baseURL: baseUrl } : {}) })
  const out: string[] = []
  for await (const m of client.models.list()) out.push(m.id)
  return out
}
/** An API error in words for the person (the key, the limits, the provider down). */
export function anthropicError(e: unknown): string | undefined {
  if (e instanceof Anthropic.AuthenticationError) return 'Ключ Anthropic не подошёл'
  if (e instanceof Anthropic.PermissionDeniedError) return 'Нет доступа к этой модели'
  if (e instanceof Anthropic.NotFoundError) return 'Модель не найдена'
  if (e instanceof Anthropic.RateLimitError) return 'Лимит запросов Anthropic — попробуйте позже'
  if (e instanceof Anthropic.APIConnectionError) return 'Нет связи с Anthropic API'
  if (e instanceof Anthropic.APIError) return `Anthropic API ${e.status ?? ''}: ${e.message}`
  return undefined
}

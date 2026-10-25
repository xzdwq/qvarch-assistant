import type { ModelStep, ToolResult, ToolSpec } from './agentLoop'

/**
 * Chat Completions (OpenAI, OpenRouter, Ollama, any compatible server) as plain data: the tools as it takes them, a
 * reply read into a step, the tools' results as its messages.
 */
export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

export const openAiTools = (tools: ToolSpec[]) => tools.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.schema } }))

/** A tool's arguments as the model wrote them (a string of JSON; broken — none, the tool says what it lacks). */
function args(s: string | undefined): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(s || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** A reply read: the step, and the assistant's message as the history keeps it. */
export function readOpenAiReply(body: unknown): { step: ModelStep; message: OpenAiMessage } {
  const choice = (body as { choices?: Array<{ message?: OpenAiMessage; finish_reason?: string }> })?.choices?.[0]
  if (!choice?.message) throw new Error('Пустой ответ модели')
  const m = choice.message
  const text = typeof m.content === 'string' ? m.content : ''
  const calls = (m.tool_calls ?? []).map((c, i) => ({ id: c.id || `call_${i}`, name: c.function?.name ?? '', input: args(c.function?.arguments) }))
  const message: OpenAiMessage = { role: 'assistant', content: m.content ?? null, ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}) }
  if (choice.finish_reason === 'length' && !calls.length) return { step: { text, calls: [], stopped: 'Ответ обрезан по длине' }, message }
  if (choice.finish_reason === 'content_filter') return { step: { text, calls: [], stopped: 'Модель отказалась отвечать' }, message }
  return { step: { text, calls }, message }
}
export const openAiResults = (results: ToolResult[]): OpenAiMessage[] => results.map((r) => ({ role: 'tool', tool_call_id: r.id, content: r.error ? `Ошибка: ${r.text}` : r.text }))

/** The server said the model cannot call tools (some local models): it is asked again without them. */
export const toolsRefused = (status: number, text: string): boolean => status >= 400 && status < 500 && /tool/i.test(text) && /(not )?support|unsupported|не поддерж/i.test(text)

/** An error answer in words (the provider's own message when it gives one). */
export function openAiError(status: number, text: string): string {
  let msg = text
  try {
    const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string }
    msg = (typeof j.error === 'string' ? j.error : j.error?.message) ?? j.message ?? text
  } catch {
    // not JSON — as it is
  }
  const said = msg.trim().slice(0, 300)
  if (status === 401 || status === 403) return `Ключ не подошёл (${status})${said ? `: ${said}` : ''}`
  if (status === 404) return `Не найдено (404) — проверьте адрес и модель${said ? `: ${said}` : ''}`
  if (status === 429) return `Лимит запросов (429)${said ? `: ${said}` : ''}`
  return `Ошибка ${status}${said ? `: ${said}` : ''}`
}

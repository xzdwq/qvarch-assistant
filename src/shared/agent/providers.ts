/**
 * The AI providers an agent may run on: one record each (how it is spoken to, where, whether it needs a key). Adding a
 * provider of an existing protocol is a line here; a new protocol — its session in main (main/agent/sessions).
 */

/**
 * How a provider is spoken to: Claude Code (an agent of its own, our tools over MCP), the Messages API, Chat Completions,
 * an agent harness elsewhere (Hermes, Atomic Agent…: its own tools and loop, spoken to over a streamed Chat Completions;
 * it answers in the chat).
 */
export const AGENT_PROTOCOLS = ['claude-code', 'anthropic', 'openai', 'harness'] as const
export type AgentProtocol = (typeof AGENT_PROTOCOLS)[number]

/** Whether a key is asked for. */
export type KeyNeed = 'required' | 'optional' | 'none'

export interface AgentProvider {
  title: string
  protocol: AgentProtocol
  /** Its address (none — not over HTTP). */
  baseUrl?: string
  key: KeyNeed
  /** The model offered first (none — the provider's own default). */
  model?: string
  /** Headers the provider asks for (besides the key). */
  headers?: Record<string, string>
  /** How big a turn's context may be, characters (a local model takes less). */
  budget: number
  /** A word of help under the form. */
  hint: string
  /** A harness: the header its conversation is kept by (each chat its own; the profile may name another). */
  sessionHeader?: string
  /** A harness: the name of the streamed event that tells its tools' work (none — not told). */
  toolEvent?: string
}

export const AGENT_PROVIDER_IDS = ['claude-code', 'anthropic', 'openai', 'openrouter', 'ollama', 'custom', 'hermes', 'harness'] as const
export type AgentProviderId = (typeof AGENT_PROVIDER_IDS)[number]

export const AGENT_PROVIDERS: Record<AgentProviderId, AgentProvider> = {
  'claude-code': { title: 'Claude Code', protocol: 'claude-code', key: 'none', budget: 200_000, hint: 'Использует вход Claude Code (подписка или ключ — его настройка). Нужна команда claude и включённый MCP-сервер.' },
  anthropic: { title: 'Anthropic API', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', key: 'required', model: 'claude-opus-5-5', budget: 200_000, hint: 'Ключ из console.anthropic.com.' },
  openai: { title: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', key: 'required', budget: 120_000, hint: 'Ключ из platform.openai.com.' },
  openrouter: { title: 'OpenRouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', key: 'required', headers: { 'X-Title': 'Qvarch Assistant' }, budget: 120_000, hint: 'Ключ из openrouter.ai; модели любых поставщиков.' },
  ollama: { title: 'Ollama', protocol: 'openai', baseUrl: 'http://localhost:11434/v1', key: 'none', budget: 24_000, hint: 'Локальные модели: Ollama должна быть запущена. Инструменты — только у моделей, которые их поддерживают.' },
  custom: { title: 'Свой сервер', protocol: 'openai', key: 'optional', budget: 32_000, hint: 'Любой OpenAI-совместимый сервер (LM Studio, vLLM…): адрес до /v1.' },
  hermes: {
    title: 'Hermes Agent',
    protocol: 'harness',
    baseUrl: 'http://localhost:8642/v1',
    key: 'required',
    budget: 60_000,
    sessionHeader: 'X-Hermes-Session-Id',
    toolEvent: 'hermes.tool.progress',
    hint: 'Агент со своими инструментами и памятью: его API-сервер (API_SERVER_ENABLED, API_SERVER_KEY), адрес до /v1. У каждого чата своя сессия у агента; его шаги — в «Метаданных». Он отвечает в чате, заметки не правит.',
  },
  harness: {
    title: 'Другой агент (OpenAI-совместимый)',
    protocol: 'harness',
    key: 'optional',
    budget: 60_000,
    hint: 'Любой агент со своим API в формате Chat Completions (Atomic Agent — atomic-agent serve, и другие): адрес до /v1; заголовок сессии — если агент помнит разговор по нему.',
  },
}
export const isAgentProvider = (x: unknown): x is AgentProviderId => typeof x === 'string' && Object.hasOwn(AGENT_PROVIDERS, x)

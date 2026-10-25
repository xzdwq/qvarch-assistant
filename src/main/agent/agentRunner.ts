import { runAgentLoop, type ToolSpec, type TraceLine } from '../../shared/agent/agentLoop'
import { buildPack, type Pack } from '../../shared/agent/contextPack'
import { baseUrlOf, modelOf, type AgentProfile } from '../../shared/agent/profiles'
import { AGENT_PROVIDERS, type AgentProtocol } from '../../shared/agent/providers'
import type { TurnAnswer, TurnRequest } from '../../shared/agent/turn'
import type { AppContext } from '../app/appContext'
import type { McpHost } from '../ipc/mcpIpc'
import type { McpTool } from '../mcp'
import { qvarchTools } from '../mcpTools'
import { componentsBrief } from '../../notebook/blocks/catalog'
import type { AgentStore } from './agentStore'
import { claudeCodeTurn, claudeVersion } from './claudeCode'
import { anthropicError, anthropicModels, AnthropicSession } from './sessions/anthropicSession'
import { openAiModels, OpenAiSession } from './sessions/openaiSession'
import { turnTools } from './turnTools'

/** What a turn of one protocol is given. */
interface TurnRun {
  profile: AgentProfile
  key?: string
  pack: Pack
  tools: McpTool[]
  signal: AbortSignal
  /** Each tool call as it is made (the window shows the agent working). */
  onTrace: (t: TraceLine) => void
}
/** How each protocol runs a turn, lists its models, says its errors (the compiler checks none is missing). */
interface ProtocolRunner {
  turn(r: TurnRun, host: McpHost): Promise<{ text: string; note?: string }>
  models(p: AgentProfile, key?: string): Promise<string[]>
  error(e: unknown): string | undefined
}
const specs = (tools: McpTool[]): ToolSpec[] => tools.map((t) => ({ name: t.name, description: t.description, schema: t.inputSchema }))
/** The loop's tool call: the tool by its name (an unknown one — said to the model). */
const callerOf = (tools: McpTool[]) => async (c: { name: string; input: Record<string, unknown> }) => {
  const t = tools.find((x) => x.name === c.name)
  if (!t) throw new Error(`Нет инструмента ${c.name}`)
  return t.run(c.input)
}
const needKey = (p: AgentProfile, key?: string): string => {
  if (!key && AGENT_PROVIDERS[p.provider].key === 'required') throw new Error(`Нет ключа для «${p.name}» — укажите его в Настройках → ИИ-агенты`)
  return key ?? ''
}

const RUNNERS: Record<AgentProtocol, ProtocolRunner> = {
  'claude-code': {
    async turn(r, host) {
      if (!host.mcp.info().listening) throw new Error('MCP-сервер Qvarch выключен — включите его (Настройки → ИИ-агенты): через него Claude Code работает с приложением')
      // (each call of a tool is seen here: the server serves the turn's own tools)
      const traced = r.tools.map((t) => ({
        ...t,
        run: async (a: Record<string, unknown>) => {
          try {
            const out = await t.run(a)
            r.onTrace({ tool: t.name, args: JSON.stringify(a).slice(0, 160), ok: true, result: out.slice(0, 160) })
            return out
          } catch (e) {
            r.onTrace({ tool: t.name, args: JSON.stringify(a).slice(0, 160), ok: false, result: (e as Error).message.slice(0, 160) })
            throw e
          }
        },
      }))
      const open = host.mcp.openTurn(() => traced)
      try {
        const text = await claudeCodeTurn({ system: r.pack.system, prompt: r.pack.prompt, model: r.profile.model || undefined, project: r.profile.project, mcp: { url: open.url, token: open.token }, signal: r.signal })
        return { text }
      } finally {
        open.close()
      }
    },
    async models() {
      // (found and starting — the aliases it takes; the model itself is Claude Code's choice when none is given)
      await claudeVersion()
      return ['sonnet', 'opus', 'haiku']
    },
    error: () => undefined,
  },
  anthropic: {
    async turn(r) {
      const session = new AnthropicSession({ key: needKey(r.profile, r.key), baseUrl: baseUrlOf(r.profile), model: modelOf(r.profile), system: r.pack.system, prompt: r.pack.prompt, tools: specs(r.tools) })
      return runAgentLoop({ session, callTool: callerOf(r.tools), signal: r.signal, onTrace: r.onTrace })
    },
    models: (p, key) => anthropicModels(needKey(p, key), baseUrlOf(p)),
    error: anthropicError,
  },
  openai: {
    async turn(r) {
      const p = r.profile
      if (!modelOf(p)) throw new Error(`Не выбрана модель для «${p.name}»`)
      const session = new OpenAiSession({ baseUrl: baseUrlOf(p) ?? '', key: needKey(p, r.key) || undefined, headers: AGENT_PROVIDERS[p.provider].headers, model: modelOf(p), system: r.pack.system, prompt: r.pack.prompt, tools: specs(r.tools) })
      const out = await runAgentLoop({ session, callTool: callerOf(r.tools), signal: r.signal, onTrace: r.onTrace })
      return session.toolless ? { ...out, note: [out.note, 'модель без инструментов — ответ только по контексту'].filter(Boolean).join('; ') } : out
    },
    models: (p, key) => {
      const base = baseUrlOf(p)
      if (!base) throw new Error('Укажите адрес сервера')
      return openAiModels({ baseUrl: base, key: key || undefined, headers: AGENT_PROVIDERS[p.provider].headers })
    },
    error: () => undefined,
  },
}

/**
 * This person's agents at work: a turn asked by the window (a chat called the agent) — its context built, its tools
 * given by who called it, the model of its profile run; one may be stopped.
 */
export class AgentRunner {
  private readonly turns = new Map<string, AbortController>()
  constructor(
    private readonly app: AppContext,
    private readonly host: McpHost,
    private readonly store: AgentStore,
  ) {}

  async run(req: TurnRequest, onTrace: (t: TraceLine) => void): Promise<TurnAnswer> {
    const profile = this.store.profile(req.profile)
    if (!profile) return { text: '', trace: [], error: 'Этого ИИ больше нет в настройках' }
    const runner = RUNNERS[AGENT_PROVIDERS[profile.provider].protocol]
    const ac = new AbortController()
    this.turns.get(req.turn)?.abort()
    this.turns.set(req.turn, ac)
    const trace: TraceLine[] = []
    try {
      // an agent writes in the background (the note one is in never switches), its lines marked as its
      const ui = <T>(op: string, args: Record<string, unknown>) => this.host.toolCtx.ui<T>(op, { ...args, quiet: true, by: { turn: req.turn, name: req.agentName } })
      const vault = this.app.vault
      const tools = turnTools({
        req,
        profile,
        base: qvarchTools({ ...this.host.toolCtx, ui }),
        tree: () => vault.tree(),
        search: (q) => vault.search(q),
        backlinks: (p) => vault.backlinks(p),
        mkdir: (dir, name) => vault.create(dir, 'folder', name),
        ui,
      })
      const pack = buildPack({ agentName: req.agentName, owner: req.owner, instructions: profile.instructions, doc: req.doc, links: req.links, folder: req.folder, messages: req.messages, question: req.question, budget: AGENT_PROVIDERS[profile.provider].budget, tools: true, components: componentsBrief() })
      const out = await runner.turn({ profile, key: this.store.key(profile.id), pack, tools, signal: ac.signal, onTrace: (t) => (trace.push(t), onTrace(t)) }, this.host)
      return { text: out.text, trace, ...(out.note ? { note: out.note } : {}) }
    } catch (e) {
      if (ac.signal.aborted) return { text: '', trace, error: 'Остановлено' }
      return { text: '', trace, error: runner.error(e) ?? (e instanceof Error ? e.message : String(e)) }
    } finally {
      if (this.turns.get(req.turn) === ac) this.turns.delete(req.turn)
    }
  }
  stop(turn: string): void {
    this.turns.get(turn)?.abort()
  }
  stopAll(): void {
    for (const ac of this.turns.values()) ac.abort()
  }
  /** The models a profile may run (checks the connection and the key on the way). */
  async models(profileId: string): Promise<string[]> {
    const p = this.store.profile(profileId)
    if (!p) throw new Error('Профиль не найден')
    const runner = RUNNERS[AGENT_PROVIDERS[p.provider].protocol]
    try {
      return await runner.models(p, this.store.key(p.id))
    } catch (e) {
      throw new Error(runner.error(e) ?? (e instanceof Error ? e.message : String(e)))
    }
  }
}

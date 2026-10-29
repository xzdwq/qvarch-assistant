import type { ModelTrace } from '../../shared/agent/agentLoop'
import type { Pack } from '../../shared/agent/contextPack'
import type { TrajStep } from '../../shared/agent/trajectory'
import type { McpTool } from '../mcp'
import type { RemoteTool } from './sessions/harnessSession'

/**
 * A turn's trajectory as it goes (the journal keeps it): from the turn's start — the instructions and the context it
 * was given (how long they took to gather), the question, each step of the model, each tool called (timed where it
 * runs — the same for every provider: the loop's tools, Claude Code's through MCP), the answer or the error.
 */
export class TurnTrajectory {
  private readonly t0 = Date.now()
  readonly steps: TrajStep[] = []

  private since = () => Date.now() - this.t0

  /** What the model was given: its instructions, the context (gathered in `ms`), the question. */
  given(pack: Pack, ms: number, question: string, extra: { memory?: boolean; links?: number; messages?: number }): void {
    this.steps.push({ kind: 'system', at: 0, ms: 0, text: `Системная инструкция · ${pack.system.length} симв.` })
    const parts = [`документ и обсуждение · ${pack.prompt.length} симв.`, extra.memory ? 'память документа' : '', extra.links ? `ссылок: ${extra.links}` : '', extra.messages ? `сообщений: ${extra.messages}` : '', pack.omitted ? `ранних сообщений не вошло: ${pack.omitted}` : '']
    this.steps.push({ kind: 'context', at: 0, ms, text: `Контекст: ${parts.filter(Boolean).join(' · ')}` })
    this.steps.push({ kind: 'user', at: ms, ms: 0, text: question })
  }
  /** A step of the model ended: it took `ms`, said `text`, asked for `calls` tools. */
  model(m: ModelTrace): void {
    this.steps.push({ kind: 'model', at: this.since() - m.ms, ms: m.ms, text: m.text || (m.calls ? `(только вызов инструментов: ${m.calls})` : '(без слов)') })
  }
  /** The turn's tools, each call timed. */
  timed(tools: McpTool[]): McpTool[] {
    return tools.map((t) => ({
      ...t,
      run: async (a: Record<string, unknown>) => {
        const at = this.since()
        const args = JSON.stringify(a)
        try {
          const out = await t.run(a)
          this.steps.push({ kind: 'tool', at, ms: this.since() - at, tool: t.name, text: args, result: out })
          return out
        } catch (e) {
          this.steps.push({ kind: 'tool', at, ms: this.since() - at, tool: t.name, text: args, result: e instanceof Error ? e.message : String(e), failed: true })
          throw e
        }
      },
    }))
  }
  /** A tool of a harness elsewhere, as it told (its time — from that turn's start, about the same as this). */
  remote(t: RemoteTool): void {
    this.steps.push({ kind: 'tool', at: t.at, ms: t.ms, tool: t.name, text: t.args ?? '', result: t.result ?? '', ...(t.failed ? { failed: true } : {}) })
  }
  /** How it ended: its answer, or its error. */
  ended(text: string, error?: string): TrajStep[] {
    this.steps.push(error ? { kind: 'error', at: this.since(), ms: 0, text: error } : { kind: 'answer', at: this.since(), ms: 0, text: text || '(без ответа)' })
    return this.steps
  }
}

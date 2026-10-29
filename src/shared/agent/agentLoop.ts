/**
 * An agent's turn over any model: the model answers — words, or tools to call; the tools called, their results told
 * back; again, until it answers in words (or the steps run out). Each provider's conversation keeps its own history in
 * its own format (a ModelSession): the loop never translates messages.
 */

/** A tool as a model is told of it. */
export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema of its arguments. */
  schema: Record<string, unknown>
}
/** A tool the model asked for. */
export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}
export interface ToolResult {
  id: string
  text: string
  error?: boolean
}
/** What a model said in one step: its words and the tools it calls (none — it is done). */
export interface ModelStep {
  text: string
  calls: ToolCall[]
  /** It stopped by itself before answering (refused, cut off): the turn ends with this said. */
  stopped?: string
}
/** One provider's conversation: a step asked, tools' results told back. */
export interface ModelSession {
  step(signal: AbortSignal): Promise<ModelStep>
  answer(results: ToolResult[]): void
}

/** What the agent did in a turn, line by line (shown folded under its answer). */
export interface TraceLine {
  tool: string
  /** Its arguments in short. */
  args: string
  ok: boolean
  /** Its result in short. */
  result: string
}
export interface TurnResult {
  text: string
  trace: TraceLine[]
  /** The turn ended before the model was done (the steps ran out, it refused). */
  note?: string
}

export const MAX_STEPS = 24
const SHORT = 160
const short = (s: string) => (s.length > SHORT ? `${s.slice(0, SHORT)}…` : s)

/** A step of the model as the turn's trajectory takes it: its words, how many tools it called, how long it thought. */
export interface ModelTrace {
  text: string
  calls: number
  ms: number
}

export async function runAgentLoop(o: {
  session: ModelSession
  callTool: (c: ToolCall) => Promise<string>
  signal: AbortSignal
  maxSteps?: number
  onTrace?: (t: TraceLine) => void
  onModel?: (m: ModelTrace) => void
}): Promise<TurnResult> {
  const trace: TraceLine[] = []
  let said = ''
  for (let i = 0; i < (o.maxSteps ?? MAX_STEPS); i++) {
    if (o.signal.aborted) return { text: said, trace, note: 'Остановлено' }
    const t0 = Date.now()
    const step = await o.session.step(o.signal)
    o.onModel?.({ text: step.text.trim(), calls: step.calls.length, ms: Date.now() - t0 })
    if (step.text.trim()) said = step.text.trim()
    if (step.stopped) return { text: said, trace, note: step.stopped }
    if (!step.calls.length) return { text: said, trace }
    const results: ToolResult[] = []
    // (one after another: tools change notes, the order the model asked in is kept)
    for (const c of step.calls) {
      let text: string
      let ok = true
      try {
        text = await o.callTool(c)
      } catch (e) {
        ok = false
        text = e instanceof Error ? e.message : String(e)
      }
      const line: TraceLine = { tool: c.name, args: short(JSON.stringify(c.input)), ok, result: short(text) }
      trace.push(line)
      o.onTrace?.(line)
      results.push({ id: c.id, text, ...(ok ? {} : { error: true }) })
    }
    o.session.answer(results)
  }
  return { text: said, trace, note: `Остановлено после ${o.maxSteps ?? MAX_STEPS} шагов` }
}

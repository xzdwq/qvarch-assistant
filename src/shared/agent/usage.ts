/**
 * What an agent's turn cost, as its provider counted it: tokens sent fresh, read from the prompt cache, written to it,
 * the model's output; the model's steps and the price when the provider says them. Kept in the document's journal
 * (the economy of a way of working is seen there, turn by turn).
 */
export interface TurnUsage {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  /** The model's steps (requests) in the turn. */
  steps?: number
  /** The price, USD (as the provider estimated it). */
  usd?: number
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

/** All tokens of a turn (what was read and written, cached or not). */
export const usageTotal = (u: TurnUsage): number => u.input + u.cacheRead + u.cacheWrite + u.output

/** A usage as kept: whole numbers, a valid one only (another app's or an older one's — none). */
export function turnUsageOf(x: unknown): TurnUsage | undefined {
  if (!isObj(x)) return undefined
  const [input, cacheRead, cacheWrite, output] = [x.input, x.cacheRead, x.cacheWrite, x.output].map(num)
  if (input === undefined || cacheRead === undefined || cacheWrite === undefined || output === undefined) return undefined
  const steps = num(x.steps)
  const usd = num(x.usd)
  return { input: Math.round(input), cacheRead: Math.round(cacheRead), cacheWrite: Math.round(cacheWrite), output: Math.round(output), ...(steps !== undefined ? { steps: Math.round(steps) } : {}), ...(usd !== undefined ? { usd } : {}) }
}

/** The usage in the result of `claude -p --output-format json` (an older one without it — none). */
export function claudeCodeUsage(r: unknown): TurnUsage | undefined {
  if (!isObj(r) || !isObj(r.usage)) return undefined
  const u = r.usage
  return turnUsageOf({ input: u.input_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, output: u.output_tokens, steps: r.num_turns, usd: r.total_cost_usd })
}

/** Tokens in short: 950, 12,3 тыс., 1,25 млн. */
export function tokensText(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toLocaleString('ru-RU', { maximumFractionDigits: n < 10_000 ? 1 : 0 })} тыс.`
  return `${(n / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} млн`
}
/** The usage in words for a hint: each part, the steps, the price. */
export function usageText(u: TurnUsage): string {
  return [
    `Токенов всего: ${tokensText(usageTotal(u))}`,
    `из кэша ${tokensText(u.cacheRead)} · в кэш ${tokensText(u.cacheWrite)} · без кэша ${tokensText(u.input)} · ответ ${tokensText(u.output)}`,
    ...(u.steps !== undefined ? [`шагов модели: ${u.steps}`] : []),
    ...(u.usd !== undefined ? [`≈ $${u.usd.toFixed(u.usd < 1 ? 3 : 2)} по ценам API`] : []),
  ].join('\n')
}

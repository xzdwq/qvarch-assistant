/**
 * A signed span of minutes: + — forward from the moment, − — back (the last N minutes).
 * Zero means nothing, so a step across it skips to the other side.
 */

/** "+30м", "−1ч 30м". */
export function formatOffset(v: number): string {
  const a = Math.abs(Math.round(v))
  const h = Math.floor(a / 60)
  const m = a % 60
  const body = h ? `${h}ч${m ? ` ${m}м` : ''}` : `${m}м`
  return `${v < 0 ? '−' : '+'}${body}`
}

/** The ways a span is written (sign taken off) → its minutes; the first that matches wins. */
const OFFSET_FORMS: ReadonlyArray<[RegExp, (m: RegExpExecArray) => number]> = [
  // 1:30
  [/^(\d+):(\d{1,2})$/, (m) => +m[1] * 60 + +m[2]],
  // 1ч30, 1.5h
  [/^(\d+(?:\.\d+)?)(?:ч|h)(?:(\d+)(?:м|m|мин|min)?)?$/, (m) => +m[1] * 60 + (m[2] ? +m[2] : 0)],
  // 90, 90м
  [/^(\d+)(?:м|m|мин|min)?$/, (m) => +m[1]],
]

/**
 * What was typed → minutes (undefined if it is not a time): "30", "-30", "−1:30", "1ч30", "-1ч 30м",
 * "1,5ч", "90м", "2h". A bare number is minutes.
 */
export function parseOffset(text: string): number | undefined {
  let s = text.trim().toLowerCase().replace(/\s+/g, '').replace('−', '-').replace(',', '.')
  if (!s) return undefined
  let sign = 1
  if (s[0] === '-' || s[0] === '+') {
    if (s[0] === '-') sign = -1
    s = s.slice(1)
  }
  let min: number | undefined
  for (const [re, minutes] of OFFSET_FORMS) {
    const m = re.exec(s)
    if (m) {
      min = minutes(m)
      break
    }
  }
  if (min === undefined || !Number.isFinite(min)) return undefined
  min = Math.round(min)
  return min ? sign * min : undefined
}

/** One wheel / arrow step: to the next multiple of `step`, past zero to the other side; within ±max. */
export function stepOffset(v: number, dir: 1 | -1, step = 10, max = 720): number {
  let next = dir > 0 ? Math.floor(v / step) * step + step : Math.ceil(v / step) * step - step
  if (next === 0) next = dir * step
  return Math.max(-max, Math.min(max, next))
}

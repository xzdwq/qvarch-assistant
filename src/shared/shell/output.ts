/** What a shell block's run gives: its exit code, its streams (their newest part), its lines and what matched. */
export interface ShellValue {
  exitCode: number
  ok: boolean
  stdout: string
  stderr: string
  /** stdout's lines (with `match=` — only the matching ones). */
  lines: string[]
  /** Each matching line's groups (the whole line when the pattern has none). */
  matches?: string[][]
  /** More came than is kept: only the newest part of a stream is there. */
  truncated?: boolean
  ms: number
  /** The folder it ran in ('~' — the user's home on a server). */
  cwd?: string
}

/** Terminal escape sequences (colours, cursor moves, a window's title) — a block shows text, not a terminal. */
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[PX^_][^\x1b]*\x1b\\|\x1b[@-Z\\-_]/g
export const stripAnsi = (s: string) => s.replace(ANSI, '')

/** A line longer than this is checked by its start only. */
const LINE_MAX = 4096
const STREAMS = ['out', 'err'] as const
type Stream = (typeof STREAMS)[number]

/**
 * A shell's output gathered as it comes: each stream's newest `maxBytes` kept (a flood does not grow the memory),
 * stdout cut into lines (a line split between chunks waits for its end); with a pattern — only the matching lines
 * and their groups are kept, never the lines that do not match.
 */
export class OutputCollector {
  private readonly text: Record<Stream, string> = { out: '', err: '' }
  private cut = false
  private carry = ''
  private readonly lines: string[] = []
  private readonly matches: string[][] = []
  /** What the kept lines (and their matches) take, characters. */
  private kept = 0
  private readonly re?: RegExp

  /** `maxBytes` — each stream's text kept; `linesBudget` — the lines and matches kept together (the oldest go). */
  constructor(
    match?: { source: string; flags: string },
    private readonly maxBytes = 2 * 1024 * 1024,
    private readonly linesBudget = 4 * 1024 * 1024,
  ) {
    if (match) this.re = new RegExp(match.source, match.flags.replace(/g/g, ''))
  }

  feed(stream: Stream, raw: string): void {
    // (a sequence split between two chunks leaves its tail as text — rare; colours are asked off at the source too)
    const chunk = stripAnsi(raw)
    const t = this.text[stream] + chunk
    if (t.length > this.maxBytes) {
      this.cut = true
      this.text[stream] = t.slice(t.length - this.maxBytes)
    } else this.text[stream] = t
    if (stream !== 'out') return
    const parts = (this.carry + chunk).split('\n')
    this.carry = parts.pop() ?? ''
    // a line that never ends (a progress bar, binary output) is not grown without end: its start is kept
    if (this.carry.length > LINE_MAX) {
      this.cut = true
      this.carry = this.carry.slice(0, LINE_MAX)
    }
    for (const p of parts) this.line(p)
  }
  private line(raw: string): void {
    const line = raw.replace(/\r$/, '').slice(0, LINE_MAX)
    let groups: string[] | undefined
    if (this.re) {
      const m = this.re.exec(line)
      if (!m) return
      groups = m.length > 1 ? m.slice(1).map((g) => g ?? '') : [line]
      this.matches.push(groups)
    }
    this.lines.push(line)
    this.kept += line.length + (groups && this.re && groups[0] !== line ? groups.join('').length : 0)
    // over the budget: the oldest lines (and their matches) go
    while (this.kept > this.linesBudget && this.lines.length > 1) {
      const old = this.lines.shift()!
      const g = this.re ? this.matches.shift() : undefined
      this.kept -= old.length + (g && g[0] !== old ? g.join('').length : 0)
      this.cut = true
    }
  }

  result(exitCode: number, ms: number): ShellValue {
    if (this.carry) {
      this.line(this.carry)
      this.carry = ''
    }
    return {
      exitCode,
      ok: exitCode === 0,
      stdout: this.text.out,
      stderr: this.text.err,
      lines: [...this.lines],
      ...(this.re ? { matches: [...this.matches] } : {}),
      ...(this.cut ? { truncated: true } : {}),
      ms,
    }
  }
}

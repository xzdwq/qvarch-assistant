/**
 * Терминал: shells (PowerShell) that live while the app lives, a line over each with the place (clickable path),
 * the git branch, the node / npm / pnpm versions, and command presets with `{{ js }}` inserts.
 */
export interface TermInfo {
  /** The shell's current folder (reported by its prompt). */
  cwd: string
  branch?: string
  /** Changed files in the work tree. */
  dirty?: number
  /** The project here: package.json name / version, what node it asks for. */
  project?: { name?: string; version?: string; nodeWanted?: string; packageManager?: string }
  node?: string
  npm?: string
  pnpm?: string
}
export interface TermSession {
  id: string
  title: string
  /** A command is running (Enter was pressed, the prompt has not come back yet). */
  busy: boolean
  /** How long the last command took, ms. */
  lastMs?: number
  /** The process ended (its exit code). */
  exited?: number
  /** The last command failed (its exit code; 1 for a PowerShell error) — until a command goes well. */
  failed?: number
  /** Output the reactions did not check (bytes): the stream outran the check, the excess was skipped. */
  skipped?: number
  info: TermInfo
}
export interface TermPreset {
  id: string
  name: string
  /** The command; `{{ expression }}` is JS over the variables (see the guide). */
  cmd: string
  /** Enter right away (else it is only typed in — to finish it by hand). */
  run: boolean
}
/** A variable of one's own for the presets: a text (it may hold {{ … }}) or a JS expression. */
export interface TermVar {
  id: string
  name: string
  value: string
  /** `value` is a JS expression (else a text). */
  js: boolean
}
/**
 * A reaction: a word (or a regex) in the output of any shell → a notice in the section, and the status bar
 * blinks in its colour until the notice is closed.
 */
export interface TermWatch {
  id: string
  name: string
  /** One per line: a text, or /regex/flags. */
  patterns: string
  ignoreCase: boolean
  /** Only as a whole word (error — yes, errors — no). */
  word: boolean
  color: string
  on: boolean
}
/** A reaction that fired: one per shell and reaction until it is closed (the next matches only count). */
export interface TermAlert {
  id: string
  sid: string
  /** The shell's name at the time. */
  title: string
  watchId: string
  name: string
  color: string
  /** The first match. */
  at: number
  /** The latest one. */
  last: number
  count: number
  /** The line of the latest match. */
  line: string
}
export interface TermConfig {
  presets: TermPreset[]
  vars: TermVar[]
  watches: TermWatch[]
  /** Where a new shell starts. */
  lastCwd?: string
  /** Load the PowerShell profile (oh-my-posh, aliases…). */
  profile: boolean
}

export const presetId = () => Math.random().toString(36).slice(2, 10)

/** The colours offered for a reaction (CSS variables, in integrations.css); a new one takes them in turn. */
export const WATCH_COLOR_VARS = Array.from({ length: 8 }, (_, i) => `--new-watch-${i + 1}` as const)
/**
 * What the built-in variables are worked out from — the facts the main process gathers for the shell in front
 * (its folder and line, the clock, the user, the project's package.json and lock file, the environment).
 */
export interface BuiltinVarFacts {
  cwd: string
  /** The folder's name. */
  dir: string
  info?: TermInfo
  now: Date
  user: string
  /** The project's package.json (parsed), if there is one. */
  pkg: unknown
  /** The package manager by the lock file: pnpm / yarn / npm, or empty. */
  lockfile: string
  env: Record<string, string | undefined>
}
/** A built-in variable: its name, what it is (the Variables tab lists it), how it is worked out and shown short. */
export interface BuiltinVar {
  name: string
  desc: string
  resolve: (f: BuiltinVarFacts) => unknown
  /** How the value is shown next to the variable (else as it goes into a command). */
  show?: (v: unknown) => string
}
const pad2 = (n: number) => String(n).padStart(2, '0')
const branchOf = (f: BuiltinVarFacts) => f.info?.branch ?? ''
/** The built-in variables, in the order they are listed. */
export const BUILTIN_VARS: readonly BuiltinVar[] = [
  { name: 'currentBranch', desc: 'ветка git в папке оболочки; пусто, если папка не в git', resolve: branchOf },
  { name: 'branch', desc: 'то же, что currentBranch', resolve: branchOf },
  { name: 'task', desc: 'ключ задачи из названия ветки (ABC-123); пусто, если его там нет', resolve: (f) => branchOf(f).match(/[A-Z][A-Z0-9]+-\d+/)?.[0] ?? '' },
  { name: 'cwd', desc: 'полный путь папки, где сейчас оболочка', resolve: (f) => f.cwd },
  { name: 'dir', desc: 'имя этой папки', resolve: (f) => f.dir },
  { name: 'date', desc: 'сегодняшняя дата, ГГГГ-ММ-ДД', resolve: ({ now }) => `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}` },
  { name: 'time', desc: 'время сейчас, ЧЧ:ММ', resolve: ({ now }) => `${pad2(now.getHours())}:${pad2(now.getMinutes())}` },
  { name: 'now', desc: 'дата и время (объект Date — для формул)', resolve: (f) => f.now, show: (v) => (v as Date).toLocaleString('ru-RU') },
  { name: 'user', desc: 'имя пользователя Windows', resolve: (f) => f.user },
  { name: 'node', desc: 'версия node в этой оболочке', resolve: (f) => f.info?.node ?? '' },
  { name: 'npm', desc: 'версия npm', resolve: (f) => f.info?.npm ?? '' },
  { name: 'pnpm', desc: 'версия pnpm', resolve: (f) => f.info?.pnpm ?? '' },
  { name: 'dirty', desc: 'сколько файлов изменено в git', resolve: (f) => f.info?.dirty ?? 0 },
  {
    name: 'pkg',
    desc: 'package.json проекта (для формул: pkg.version, pkg.scripts…)',
    resolve: (f) => f.pkg,
    show: (v) => (v ? `package.json «${(v as { name?: string }).name ?? ''}»` : ''),
  },
  { name: 'lockfile', desc: 'менеджер пакетов проекта по lock-файлу: pnpm / yarn / npm', resolve: (f) => f.lockfile },
  { name: 'env', desc: 'переменные окружения (для формул: env.USERPROFILE)', resolve: (f) => ({ ...f.env }), show: (v) => `${Object.keys(v as object).length} переменных окружения` },
]
/** The built-in variables worked out from the facts: name → value. */
export const builtinValues = (facts: BuiltinVarFacts): Record<string, unknown> => Object.fromEntries(BUILTIN_VARS.map((b) => [b.name, b.resolve(facts)]))
/** A name a variable can have (a JS identifier). */
export const VAR_NAME = /^[A-Za-z_$][\w$]*$/

/**
 * A reaction → one regex (`source` + `flags`, global and multiline). Each line is a text (escaped) or /regex/flags
 * (its i / s / m flags apply to it alone). Throws with a readable message on a bad regex.
 */
export function compileWatch(w: Pick<TermWatch, 'patterns' | 'ignoreCase' | 'word'>): { source: string; flags: string } | undefined {
  const parts: string[] = []
  for (const raw of w.patterns.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^\/(.+)\/([a-z]*)$/)
    let body = m ? m[1] : line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (m) {
      try {
        new RegExp(body)
      } catch (e) {
        throw new Error(`${line}: ${e instanceof Error ? e.message.replace(/^Invalid regular expression: /, '') : String(e)}`)
      }
      const mods = m[2].replace(/[^ims]/g, '')
      if (mods) body = `(?${[...new Set(mods)].join('')}:${body})`
    }
    parts.push(`(?:${body})`)
  }
  if (!parts.length) return undefined
  let source = parts.join('|')
  // a whole word: no letter / digit right before or after (Cyrillic too)
  if (w.word) source = `(?<![A-Za-zА-Яа-яЁё0-9_])(?:${source})(?![A-Za-zА-Яа-яЁё0-9_])`
  return { source, flags: `gm${w.ignoreCase ? 'i' : ''}` }
}

/**
 * One batch of a shell's output through the reactions: line by line (`carry` — the unfinished last line, raw), the
 * escape codes stripped, each line counted once per rule. Self-contained: the main process runs it in a sandbox
 * with a time limit (a slow regex must not stall the app) — it is passed there as text.
 */
export function scanBatch(
  raw: string,
  carry: string,
  rules: Array<{ id: string; source: string; flags: string }>,
  cache: Record<string, RegExp>,
): { carry: string; hits: ScanHit[] } {
  const MAX_LINE = 4096
  // the cursor put at a place = a new line (the pseudo-console redraws with it instead of \n)
  const text = (carry + raw).replace(/\x1b\[\d*(?:;\d*)?[Hf]/g, '\n')
  const end = text.lastIndexOf('\n')
  let rest = end < 0 ? text : text.slice(end + 1)
  if (rest.length > MAX_LINE) rest = rest.slice(-MAX_LINE)
  if (end < 0) return { carry: rest, hits: [] }
  const body = text
    .slice(0, end)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[PX^_][^\x1b]*(?:\x1b\\)?|\x1b[@-Z\\-_]/g, '')
    .replace(/\r(?!\n)/g, ' ')
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '')
  const hits: ScanHit[] = []
  for (const r of rules) {
    const key = `${r.flags}/${r.source}`
    let re = cache[key]
    if (!re) re = cache[key] = new RegExp(r.source, r.flags)
    re.lastIndex = 0
    let count = 0
    let line = ''
    /** The matched lines by their key (letters only: a spinner, a counter, a timer on the line do not make it new). */
    const keys: Record<string, [number, string]> = {}
    let nk = 0
    for (let m = re.exec(body); m; m = re.exec(body)) {
      const a = body.lastIndexOf('\n', m.index) + 1
      let b = body.indexOf('\n', m.index + Math.max(1, m[0].length) - 1)
      if (b < 0) b = body.length
      count++
      line = body.slice(a, b)
      const k = line.toLowerCase().replace(/[^a-zа-яё]+/g, ' ').trim().slice(0, 200)
      if (k in keys) keys[k] = [keys[k][0] + 1, line]
      else if (nk < 50) {
        keys[k] = [1, line]
        nk++
      }
      // the next line: one count per line
      re.lastIndex = b + 1
      if (re.lastIndex > body.length) break
    }
    if (count) hits.push({ id: r.id, count, line: line.trim().slice(0, 300), keys: Object.entries(keys).map(([k, [n, l]]) => [k, n, l.trim().slice(0, 300)]) })
  }
  return { carry: rest, hits }
}
/** A matched line's key: letters only (a spinner, a counter, a timer do not make the line new) — as in scanBatch. */
export const lineKey = (line: string) => line.toLowerCase().replace(/[^a-zа-яё]+/g, ' ').trim().slice(0, 200)
/** A reaction's matches in one batch: how many lines, the last one, the lines by key (at most 50 keys). */
export interface ScanHit {
  id: string
  count: number
  line: string
  /** [key, lines, the last such line]. */
  keys: Array<[string, number, string]>
}

/** The `ask('Вопрос', 'по умолчанию')` calls of a command — asked before it runs. */
export function presetAsks(cmd: string): Array<{ label: string; def: string }> {
  const out: Array<{ label: string; def: string }> = []
  for (const m of cmd.matchAll(/ask\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*(?:,\s*(['"`])((?:\\.|(?!\3).)*)\3)?\s*\)/g)) {
    if (!out.some((x) => x.label === m[2])) out.push({ label: m[2], def: m[4] ?? '' })
  }
  return out
}

/** A path → its crumbs: C:\Users\me → [{ name: 'C:', path: 'C:\\' }, { name: 'Users', … }, …]. */
export function crumbs(p: string): Array<{ name: string; path: string }> {
  if (!p) return []
  const unc = p.startsWith('\\\\')
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]+/).filter(Boolean)
  const out: Array<{ name: string; path: string }> = []
  let acc = unc ? '\\\\' : ''
  parts.forEach((name, i) => {
    acc = i === 0 ? `${acc}${name}` : `${acc}\\${name}`
    out.push({ name, path: i === 0 && /^[A-Za-z]:$/.test(name) ? `${name}\\` : acc })
  })
  return out
}

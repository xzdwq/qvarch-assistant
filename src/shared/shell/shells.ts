/**
 * The shells a notebook block runs a script in, and how each is started: on this PC (a program with its arguments,
 * the script given in a way it reads without quoting trouble) or on an SSH server (a command line, the script on stdin).
 */

export const SHELL_KINDS = ['powershell', 'cmd', 'bash'] as const
export type ShellKind = (typeof SHELL_KINDS)[number]

/** A block's language → its shell. */
export const SHELL_LANGS: Readonly<Record<string, ShellKind>> = { powershell: 'powershell', pwsh: 'powershell', ps1: 'powershell', cmd: 'cmd', bat: 'cmd', bash: 'bash', sh: 'bash' }
export const shellKindOf = (lang: string): ShellKind | undefined => (Object.hasOwn(SHELL_LANGS, lang) ? SHELL_LANGS[lang] : undefined)

/**
 * Put before a PowerShell script: its output is UTF-8 (the console's code page would garble Cyrillic); no progress
 * bars (with its streams redirected PowerShell writes them to stderr as CLIXML).
 */
export const UTF8_PRELUDE = "[Console]::OutputEncoding=[Text.Encoding]::UTF8;$OutputEncoding=[Text.Encoding]::UTF8;$ProgressPreference='SilentlyContinue';if ($PSStyle) { $PSStyle.OutputRendering = 'PlainText' };"

/** UTF-8's byte order mark (Windows PowerShell reads a .ps1 without it in the ANSI code page). */
const BOM = String.fromCharCode(0xfeff)
const VAR_NAME = /^[A-Za-z_]\w*$/
const asText = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v) ?? '')

/** How each shell sets a variable (the value as it gets it, quoted its way). */
const ASSIGN: Record<ShellKind, (name: string, value: string) => string> = {
  // (PowerShell ends a '…' string at the typographic single quotes too: each is doubled as well)
  powershell: (n, v) => `$env:QA_${n} = '${v.replace(/['‘’‚‛]/g, (q) => q + q)}'\n`,
  cmd: (n, v) => `set "QA_${n}=${v.replace(/[\r\n]+/g, ' ')}"\r\n`,
  bash: (n, v) => `export QA_${n}='${v.replace(/'/g, `'\\''`)}'\n`,
}

/** The note's values as the shell's variables QA_<name> (text as it is, anything else as JSON); other names left out. */
export function valuesPrefix(kind: ShellKind, vars: Record<string, unknown>): string {
  return Object.entries(vars)
    .filter(([n]) => VAR_NAME.test(n))
    .map(([n, v]) => ASSIGN[kind](n, asText(v)))
    .join('')
}

/** How each shell refers to a variable in its script (cmd — delayed: the value is never parsed as the script's code). */
const REFER: Record<ShellKind, (envName: string) => string> = {
  powershell: (n) => `$env:${n}`,
  cmd: (n) => `!${n}!`,
  bash: (n) => `\${${n}}`,
}
const TEMPLATE = /\{\{\s*([^{}]+?)\s*\}\}/g

/**
 * A shell block's {{ values }}: each becomes a reference to a variable of the shell (QA_T1, QA_T2… — one per distinct
 * path), its value given apart as that variable — a value never becomes the script's code, and the approved script is
 * the one that runs. A path with no value stays as written and is said.
 */
export function shellTemplate(kind: ShellKind, body: string, resolve: (path: string) => { ok: boolean; value?: unknown }): { script: string; vars: Record<string, string>; missing: string[] } {
  const vars: Record<string, string> = {}
  const byPath = new Map<string, string>()
  const missing: string[] = []
  const script = body.replace(TEMPLATE, (all, path: string) => {
    const known = byPath.get(path)
    if (known) return REFER[kind](known)
    const r = resolve(path)
    if (!r.ok) {
      if (!missing.includes(path)) missing.push(path)
      return all
    }
    const name = `QA_T${byPath.size + 1}`
    byPath.set(path, name)
    vars[name] = asText(r.value)
    return REFER[kind](name)
  })
  return { script, vars, missing }
}

/** A value larger than this cannot be an environment variable (Windows' limit is 32767 characters). */
export const ENV_VALUE_MAX = 32_000
/**
 * The variables a script gets: the note's values it names (QA_<name> — only those: a token elsewhere in the note is
 * not handed to every script) and its {{ }} ones. A value too large for a variable — the reason it cannot run.
 */
export function scriptEnv(script: string, ctx: Record<string, unknown>, templateVars: Record<string, string>): { env: Record<string, string> } | { error: string } {
  const env: Record<string, string> = {}
  for (const [name, v] of Object.entries(ctx)) if (VAR_NAME.test(name) && new RegExp(`QA_${name}(?![\\w])`).test(script)) env[`QA_${name}`] = asText(v)
  Object.assign(env, templateVars)
  const big = Object.entries(env).find(([, v]) => v.length > ENV_VALUE_MAX)
  return big ? { error: `Значение ${big[0]} слишком большое для переменной оболочки (${big[1].length} символов, можно до ${ENV_VALUE_MAX}) — передайте его файлом` } : { env }
}

/** A text as UTF-16LE in base64 (what PowerShell's -EncodedCommand takes). */
function utf16Base64(s: string): string {
  let bin = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    bin += String.fromCharCode(c & 0xff, c >> 8)
  }
  return btoa(bin)
}
const encodedPs = (script: string) => utf16Base64(UTF8_PRELUDE + script)

/**
 * A local start: the program, its arguments; the script on stdin (bash) or in a temporary file (cmd, PowerShell — the
 * worker writes it in its own temp folder and adds its path as the last argument).
 */
export interface LocalLaunch {
  file: string
  args: string[]
  stdin?: string
  /** `posixPath` — its path given with forward slashes (bash). */
  tempFile?: { name: string; text: string; posixPath?: boolean }
}
/** Where the shells are on this PC (found by main): PowerShell 7, bash (Git Bash / WSL). */
export interface ShellTools {
  pwsh?: string
  bash?: string
}
const LOCAL: Record<ShellKind, (script: string, t: ShellTools) => LocalLaunch> = {
  // (a .ps1 run by -File: its errors come as text — with -EncodedCommand Windows PowerShell writes them as CLIXML;
  // UTF-8 with a BOM: without it Windows PowerShell reads the file in the ANSI code page)
  powershell: (s, t) => ({ file: t.pwsh ?? 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'], tempFile: { name: 'block.ps1', text: `${BOM}${UTF8_PRELUDE}\r\n${s}` } }),
  // (!QA_T…! — its {{ }} values — need delayed expansion; turned on only then: it eats a plain «!» of the script)
  cmd: (s) => ({ file: 'cmd.exe', args: ['/d', '/s', '/c'], tempFile: { name: 'block.cmd', text: `@echo off\r\nchcp 65001>nul\r\n${/!QA_T\d+!/.test(s) ? 'setlocal EnableDelayedExpansion\r\n' : ''}${s}` } }),
  bash: (s, t) => {
    if (!t.bash) throw new Error('bash не найден: установите Git Bash или WSL')
    // (a file, not stdin: a command of the script that reads stdin would eat the script's rest)
    return { file: t.bash, args: [], tempFile: { name: 'block.sh', text: s, posixPath: true } }
  },
}
export const launchLocal = (kind: ShellKind, script: string, tools: ShellTools): LocalLaunch => LOCAL[kind](script, tools)

/** A server start: the command line run there; the script on stdin when the shell reads it so. */
export interface RemoteLaunch {
  command: string
  stdin?: string
}
/** The first line a server's bash writes to stderr: its process id (to stop its whole tree), taken out of the output. */
export const PID_MARK = '__QAPID:'
const bashQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
const psQuote = (s: string) => `'${s.replace(/['‘’‚‛]/g, (q) => q + q)}'`
const REMOTE: Record<ShellKind, (script: string, cwd?: string) => RemoteLaunch> = {
  // the script read whole as a function before it runs, its stdin cut off (a command reading stdin cannot eat the
  // script); its folder entered first (not there — it stops, never runs elsewhere)
  bash: (s, cwd) => ({ command: 'bash -s', stdin: `echo "${PID_MARK}$$" >&2\n__qa() {\n${s}\n}\n${cwd ? `cd -- ${bashQuote(cwd)} || exit 1\n` : ''}__qa </dev/null\n` }),
  powershell: (s, cwd) => ({ command: `powershell -NoProfile -NonInteractive -EncodedCommand ${encodedPs(`${cwd ? `Set-Location -LiteralPath ${psQuote(cwd)} -ErrorAction Stop;` : ''}${s}`)}` }),
  cmd: () => {
    throw new Error('cmd по SSH не поддерживается: многострочный скрипт и кавычки не передать надёжно — используйте PowerShell')
  },
}
export const launchRemote = (kind: ShellKind, script: string, cwd?: string): RemoteLaunch => REMOTE[kind](script, cwd)

/** A server's bash process id from the start of its stderr (the mark's line taken out); none there — as it is. */
export function takePidMark(stderr: string): { pid?: number; rest: string } {
  const m = new RegExp(`^${PID_MARK}(\\d+)\\r?\\n`).exec(stderr)
  return m ? { pid: Number(m[1]), rest: stderr.slice(m[0].length) } : { rest: stderr }
}
/**
 * The command that stops a server process and everything under it: the whole tree's ids gathered first (a child whose
 * parent died goes to init — it would not be found later), then TERM to all, a second later KILL to the rest.
 */
export const remoteKillTree = (pid: number) => `kt(){ echo "$1"; for c in $(pgrep -P "$1" 2>/dev/null); do kt "$c"; done; }; p=$(kt ${pid}); kill -TERM $p 2>/dev/null; sleep 1; kill -KILL $p 2>/dev/null; true`

/**
 * Windows PowerShell's stderr as text: run by -EncodedCommand it writes its error stream as CLIXML (`#< CLIXML` and
 * <S S="Error"> lines with _x000D__x000A_ for line ends); anything else comes back as it is.
 */
export function clixmlText(stderr: string): string {
  if (!stderr.startsWith('#< CLIXML')) return stderr
  const decode = (s: string) =>
    s
      .replace(/_x([0-9A-Fa-f]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
  return [...stderr.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map((m) => decode(m[1])).join('')
}

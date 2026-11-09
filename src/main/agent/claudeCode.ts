import { execFile, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeCodeUsage, type TurnUsage } from '../../shared/agent/usage'
import { CLAUDE_MISSING, commandOf, findClaude, viaShell } from './claudePath'
import { claudeFlags, type ClaudeFlag } from './claudeFlags'

/**
 * An agent's turn by Claude Code (`claude -p`): the person's own Claude Code (its sign-in, its model), our tools over
 * the app's MCP server with the turn's token only, a project's folder to read when given. No window, no session kept.
 * Only the tools it may use are given to it: Claude Code's own (shell, edits, web, sub-agents…) would be sent with
 * every step of the model — several times our tools' size — and are never allowed to it here.
 */
export interface ClaudeTurn {
  system: string
  prompt: string
  model?: string
  /** A folder it may read (its own Read / Grep / Glob). */
  project?: string
  /** The app's MCP server for this turn. */
  mcp: { url: string; token: string }
  signal: AbortSignal
}

/** What a turn gave: the answer, what it cost (an older Claude Code — not said). */
export interface ClaudeTurnOut {
  text: string
  usage?: TurnUsage
}

const TURN_MS = 20 * 60_000
/** Claude Code's own tools a turn may use: reading the project's folder (none without one). */
const PROJECT_TOOLS = ['Read', 'Grep', 'Glob']
/** A Windows argument for the shell (cmd): quoted when it has spaces or quotes; an empty one — kept as "". */
export const shellArg = (s: string) => (s === '' ? '""' : /[\s"&|<>^]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s)

/** The command line of a turn: the options this Claude Code takes (`flags`) — the others left out. */
export function claudeArgs(t: Pick<ClaudeTurn, 'project' | 'model'> & { mcpFile: string; systemFile: string }, flags: ReadonlySet<ClaudeFlag>): string[] {
  const own = t.project ? PROJECT_TOOLS : []
  return [
    '-p',
    '--output-format',
    'json',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--mcp-config',
    t.mcpFile,
    '--append-system-prompt-file',
    t.systemFile,
    // only these of its own tools are sent to the model (our MCP tools are given besides, whole — no tool search)
    ...(flags.has('--tools') ? ['--tools', own.join(',')] : []),
    // (the turn's folder and the like said in the first message: the system prompt stays the same, cached between turns)
    ...(flags.has('--exclude-dynamic-system-prompt-sections') ? ['--exclude-dynamic-system-prompt-sections'] : []),
    '--allowedTools',
    'mcp__qvarch',
    ...own,
    ...(t.project ? ['--add-dir', t.project] : []),
    ...(t.model ? ['--model', t.model] : []),
  ]
}

export async function claudeCodeTurn(t: ClaudeTurn): Promise<ClaudeTurnOut> {
  const bin = await findClaude()
  if (!bin) throw new Error(CLAUDE_MISSING)
  const flags = await claudeFlags(bin)
  const dir = mkdtempSync(join(tmpdir(), 'qa-agent-'))
  const mcpFile = join(dir, 'mcp.json')
  const systemFile = join(dir, 'system.md')
  writeFileSync(mcpFile, JSON.stringify({ mcpServers: { qvarch: { type: 'http', url: t.mcp.url, headers: { Authorization: `Bearer ${t.mcp.token}` } } } }))
  writeFileSync(systemFile, t.system)
  const args = claudeArgs({ project: t.project, model: t.model, mcpFile, systemFile }, flags)
  return new Promise<ClaudeTurnOut>((ok, fail) => {
    // stopped before it started: nothing is run (an 'abort' already gone would never reach the listener)
    if (t.signal.aborted) {
      rmSync(dir, { recursive: true, force: true })
      return fail(new Error('Остановлено'))
    }
    const shell = viaShell(bin)
    const p = spawn(commandOf(bin), shell ? args.map(shellArg) : args, { shell, windowsHide: true, cwd: t.project || dir, env: bin.env })
    let out = ''
    let err = ''
    const done = (e?: Error, got?: ClaudeTurnOut) => {
      clearTimeout(timer)
      t.signal.removeEventListener('abort', stop)
      rmSync(dir, { recursive: true, force: true })
      if (e) fail(e)
      else ok(got ?? { text: '' })
    }
    const stop = () => killTree(p.pid)
    let timedOut = false
    const timer = setTimeout(() => ((timedOut = true), stop()), TURN_MS)
    t.signal.addEventListener('abort', stop)
    p.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')))
    p.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')))
    // (it went away since it was found: looked for anew next time)
    p.on('error', (e) => (void findClaude(true), done(new Error(e.message))))
    p.on('close', (code) => {
      if (t.signal.aborted) return done(new Error('Остановлено'))
      if (timedOut) return done(new Error(`Claude Code не ответил за ${Math.round(TURN_MS / 60_000)} мин — ход остановлен`))
      const r = lastJson(out)
      if (r && typeof r.result === 'string') {
        if (r.is_error) return done(new Error(r.result || 'Claude Code: ошибка'))
        const usage = claudeCodeUsage(r)
        return done(undefined, { text: r.result, ...(usage ? { usage } : {}) })
      }
      done(new Error((err.trim() || out.trim() || `Claude Code завершился с кодом ${code}`).slice(0, 600)))
    })
    p.stdin.end(t.prompt, 'utf8')
  })
}

/** The result line of `--output-format json` (the last JSON object printed). */
function lastJson(out: string): { result?: unknown; is_error?: boolean } | undefined {
  for (const line of out.trim().split('\n').reverse())
    try {
      return JSON.parse(line) as { result?: unknown; is_error?: boolean }
    } catch {
      // not this one
    }
  return undefined
}
/** The process and its children ended (the shell runs claude as a child). */
function killTree(pid?: number): void {
  if (!pid) return
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined)
  else
    try {
      process.kill(-pid)
    } catch {
      // gone
    }
}

/** Claude Code as found here: where, its version (not found / not starting — an error that says so). */
export async function claudeVersion(): Promise<{ file: string; version: string }> {
  const bin = await findClaude(true)
  if (!bin) throw new Error(CLAUDE_MISSING)
  return new Promise((ok, fail) =>
    execFile(commandOf(bin), ['--version'], { shell: viaShell(bin), windowsHide: true, timeout: 30_000, env: bin.env }, (e, out) =>
      e ? fail(new Error(`Claude Code найден (${bin.file}), но не запускается: ${e.message.slice(0, 300)}`)) : ok({ file: bin.file, version: String(out).trim() }),
    ),
  )
}

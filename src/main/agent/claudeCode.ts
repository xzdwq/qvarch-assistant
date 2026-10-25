import { execFile, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLAUDE_MISSING, commandOf, findClaude, viaShell } from './claudePath'

/**
 * An agent's turn by Claude Code (`claude -p`): the person's own Claude Code (its sign-in, its model), our tools over
 * the app's MCP server with the turn's token only, a project's folder to read when given. No window, no session kept.
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

const TURN_MS = 20 * 60_000
/** A Windows argument for the shell (cmd): quoted when it has spaces or quotes. */
const arg = (s: string) => (/[\s"&|<>^]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s)

export async function claudeCodeTurn(t: ClaudeTurn): Promise<string> {
  const bin = await findClaude()
  if (!bin) throw new Error(CLAUDE_MISSING)
  const dir = mkdtempSync(join(tmpdir(), 'qa-agent-'))
  const mcpFile = join(dir, 'mcp.json')
  const systemFile = join(dir, 'system.md')
  writeFileSync(mcpFile, JSON.stringify({ mcpServers: { qvarch: { type: 'http', url: t.mcp.url, headers: { Authorization: `Bearer ${t.mcp.token}` } } } }))
  writeFileSync(systemFile, t.system)
  const allowed = ['mcp__qvarch', ...(t.project ? ['Read', 'Grep', 'Glob'] : [])]
  const args = [
    '-p',
    '--output-format',
    'json',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--mcp-config',
    mcpFile,
    '--append-system-prompt-file',
    systemFile,
    '--allowedTools',
    ...allowed,
    ...(t.project ? ['--add-dir', t.project] : []),
    ...(t.model ? ['--model', t.model] : []),
  ]
  return new Promise<string>((ok, fail) => {
    const shell = viaShell(bin)
    const p = spawn(commandOf(bin), shell ? args.map(arg) : args, { shell, windowsHide: true, cwd: t.project || dir, env: bin.env })
    let out = ''
    let err = ''
    const done = (e?: Error, text?: string) => {
      clearTimeout(timer)
      t.signal.removeEventListener('abort', stop)
      rmSync(dir, { recursive: true, force: true })
      if (e) fail(e)
      else ok(text ?? '')
    }
    const stop = () => killTree(p.pid)
    const timer = setTimeout(stop, TURN_MS)
    t.signal.addEventListener('abort', stop)
    p.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')))
    p.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')))
    // (it went away since it was found: looked for anew next time)
    p.on('error', (e) => (void findClaude(true), done(new Error(e.message))))
    p.on('close', (code) => {
      if (t.signal.aborted) return done(new Error('Остановлено'))
      const r = lastJson(out)
      if (r && typeof r.result === 'string') return r.is_error ? done(new Error(r.result || 'Claude Code: ошибка')) : done(undefined, r.result)
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

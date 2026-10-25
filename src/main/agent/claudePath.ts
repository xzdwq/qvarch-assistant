import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Where Claude Code is on this computer. The app is started from the desktop, not from a terminal: the PATH a version
 * manager sets in a terminal (fnm, nvm) is not its PATH — so besides the PATH the usual places are looked through: the
 * native installer, npm's global folder, every Node of fnm / nvm, Volta. Found once, looked for again after a failure.
 */
export interface ClaudeBin {
  /** Its full path (.exe — run as is; .cmd — through the shell). */
  file: string
  /** The PATH to run it with: its own folder first (an npm shim there finds its node.exe next to it). */
  env: NodeJS.ProcessEnv
}

const env = process.env
const NAMES = process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude']
/** A folder's Claude (none — not there). */
const inDir = (dir: string | undefined): string | undefined => (dir ? NAMES.map((n) => join(dir, n)).find((f) => existsSync(f)) : undefined)
/** The sub-folders of a version manager's folder, newest version first (v22.20.0 before v20.3.0). */
function versions(dir: string | undefined): string[] {
  if (!dir || !existsSync(dir)) return []
  const num = (v: string) => v.replace(/^v/, '').split('.').map((x) => Number(x) || 0)
  return readdirSync(dir)
    .filter((v) => /^v?\d/.test(v))
    .sort((a, b) => {
      const [x, y] = [num(a), num(b)]
      for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]
      return 0
    })
    .map((v) => join(dir, v))
}
/** The places looked through after the PATH, in order. */
function candidates(): Array<string | undefined> {
  const home = env.USERPROFILE ?? env.HOME
  const appData = env.APPDATA
  const local = env.LOCALAPPDATA
  const fnm = env.FNM_DIR ?? (appData && join(appData, 'fnm'))
  const nvm = env.NVM_HOME ?? (appData && join(appData, 'nvm'))
  return [
    home && join(home, '.local', 'bin'),
    appData && join(appData, 'npm'),
    fnm && join(fnm, 'aliases', 'default'),
    ...versions(fnm && join(fnm, 'node-versions')).map((v) => join(v, 'installation')),
    env.NVM_SYMLINK,
    ...versions(nvm),
    local && join(local, 'Volta', 'bin'),
    env.ProgramFiles && join(env.ProgramFiles, 'nodejs'),
  ]
}
/** The PATH's own Claude (`where` / `which`), none — not on it. */
function onPath(): Promise<string | undefined> {
  return new Promise((ok) =>
    execFile(process.platform === 'win32' ? 'where' : 'which', ['claude'], { windowsHide: true, timeout: 10_000 }, (e, out) => {
      const lines = e ? [] : String(out).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      // (on Windows the extension-less one is a script for other shells: .exe / .cmd only)
      ok(lines.find((l) => process.platform !== 'win32' || /\.(exe|cmd)$/i.test(l)))
    }),
  )
}

let found: ClaudeBin | undefined
export async function findClaude(again = false): Promise<ClaudeBin | undefined> {
  if (found && !again && existsSync(found.file)) return found
  const file = (await onPath()) ?? candidates().map(inDir).find(Boolean)
  if (!file) return (found = undefined)
  const sep = process.platform === 'win32' ? ';' : ':'
  // (Windows keeps it as «Path»: a copy with «PATH» beside it would give the child two)
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  found = { file, env: { ...env, [key]: `${dirname(file)}${sep}${env[key] ?? ''}` } }
  return found
}
/** How it is run: an .exe — itself; a .cmd — by the shell (Node refuses to start it otherwise), its path quoted. */
export const viaShell = (bin: ClaudeBin): boolean => /\.cmd$/i.test(bin.file)
export const commandOf = (bin: ClaudeBin): string => (viaShell(bin) ? `"${bin.file}"` : bin.file)

export const CLAUDE_MISSING = 'Claude Code не найден: ни в PATH, ни в обычных местах установки (установщик Claude, npm, fnm, nvm, Volta). Установите его (npm i -g @anthropic-ai/claude-code) и войдите: claude в терминале'

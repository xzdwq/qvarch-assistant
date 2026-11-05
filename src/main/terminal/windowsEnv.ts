import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshEnv, parseRegExport, type RegVar } from '../../shared/terminalEnv'

/** Where Windows keeps the variables: the system's, the user's. */
const MACHINE_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
const USER_KEY = 'HKCU\\Environment'
const READ_MS = 5000

/**
 * The registry's variables read now (`reg export` — UTF-16, whatever the names and paths are written in): none when
 * it cannot be read (the app's own environment is used then).
 */
async function readKey(dir: string, key: string, file: string): Promise<Map<string, RegVar>> {
  const out = join(dir, file)
  await new Promise<void>((done, fail) => execFile('reg.exe', ['export', key, out, '/y'], { windowsHide: true, timeout: READ_MS }, (e) => (e ? fail(e) : done())))
  return parseRegExport((await readFile(out)).toString('utf16le'))
}

/** A new shell's environment: the app's own with the system's and the user's variables as they are now (Windows Terminal's way). */
export async function windowsShellEnv(base: Record<string, string>): Promise<Record<string, string>> {
  if (process.platform !== 'win32') return base
  const dir = await mkdtemp(join(tmpdir(), 'qv-env-'))
  try {
    const [machine, user] = await Promise.all([readKey(dir, MACHINE_KEY, 'm.reg'), readKey(dir, USER_KEY, 'u.reg')])
    return freshEnv(base, machine, user)
  } catch {
    return freshEnv(base, new Map(), new Map())
  } finally {
    void rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

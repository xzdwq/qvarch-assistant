import { cleanStderr, scriptCommand, sudoOutcome, type RunAs } from '../../shared/ssh/sudo'
import { SSH_NEEDS_SUDO } from '../../shared/ssh/api'
import type { SshSessionStore } from './sessionStore'
import type { SshConnections } from './sshConnections'

/** A script's run: its exit code, output (bytes) and errors. */
export interface ScriptResult {
  code: number | null
  stdout: Buffer
  stderr: string
}

/** A script runs at most this long (sudo checking a domain password may be slow). */
const RUN_MS = 60_000
/** Output kept at most (a file read for the editor fits). */
const OUT_MAX = 6 * 1024 * 1024

/**
 * Fixed scripts run on a server with their arguments — as the signed-in user or as root (sudo). sudo's password is
 * kept in memory per session (never on disk) until its connection ends; none — tried with `-n` (no failed sign-in
 * counted), refused with SSH_NEEDS_SUDO for the window to ask; one that did not fit — forgotten and asked again.
 */
export class SudoRunner {
  private readonly passwords = new Map<string, string>()

  constructor(
    private readonly connections: SshConnections,
    private readonly store: SshSessionStore,
  ) {}

  /** The password given (or the session's kept SSH one) remembered for its next sudo runs. */
  remember(id: string, password: string | undefined, useSsh: boolean): void {
    const p = useSsh ? this.store.password(id) : password
    if (p) this.passwords.set(id, p)
    else this.passwords.delete(id)
  }
  forget(id: string): void {
    this.passwords.delete(id)
  }

  /** A script run as the signed-in user: its result (a failure to start — thrown). */
  self(id: string, script: string, args: string[]): Promise<ScriptResult> {
    return this.exec(id, scriptCommand(script, args, 'self'))
  }

  /** A script run as root: its result once sudo let it run; else thrown (needs a password / it did not fit / refused). */
  async sudo(id: string, script: string, args: string[]): Promise<ScriptResult> {
    const password = this.passwords.get(id)
    const as: RunAs = password ? 'sudoPassword' : 'sudoNoPassword'
    const r = await this.exec(id, scriptCommand(script, args, as), password)
    const o = sudoOutcome(r.stderr)
    switch (o.kind) {
      case 'ran':
        return r
      case 'needsPassword':
        throw new Error(`${SSH_NEEDS_SUDO}: сервер просит пароль для sudo`)
      case 'wrongPassword':
        this.passwords.delete(id)
        throw new Error(`${SSH_NEEDS_SUDO}: пароль не подошёл`)
      case 'refused':
        throw new Error(`sudo: ${o.message}`)
    }
  }

  private async exec(id: string, command: string, stdin?: string): Promise<ScriptResult> {
    const ch = await this.connections.exec(id, command)
    return new Promise((done, fail) => {
      const out: Buffer[] = []
      let size = 0
      let stderr = ''
      let code: number | null = null
      const timer = setTimeout(() => {
        ch.close()
        fail(new Error('Сервер не ответил вовремя'))
      }, RUN_MS)
      ch.on('data', (d: Buffer) => {
        if (size >= OUT_MAX) return
        out.push(d)
        size += d.length
      })
      ch.stderr.on('data', (d: Buffer) => stderr.length < 64 * 1024 && (stderr += d.toString('utf8')))
      ch.on('exit', (c: number | null) => (code = c))
      ch.on('close', () => {
        clearTimeout(timer)
        done({ code, stdout: Buffer.concat(out), stderr })
      })
      // only sudo's password goes in; nothing else ever reads it
      ch.end(stdin === undefined ? undefined : `${stdin}\n`)
    })
  }
}

/** A failed run's errors in plain words (`what` — what was done). */
export const runError = (r: ScriptResult, what: string) => new Error(`${what}: ${cleanStderr(r.stderr) || `код выхода ${r.code ?? '—'}`}`)

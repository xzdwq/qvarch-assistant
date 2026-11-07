import { StringDecoder } from 'node:string_decoder'
import type { IPty } from '@lydell/node-pty'
import type { ClientChannel } from 'ssh2'

/**
 * What a terminal tab runs, whatever it is: a local shell in a pseudo-console or a shell on an SSH server. The tab
 * only types into it, tells its size, stops it and hears its output and its end.
 */
export interface TermProcess {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(cb: (data: string) => void): void
  /** Its end: the exit code (-1 — it never started; a lost connection — what the server said, else 0). */
  onExit(cb: (code: number) => void): void
}

/** A local shell's pseudo-console as a tab's process. */
export function ptyProcess(p: IPty): TermProcess {
  return {
    write: (d) => p.write(d),
    resize: (c, r) => p.resize(c, r),
    kill: () => p.kill(),
    onData: (cb) => void p.onData(cb),
    onExit: (cb) => void p.onExit(({ exitCode }) => cb(exitCode)),
  }
}

/**
 * An SSH server's shell channel as a tab's process: its bytes read as UTF-8 (a letter split between two chunks waits
 * for its rest), stderr into the same stream as a terminal shows it; `release` — the connection let go when it ends.
 */
export function sshProcess(ch: ClientChannel, release: () => void): TermProcess {
  const out = new StringDecoder('utf8')
  const err = new StringDecoder('utf8')
  let code = 0
  let ended = false
  const exits: Array<(code: number) => void> = []
  ch.on('exit', (c: number | null) => (code = typeof c === 'number' ? c : 0))
  ch.on('close', () => {
    if (ended) return
    ended = true
    release()
    for (const cb of exits) cb(code)
  })
  return {
    write: (d) => void ch.write(d),
    resize: (c, r) => void ch.setWindow(r, c, 0, 0),
    kill: () => ch.close(),
    onData: (cb) => {
      ch.on('data', (b: Buffer) => cb(out.write(b)))
      ch.stderr.on('data', (b: Buffer) => cb(err.write(b)))
    },
    onExit: (cb) => void exits.push(cb),
  }
}

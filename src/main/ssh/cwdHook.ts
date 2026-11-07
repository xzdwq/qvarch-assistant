import { cwdHookLine, HOOK_MARK } from '../../shared/ssh/remoteShell'
import type { TermProcess } from '../terminal/termProcess'

/** The first prompt is taken as settled after this long without output. */
const SETTLED_MS = 300
/** No output at all this long after sign-in — the hook is typed in anyway. */
const FIRST_OUTPUT_MS = 3000
/** The mark not back this long — the shell is not bash / zsh: what was held is shown, nothing more is tried. */
const MARK_MS = 3000

/**
 * The folder hook typed into a server's fresh shell once its first prompt settled (what came before — the greeting,
 * the prompt — is shown as it is); what the shell prints from then until the hook's mark (the typed line's echo) is
 * held back. The mark come: the prompt line is cleared, what follows the mark is shown. Not come in time: everything
 * held is shown (nothing is lost).
 */
export class CwdHook {
  private state: 'waiting' | 'hiding' | 'done'
  private held = ''
  private timer?: NodeJS.Timeout

  constructor(
    private readonly send: (data: string) => void,
    private readonly show: (data: string) => void,
    enabled: boolean,
  ) {
    this.state = enabled ? 'waiting' : 'done'
    if (enabled) this.timer = setTimeout(() => this.typeIn(), FIRST_OUTPUT_MS)
  }

  feed(d: string): void {
    if (this.state === 'done') return this.show(d)
    if (this.state === 'waiting') {
      this.show(d)
      clearTimeout(this.timer)
      this.timer = setTimeout(() => this.typeIn(), SETTLED_MS)
      return
    }
    this.held += d
    const at = this.held.indexOf(HOOK_MARK)
    if (at < 0) return
    const after = this.held.slice(at + HOOK_MARK.length)
    this.finish()
    // the old prompt's line cleared: the next prompt takes its place (the echo never showed)
    this.show(`\r\x1b[2K${after}`)
  }
  private typeIn(): void {
    if (this.state !== 'waiting') return
    this.state = 'hiding'
    this.send(cwdHookLine())
    this.timer = setTimeout(() => {
      const held = this.held
      this.finish()
      if (held) this.show(held)
    }, MARK_MS)
  }
  private finish(): void {
    clearTimeout(this.timer)
    this.state = 'done'
    this.held = ''
  }
  /** The shell gone: nothing more is typed or held. */
  dispose(): void {
    this.finish()
  }
}

/**
 * A server shell's process with the folder hook in it (`enabled` — the session follows its folder): its output passes
 * through the hook; output that came before the tab listened is kept for it (none is lost between the two).
 */
export function withCwdHook(p: TermProcess, enabled: boolean): TermProcess {
  const listeners: Array<(d: string) => void> = []
  let early: string[] = []
  const hook = new CwdHook(
    (d) => p.write(d),
    (d) => (listeners.length ? listeners.forEach((l) => l(d)) : early.push(d)),
    enabled,
  )
  p.onData((d) => hook.feed(d))
  p.onExit(() => hook.dispose())
  return {
    write: (d) => p.write(d),
    resize: (c, r) => p.resize(c, r),
    kill: () => p.kill(),
    onExit: (cb) => p.onExit(cb),
    onData: (cb) => {
      listeners.push(cb)
      const was = early
      early = []
      was.forEach(cb)
    },
  }
}

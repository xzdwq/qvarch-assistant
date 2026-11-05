/**
 * A file written a moment after the last change (many changes — one write). Every write still waiting is done when
 * the app quits (`flushLaterWrites`): nothing of the last seconds is lost, whatever service it belongs to.
 */
const waiting = new Set<LaterWrite>()

export class LaterWrite {
  private timer?: ReturnType<typeof setTimeout>

  constructor(
    private readonly write: () => void,
    private readonly ms: number,
  ) {}

  /** Changed: written once no change came for `ms`. */
  soon(): void {
    clearTimeout(this.timer)
    waiting.add(this)
    this.timer = setTimeout(() => this.now(), this.ms)
  }
  /** Written now, if a change waits (a refusal of the disk is logged: the next change writes again). */
  now(): void {
    if (!waiting.delete(this)) return
    clearTimeout(this.timer)
    try {
      this.write()
    } catch (e) {
      console.error('[save] a file could not be written', e)
    }
  }
}

/** Everything still waiting written (the app quits). */
export function flushLaterWrites(): void {
  for (const w of [...waiting]) w.now()
}

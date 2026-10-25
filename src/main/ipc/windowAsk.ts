import { randomUUID } from 'node:crypto'

/**
 * Asking a window to do something (the notes, the chats live there) and waiting for its answer: the ask goes as an
 * event with its id, the window answers by that id (`settle`); no window — refused; no answer in time — failed.
 */
export class WindowAsk {
  private readonly pending = new Map<string, { ok: (v: unknown) => void; fail: (e: Error) => void; timer: NodeJS.Timeout }>()
  /** `send` — the ask sent to the window (false — no window to ask). */
  constructor(
    private readonly send: (id: string, op: string, args: Record<string, unknown>) => boolean,
    private readonly closed: string,
  ) {}

  ask<T>(op: string, args: Record<string, unknown>, timeoutMs = 60_000): Promise<T> {
    return new Promise<T>((ok, fail) => {
      const id = randomUUID()
      const timer = setTimeout(() => (this.pending.delete(id), fail(new Error('Окно Qvarch не ответило'))), timeoutMs)
      this.pending.set(id, { ok: ok as (v: unknown) => void, fail, timer })
      if (!this.send(id, op, args)) {
        clearTimeout(timer)
        this.pending.delete(id)
        fail(new Error(this.closed))
      }
    })
  }
  /** The window's answer. */
  settle(id: string, ok: boolean, value: unknown): void {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    clearTimeout(p.timer)
    if (ok) p.ok(value)
    else p.fail(new Error(String(value)))
  }
}

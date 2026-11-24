import type { WebContents } from 'electron'
import { browserId } from '../../../shared/browser'
import type { InspectCommand } from '../../../shared/browser/inspect/pageCommands'
import { toPage } from '../../ipc/browserPageIpc'

/** A page that does not answer in this time is taken as having nothing to say, ms. */
const ANSWER_MS = 1500

/** Commands to the inspector in a page (its preload) and their answers, matched by id; none in time — null. */
export class PageAsk {
  private waiting = new Map<string, { wc: WebContents; done: (v: unknown) => void; timer: NodeJS.Timeout }>()

  ask<T>(wc: WebContents, cmd: InspectCommand): Promise<T | null> {
    const id = browserId()
    return new Promise((done) => {
      const timer = setTimeout(() => this.settle(id, null), ANSWER_MS)
      this.waiting.set(id, { wc, done: done as (v: unknown) => void, timer })
      toPage(wc, 'inspectCmd', id, cmd)
    })
  }
  /** A page's answer (only the page asked may answer its question). */
  reply(from: WebContents, id: unknown, answer: unknown): void {
    const w = this.waiting.get(String(id))
    if (w && w.wc === from) this.settle(String(id), answer)
  }
  private settle(id: string, answer: unknown): void {
    const w = this.waiting.get(id)
    if (!w) return
    this.waiting.delete(id)
    clearTimeout(w.timer)
    w.done(answer ?? null)
  }
}

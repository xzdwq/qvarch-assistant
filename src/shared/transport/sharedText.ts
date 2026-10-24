import * as Y from 'yjs'
import { splicesOf } from '../textSplice'

/** Where an update comes from: the server (someone else's edit), this computer's kept state, this person's change. */
export type UpdateOrigin = 'remote' | 'load' | 'local'

/** An update with nothing in it (Yjs writes an empty one as two zero bytes). */
export const isEmptyUpdate = (u: Uint8Array): boolean => u.length <= 2

export const toB64 = (u: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
export const fromB64 = (b: string): Uint8Array => Uint8Array.from(atob(b), (c) => c.charCodeAt(0))
export const mergeUpdates = (us: Uint8Array[]): Uint8Array => Y.mergeUpdates(us)

/**
 * A shared file as a Yjs document: the file's text in, the file's text out. A change of the file goes in as the
 * smallest change of the document (a note — the middle of its text, a board — its items), so concurrent changes of
 * different places merge. Each kind of file — its own model (sharedFormats.ts).
 */
export abstract class SharedModel {
  readonly y = new Y.Doc()

  /** The file's text as the document holds it now. */
  abstract get value(): string
  /** The file's text now: the difference applied as this person's change (false — nothing differed). */
  abstract setLocal(next: string): boolean

  apply(update: Uint8Array, origin: Exclude<UpdateOrigin, 'local'>): void {
    Y.applyUpdate(this.y, update, origin)
  }
  /** The whole state (to keep, or a document's first state). */
  state(): Uint8Array {
    return Y.encodeStateAsUpdate(this.y)
  }
  stateVector(): Uint8Array {
    return Y.encodeStateVector(this.y)
  }
  /** What the other side (its state vector) lacks. */
  missingFor(sv: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.y, sv)
  }
  /** Each update made: its bytes and where it came from. */
  onUpdate(fn: (u: Uint8Array, origin: UpdateOrigin) => void): void {
    this.y.on('update', (u: Uint8Array, origin: unknown) => fn(u, origin as UpdateOrigin))
  }
  /** This person's change, as one update. */
  protected local(fn: () => void): void {
    this.y.transact(fn, 'local' satisfies UpdateOrigin)
  }
}

/** A comment's place in a note: its start and end as Yjs relative positions (base64) — they go with the text. */
export interface TextAnchor {
  start: string
  end: string
}

/** A note: its whole text one Y.Text; a change goes in as the smallest middle replace. */
export class SharedText extends SharedModel {
  private readonly text = this.y.getText('text')

  get value(): string {
    return this.text.toString()
  }
  /** A place of the text that follows its edits (by anyone): the start sticks to what follows it, the end to what precedes it. */
  anchor(from: number, to: number): TextAnchor {
    const pos = (i: number, assoc: number) => toB64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(this.text, i, assoc)))
    return { start: pos(from, 0), end: pos(to, -1) }
  }
  /** Where an anchor is now (its text deleted — `gone`, at the place where it was; never met — null). */
  resolve(a: TextAnchor): { from: number; to: number; gone: boolean } | null {
    const at = (b: string) => {
      try {
        return Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(fromB64(b)), this.y)?.index ?? null
      } catch {
        return null
      }
    }
    const from = at(a.start)
    const to = at(a.end)
    if (from === null || to === null) return null
    return { from: Math.min(from, to), to: Math.max(from, to), gone: to <= from }
  }
  setLocal(next: string): boolean {
    const ss = splicesOf(this.value, next)
    if (!ss.length) return false
    // (each place apart, the last first: the text between them is never taken out and put back)
    this.local(() => {
      for (const s of ss) {
        if (s.del) this.text.delete(s.at, s.del)
        if (s.ins) this.text.insert(s.at, s.ins)
      }
    })
    return true
  }
}

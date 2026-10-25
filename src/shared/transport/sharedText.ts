import * as Y from 'yjs'
import { splicesOf } from '../textSplice'
import type { BlockOrigin, TextAnchor } from './places'

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
  /**
   * The state kept on this computer taken back (after a restart), then the file: changed since (outside the app) —
   * its difference is this person's change; the same text the state was kept with — nothing (applying a file a
   * moment newer than an older state would insert its last edit a second time).
   */
  resume(kept: KeptState, fileText: string): void {
    this.apply(fromB64(kept.state), 'load')
    if (kept.text === undefined || kept.text !== fileText) this.setLocal(fileText)
  }
  /** This person's change, as one update. */
  protected local(fn: () => void): void {
    this.y.transact(fn, 'local' satisfies UpdateOrigin)
  }
}
/** A shared document as this computer keeps it: its state (base64) and the file's text it was kept with. */
export interface KeptState {
  state: string
  /** (none — kept before the text was: the file counts as changed) */
  text?: string
}

/** Who makes a change and when (the server's clock, epoch ms). */
export interface EditStamp {
  device: string
  at: number
}
/** (the places' plain data — shared with the server: places.ts) */
export type { BlockOrigin, PeerSel, TextAnchor } from './places'
export { isPeerSel } from './places'

/**
 * A note: its whole text one Y.Text; a change goes in as the smallest middle replace. Beside it — the components'
 * origins: each at its first sign (a place that follows the edits; that sign gone — the origin is gone too).
 */
export class SharedText extends SharedModel {
  private readonly text = this.y.getText('text')
  private readonly origins = this.y.getMap<BlockOrigin & { pos: string }>('origins')

  /** A component put in, its first sign at `at`: marked as someone's, at a time (one change, sent as any). */
  markOrigin(at: number, o: BlockOrigin): void {
    const pos = toB64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(this.text, at, 0)))
    this.local(() => this.origins.set(crypto.randomUUID(), { ...o, pos }))
  }
  /** The components' origins by where each starts now (one whose first sign was deleted — not there). */
  originsNow(): Map<number, BlockOrigin> {
    const out = new Map<number, BlockOrigin>()
    for (const { pos, ...o } of this.origins.values()) {
      const at = this.livePlace(pos)
      if (at !== null) out.set(at, o)
    }
    return out
  }
  /** A place's index now — when the sign it stands at is still there (deleted — null). */
  private livePlace(b64: string): number | null {
    try {
      const rp = Y.decodeRelativePosition(fromB64(b64))
      if (rp.item && Y.getItem(this.y.store, rp.item).deleted) return null
      return Y.createAbsolutePositionFromRelativePosition(rp, this.y)?.index ?? null
    } catch {
      return null
    }
  }

  get value(): string {
    return this.text.toString()
  }
  /**
   * A caret: one place, stuck to the sign before it — text typed right there by someone else goes after it (it never
   * becomes a «selection» of their text, the caret does not jump over it).
   */
  caret(at: number): TextAnchor {
    const p = toB64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(this.text, at, -1)))
    return { start: p, end: p }
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
  /**
   * Who changes it here and when (the server's clock) — each change marks its signs with it (a deletion — the sign
   * after it, the line's end at least): every line knows who changed it last. None — changes unmarked.
   */
  stamp?: () => EditStamp
  setLocal(next: string): boolean {
    const ss = splicesOf(this.value, next)
    if (!ss.length) return false
    const st = this.stamp?.()
    const mark = st && { a: st.device, t: st.at }
    // (each place apart, the last first: the text between them is never taken out and put back)
    this.local(() => {
      for (const s of ss) {
        if (s.del) this.text.delete(s.at, s.del)
        // (unmarked — as plain text: never the mark of the signs around it)
        if (s.ins) this.text.insert(s.at, s.ins, mark ?? {})
        // a deletion alone: the sign that took its place carries the mark (its line was changed)
        else if (mark && this.text.length) this.text.format(Math.min(s.at, this.text.length - 1), 1, mark)
      }
    })
    return true
  }
  /** Who changed each line last (0-based line → device), by the marks of its signs (a line never marked — none). */
  lineAuthors(): Map<number, string> {
    const last = new Map<number, { a: string; t: number }>()
    let line = 0
    for (const part of this.text.toDelta() as Array<{ insert: string; attributes?: { a?: string; t?: number } }>) {
      const at = part.attributes
      for (const ch of part.insert) {
        if (at?.a && typeof at.t === 'number' && at.t >= (last.get(line)?.t ?? -1)) last.set(line, { a: at.a, t: at.t })
        if (ch === '\n') line++
      }
    }
    return new Map([...last].map(([l, v]) => [l, v.a]))
  }
}

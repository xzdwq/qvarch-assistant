import { EditorSelection, StateEffect, StateField } from '@codemirror/state'
import { layer, RectangleMarker, type EditorView, type LayerMarker, type ViewUpdate } from '@codemirror/view'
import type { PeerCursor } from '@nb/workspace/sharedCursors'

/**
 * The other participants' cursors in a shared note: a thin caret of their colour (moving smoothly — one element kept
 * per person), their name over it for a moment after it moves (and on hover), their selection lightly tinted.
 */

/** The colours the cursors take (`--peer-1…`): by the person's device — always the same one for the same person. */
export const PEER_SLOTS = 8
/** A person's colour slot (0…PEER_SLOTS-1) by their device. */
export const peerSlot = (id: string): number => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PEER_SLOTS
/** A person's colour as CSS. */
export const peerColor = (id: string): string => `var(--peer-${peerSlot(id) + 1})`
export const setPeerCursors = StateEffect.define<PeerCursor[]>()
const peersField = StateField.define<PeerCursor[]>({
  create: () => [],
  update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(setPeerCursors) ? e.value : acc), v),
})
const peersChanged = (u: ViewUpdate) => u.docChanged || u.viewportChanged || u.geometryChanged || u.startState.field(peersField) !== u.state.field(peersField)
const clamp = (view: EditorView, pos: number) => Math.max(0, Math.min(pos, view.state.doc.length))

/** One person's caret: where, how tall, whose (the colour slot), when it last moved (its name shows again then). */
class PeerCaret implements LayerMarker {
  constructor(
    readonly left: number,
    readonly top: number,
    readonly height: number,
    readonly name: string,
    readonly slot: number,
    readonly moved: number,
  ) {}
  draw(): HTMLElement {
    const d = document.createElement('div')
    d.className = 'cm-peer-caret'
    const label = document.createElement('span')
    label.className = 'cm-peer-label'
    d.append(label)
    this.adjust(d)
    return d
  }
  update(dom: HTMLElement, prev: PeerCaret): boolean {
    this.adjust(dom, prev)
    return true
  }
  eq(o: LayerMarker): boolean {
    return o instanceof PeerCaret && o.left === this.left && o.top === this.top && o.height === this.height && o.name === this.name && o.slot === this.slot && o.moved === this.moved
  }
  private adjust(d: HTMLElement, prev?: PeerCaret): void {
    d.style.left = `${this.left}px`
    d.style.top = `${this.top}px`
    d.style.height = `${this.height}px`
    d.style.setProperty('--peer', `var(--peer-${this.slot + 1})`)
    const label = d.firstElementChild as HTMLElement
    label.textContent = this.name
    // moved again: its name shows again (the fade starts anew)
    if (prev && prev.moved !== this.moved) {
      label.style.animation = 'none'
      void label.offsetWidth
      label.style.animation = ''
    }
  }
}

const carets = layer({
  above: true,
  class: 'cm-peer-carets',
  update: peersChanged,
  markers: (view) =>
    view.state.field(peersField).flatMap((p) => {
      const at = RectangleMarker.forRange(view, '', EditorSelection.cursor(clamp(view, p.head)))[0]
      return at ? [new PeerCaret(at.left, at.top, at.height, p.name, peerSlot(p.id), p.moved)] : []
    }),
})
const selections = layer({
  above: false,
  class: 'cm-peer-sels',
  update: peersChanged,
  markers: (view) =>
    view.state.field(peersField).flatMap((p) => (p.from < p.to ? RectangleMarker.forRange(view, `cm-peer-sel cm-peer-sel-${peerSlot(p.id) + 1}`, EditorSelection.range(clamp(view, p.from), clamp(view, p.to))) : [])),
})

/** The others' cursors as an extension (fed by `setPeerCursors`). */
export const peerCursors = [peersField, selections, carets]

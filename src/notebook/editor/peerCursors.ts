import { EditorSelection, StateEffect, StateField, type EditorState } from '@codemirror/state'
import { layer, RectangleMarker, type EditorView, type LayerMarker, type ViewUpdate } from '@codemirror/view'
import { PEER_SLOTS, slotOf } from '@shared/transport/peerColors'
import type { PeerCursor } from '@nb/workspace/sharedCursors'

/**
 * The other participants' cursors in a shared note: a thin caret of their colour (moving smoothly — one element kept
 * per person), their name over it for a moment after it moves (and on hover), their selection lightly tinted.
 */

export { PEER_SLOTS }
/** A colour slot as CSS. */
export const peerColor = (slot: number): string => `var(--peer-${slot + 1})`
export const setPeerCursors = StateEffect.define<PeerCursor[]>()
const peersField = StateField.define<PeerCursor[]>({
  create: () => [],
  update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(setPeerCursors) ? e.value : acc), v),
})
/** The note's members' colour slots (`peerSlots`): the cursors and the line marks take theirs from here. */
export const setPeerSlots = StateEffect.define<ReadonlyMap<string, number>>()
export const peerSlotsField = StateField.define<ReadonlyMap<string, number>>({
  create: () => new Map(),
  update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(setPeerSlots) ? e.value : acc), v),
})
/** A person's colour slot in this editor's note. */
export const peerSlotIn = (state: EditorState, id: string): number => slotOf(state.field(peerSlotsField, false) ?? new Map(), id)
const peersChanged = (u: ViewUpdate) =>
  u.docChanged || u.viewportChanged || u.geometryChanged || u.startState.field(peersField) !== u.state.field(peersField) || u.startState.field(peerSlotsField) !== u.state.field(peerSlotsField)
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
      return at ? [new PeerCaret(at.left, at.top, at.height, p.name, peerSlotIn(view.state, p.id), p.moved)] : []
    }),
})
const selections = layer({
  above: false,
  class: 'cm-peer-sels',
  update: peersChanged,
  markers: (view) =>
    view.state.field(peersField).flatMap((p) => (p.from < p.to ? RectangleMarker.forRange(view, `cm-peer-sel cm-peer-sel-${peerSlotIn(view.state, p.id) + 1}`, EditorSelection.range(clamp(view, p.from), clamp(view, p.to))) : [])),
})

/** The others' cursors as an extension (fed by `setPeerCursors`). */
export const peerCursors = [peersField, peerSlotsField, selections, carets]

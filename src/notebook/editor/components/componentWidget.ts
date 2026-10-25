import { createApp, h, reactive, type App } from 'vue'
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { BLOCK_SPECS } from '@nb/blocks/specs'
import type { BlockKind } from '@nb/domain/blockSpec'
import NoteBlockHost from '../../ui/NoteBlockHost.vue'
import { editorHost } from '../editorHost'
import { setLoopBand } from '../loopBands'
import { componentRangesField, type ComponentRange, type Heading } from './componentField'
import type { BlockActionId } from '@nb/commands/blockActions'
import { runBlockAction, targetCaps } from './blockActionRun'
import { blockSel, blockSelection, blockSelField, selectBlock, type BlockSelectHow } from './blockSelection'
import { componentAt, exitComponent, replaceComponent } from './componentOps'
import { dragComponent } from './dragDrop'

/**
 * The note's components drawn in place of their text: each one a Vue app of its own (NoteBlockHost and the kind's
 * view) inside a CodeMirror block widget — its props updated in place while its kind stays, its size followed.
 */

/**
 * A component just put in by «@» (where it starts — followed through the edits, an id given to it in the same change
 * included): its first field takes the focus once it is drawn.
 */
export const focusNewBlock = StateEffect.define<number>({ map: (pos, ch) => ch.mapPos(pos) })
const pendingFocusField = StateField.define<{ pos: number }>({
  create: () => ({ pos: -1 }),
  update: (v, tr) => {
    for (const e of tr.effects) if (e.is(focusNewBlock)) return { pos: e.value }
    return v.pos < 0 || !tr.docChanged ? v : { pos: tr.changes.mapPos(v.pos) }
  },
})

/** The host's props kept by a widget's DOM (updated in place when the text changes / the blocks chosen change). */
type HostState = { kind: BlockKind; src: string; headings: Heading[]; line: number; loop?: string; selected: boolean }
type ComponentDom = HTMLElement & { _qa?: { app: App; props: HostState; ro: ResizeObserver } }

class ComponentWidget extends WidgetType {
  constructor(readonly r: ComponentRange) {
    super()
  }
  eq(o: ComponentWidget): boolean {
    const a = this.r
    const b = o.r
    return a.kind === b.kind && a.src === b.src && a.headings === b.headings && a.line === b.line && a.loop === b.loop && a.band === b.band
  }
  get estimatedHeight(): number {
    return BLOCK_SPECS[this.r.kind].estimateHeight(this.r.src)
  }
  toDOM(view: EditorView): HTMLElement {
    const r = this.r
    const dom = document.createElement('div') as ComponentDom
    dom.className = 'cm-comp'
    setLoopBand(dom, r.band)
    const pending = view.state.field(pendingFocusField)
    const autofocus = pending.pos >= 0 && pending.pos === r.from
    if (autofocus) pending.pos = -1
    const host = view.state.facet(editorHost)
    const hp = reactive({
      kind: r.kind,
      src: r.src,
      headings: r.headings ? (JSON.parse(r.headings) as Heading[]) : [],
      autofocus,
      path: host.notePath(),
      line: r.line,
      loop: r.loop || undefined,
      onChange: (src: string) => replaceComponent(view, dom, src),
      selected: blockSel(view).includes(r.from),
      onSelect: (how: BlockSelectHow) => selectBlock(view, dom, how),
      onAction: (id: Exclude<BlockActionId, 'raw'>) => runBlockAction(view, dom, id),
      targetCaps: () => targetCaps(view, dom),
      onGo: (pos: number) => {
        view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 60 }) })
        view.focus()
      },
      onExit: (dir: 1 | -1) => exitComponent(view, dom, dir),
      onDrag: (e: PointerEvent) => dragComponent(view, dom, e),
      onTranscribe: (rel: string) => host.transcribe(rel),
      onDropAudio: (rel: string) => host.dropAudio(rel),
    })
    const app = createApp({ render: () => h(NoteBlockHost, hp) })
    app.mount(dom)
    // a component grows (a row added, a picture drawn): the editor measures again
    const ro = new ResizeObserver(() => view.requestMeasure())
    ro.observe(dom)
    dom._qa = { app, props: hp, ro }
    return dom
  }
  updateDOM(dom: HTMLElement): boolean {
    const q = (dom as ComponentDom)._qa
    if (!q || q.props.kind !== this.r.kind) return false
    q.props.src = this.r.src
    q.props.headings = this.r.headings ? (JSON.parse(this.r.headings) as Heading[]) : []
    q.props.line = this.r.line
    q.props.loop = this.r.loop || undefined
    setLoopBand(dom, this.r.band)
    return true
  }
  destroy(dom: HTMLElement): void {
    const q = (dom as ComponentDom)._qa
    q?.ro.disconnect()
    q?.app.unmount()
  }
  ignoreEvent(): boolean {
    return true
  }
}

const buildDecorations = (ranges: ComponentRange[]): DecorationSet => Decoration.set(ranges.map((r) => Decoration.replace({ widget: new ComponentWidget(r), block: true }).range(r.from, r.to)))
const componentDecorationsField = StateField.define<DecorationSet>({
  create: (s) => buildDecorations(s.field(componentRangesField)),
  update: (v, tr) => (tr.docChanged ? buildDecorations(tr.state.field(componentRangesField)) : v),
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
})

/** The blocks drawn as chosen while the choice is what it is (their widgets stay — only a prop changes). */
const chosenMarks = ViewPlugin.fromClass(
  class {
    update(u: ViewUpdate): void {
      if (u.startState.field(blockSelField, false) === u.state.field(blockSelField, false) && !u.docChanged) return
      const sel = blockSel(u.view)
      for (const dom of u.view.dom.querySelectorAll<ComponentDom>('.cm-comp')) {
        const q = dom._qa
        if (q) q.props.selected = sel.includes(componentAt(u.view, dom)?.from ?? -1)
      }
    }
  },
)

/** The components as an extension: their ranges, their widgets (atomic for the cursor), the focus of a new one, the ones chosen. */
export const noteComponents = [componentRangesField, componentDecorationsField, pendingFocusField, blockSelection, chosenMarks]

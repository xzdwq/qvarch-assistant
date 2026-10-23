import { createApp, h, type App } from 'vue'
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import BlockRecording from '@renderer/components/blocks/BlockRecording.vue'

/**
 * A voice recording going on: its place in the text (where it will go) shown as the recorder (time, level, «Стоп»),
 * the place following the text's edits.
 */

/** What the recorder shows (reactive: the host updates it while recording). */
export interface RecordingUi {
  sec: number
  level: number
  onStop: () => void
}

/** The recording's place set (a position) or taken away (null). */
const setRecordingPlace = StateEffect.define<number | null>()

class RecordingWidget extends WidgetType {
  constructor(readonly ui: RecordingUi) {
    super()
  }
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const dom = document.createElement('div')
    dom.className = 'cm-comp cm-rec'
    const app = createApp({ render: () => h(BlockRecording, this.ui) })
    app.mount(dom)
    ;(dom as HTMLElement & { _app?: App })._app = app
    return dom
  }
  destroy(dom: HTMLElement): void {
    ;(dom as HTMLElement & { _app?: App })._app?.unmount()
  }
  ignoreEvent(): boolean {
    return true
  }
}

/** The recording marker as an extension, its recorder fed by `ui`. */
export function recordingMarker(ui: RecordingUi) {
  const widget = Decoration.widget({ widget: new RecordingWidget(ui), block: true, side: 1 })
  return StateField.define<number | null>({
    create: () => null,
    update: (v, tr) => {
      for (const e of tr.effects) if (e.is(setRecordingPlace)) return e.value
      return v === null ? null : tr.changes.mapPos(v, 1)
    },
    provide: (f) => EditorView.decorations.from(f, (pos) => (pos === null ? Decoration.none : Decoration.set([widget.range(pos)]))),
  })
}
export type RecordingMarker = ReturnType<typeof recordingMarker>

/** A recording starts: its place is shown under the cursor's line (where the recording will go). */
export function showRecordingPlace(view: EditorView): void {
  view.dispatch({ effects: setRecordingPlace.of(view.state.doc.lineAt(view.state.selection.main.head).to) })
}
/** The recording's place (null — none), the marker taken away. */
export function takeRecordingPlace(view: EditorView, marker: RecordingMarker): number | null {
  const pos = view.state.field(marker)
  view.dispatch({ effects: setRecordingPlace.of(null) })
  return pos
}

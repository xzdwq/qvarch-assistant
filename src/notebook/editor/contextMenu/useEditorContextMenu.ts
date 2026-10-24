import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { EditorView } from '@codemirror/view'
import { canComment, newComment } from '@nb/workspace/noteComments'
import { editorHost } from '../editorHost'
import { selectionLinesAs, selectionToCode, wrapSelection } from '../formatting'

/**
 * The editor's right-click menu: cut / copy / paste / select all, and for a selection — «В событие» and Markdown
 * styles (code, bold, heading, list). Its state for EditorContextMenu (a popover at the click: closed by a press
 * elsewhere, Esc, scrolling), its opening as an editor extension.
 */
export type ContextAction = 'cut' | 'copy' | 'paste' | 'all' | 'event' | 'comment' | 'code' | 'bold' | 'heading' | 'list'

export function useEditorContextMenu(getView: () => EditorView | undefined, toEvent: (text: string, at: { from: number; to: number }) => void) {
  /** Open: where it was asked for, whether there is a selection, whether it may be commented (a shared note). */
  const open = ref<{ x: number; y: number; sel: boolean; comment: boolean }>()

  const opening = EditorView.domEventHandlers({
    contextmenu(e, v) {
      e.preventDefault()
      // a right click outside the selection puts the cursor there (as in any text editor)
      const at = v.posAtCoords({ x: e.clientX, y: e.clientY })
      const r = v.state.selection.main
      if (at != null && (r.empty || at < r.from || at > r.to)) v.dispatch({ selection: { anchor: at } })
      v.focus()
      open.value = { x: e.clientX, y: e.clientY, sel: !v.state.selection.main.empty, comment: canComment(v.state.facet(editorHost).notePath()) }
      return true
    },
  })
  function close(): void {
    open.value = undefined
  }
  // (as a native menu: the window left — gone)
  onMounted(() => window.addEventListener('blur', close))
  onBeforeUnmount(() => window.removeEventListener('blur', close))

  /** An action carried out; the menu closes, the focus goes back to the text. */
  function act(what: ContextAction): void {
    const v = getView()
    close()
    if (!v) return
    const r = v.state.selection.main
    const text = v.state.sliceDoc(r.from, r.to)
    switch (what) {
      case 'copy':
        void navigator.clipboard.writeText(text)
        break
      case 'cut':
        void navigator.clipboard.writeText(text)
        v.dispatch({ changes: { from: r.from, to: r.to }, selection: { anchor: r.from } })
        break
      case 'paste':
        void navigator.clipboard.readText().then((t) => {
          const cur = getView()
          if (!t || !cur) return
          const s = cur.state.selection.main
          cur.dispatch({ changes: { from: s.from, to: s.to, insert: t }, selection: { anchor: s.from + t.length }, scrollIntoView: true })
        })
        break
      case 'all':
        v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } })
        break
      case 'event':
        if (text.trim()) toEvent(text.trim(), { from: r.from, to: r.to })
        return
      case 'comment':
        newComment(v.state.facet(editorHost).notePath(), r.from, r.to)
        return
      case 'bold':
        wrapSelection('**')(v)
        break
      case 'code':
        selectionToCode(v)
        break
      case 'heading':
      case 'list':
        selectionLinesAs(v, what)
        break
    }
    v.focus()
  }

  return {
    /** The menu's state and action for the EditorContextMenu component. */
    menu: reactive({ open, close, act }),
    /** Its opening on a right click — for the editor's extensions. */
    extension: opening,
  }
}
export type EditorContextMenuState = ReturnType<typeof useEditorContextMenu>['menu']

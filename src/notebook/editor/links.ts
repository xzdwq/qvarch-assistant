import { EditorView } from '@codemirror/view'
import { openUrl } from '@renderer/lib/links'
import { editorHost } from './editorHost'
import { WIKI_LINK } from './livePreview'

/** Clicks on what is rendered: a link opens in the browser, [[a note]] opens it; Ctrl+click works on raw text too. */
export const linkClicks = EditorView.domEventHandlers({
  mousedown(e, v) {
    const el = e.target as HTMLElement
    const url = el.closest<HTMLElement>('.cm-lp-link')?.dataset.url
    if (url && e.button !== 2) {
      e.preventDefault()
      openUrl(url, e.button === 1)
      return true
    }
    const host = v.state.facet(editorHost)
    const wiki = el.closest<HTMLElement>('.cm-wiki')?.dataset.wiki
    if (wiki) {
      e.preventDefault()
      host.openWiki(wiki)
      return true
    }
    if (!(e.ctrlKey || e.metaKey)) return false
    const pos = v.posAtCoords({ x: e.clientX, y: e.clientY })
    if (pos == null) return false
    const line = v.state.doc.lineAt(pos)
    WIKI_LINK.lastIndex = 0
    let w: RegExpExecArray | null
    while ((w = WIKI_LINK.exec(line.text))) {
      const a = line.from + w.index
      if (pos >= a && pos <= a + w[0].length) {
        e.preventDefault()
        host.openWiki(w[1].split('|')[0])
        return true
      }
    }
    return false
  },
})

import { EditorView, WidgetType } from '@codemirror/view'
import { imageEmbed } from '@shared/vault'
import { draggedImageUrl, hasImages, imageUrl, takeImages } from '@renderer/lib/notebook'
import { editorHost } from './editorHost'
import { ICON_EXPAND, ICON_TRASH, widgetButton } from './icons'

/** Pictures of a note: drawn in place of their embed line, opened full size, pasted or dropped into the note. */

/** A picture over everything, as big as the window lets it (a click / Esc closes it). */
function showFullSize(src: string): void {
  const back = document.createElement('div')
  back.className = 'qa-lightbox'
  const img = document.createElement('img')
  img.src = src
  img.alt = ''
  back.append(img)
  const close = () => {
    back.remove()
    window.removeEventListener('keydown', onKey, true)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    close()
  }
  back.onclick = close
  window.addEventListener('keydown', onKey, true)
  document.body.append(back)
}
/** The line of a picture removed (and a blank line it leaves doubled). */
function removeLineOf(v: EditorView, text: string): void {
  const d = v.state.doc
  for (let n = 1; n <= d.lines; n++) {
    const l = d.line(n)
    if (l.text.trim() !== text) continue
    let from = l.from
    let to = Math.min(d.length, l.to + 1)
    // no double blank line left behind
    const prevBlank = n > 1 && !d.line(n - 1).text.trim()
    const nextBlank = n < d.lines && !d.line(n + 1).text.trim()
    if (prevBlank && nextBlank) to = Math.min(d.length, d.line(n + 1).to + 1)
    if (n === d.lines && n > 1) from = d.line(n - 1).to
    v.dispatch({ changes: { from, to } })
    return
  }
}

/** A picture of the note: as wide as the note at most (smaller ones — their own size). */
export class ImageWidget extends WidgetType {
  constructor(
    readonly rel: string,
    /** Under its line's raw text (the cursor is on it). */
    readonly under: boolean,
  ) {
    super()
  }
  eq(o: ImageWidget): boolean {
    return o.rel === this.rel && o.under === this.under
  }
  toDOM(v: EditorView): HTMLElement {
    const box = document.createElement('span')
    box.className = this.under ? 'cm-img under' : 'cm-img'
    const img = document.createElement('img')
    img.alt = ''
    img.draggable = false
    img.onload = () => v.requestMeasure()
    img.onclick = () => img.src && showFullSize(img.src)
    void imageUrl(this.rel)
      .then((u) => (img.src = u))
      .catch(() => {
        box.classList.add('missing')
        box.textContent = 'Изображение не найдено'
        box.title = this.rel
      })
    // (inline blocks: a block in a line would get CodeMirror's empty line boxes around it)
    const inner = document.createElement('span')
    inner.className = 'cm-img-in'
    const bar = document.createElement('span')
    bar.className = 'cm-img-bar'
    bar.append(
      widgetButton(ICON_EXPAND, 'Открыть в полный размер', () => img.src && showFullSize(img.src), { isolate: true }),
      widgetButton(ICON_TRASH, 'Убрать изображение из заметки (Ctrl+Z — вернуть)', () => removeLineOf(v, imageEmbed(this.rel)), { isolate: true }),
    )
    inner.append(img, bar)
    box.append(inner)
    return box
  }
  ignoreEvent(): boolean {
    return true
  }
}

/** Pictures put in the note's own lines, at the line of `pos` (after it, when it has text). */
export function insertImages(v: EditorView, rels: string[], pos = v.state.selection.main.head): void {
  if (!rels.length) return
  const line = v.state.doc.lineAt(Math.min(pos, v.state.doc.length))
  const body = rels.map(imageEmbed).join('\n')
  const at = line.length ? line.to : line.from
  const ins = (line.length ? '\n' : '') + body + '\n'
  v.dispatch({ changes: { from: at, insert: ins }, selection: { anchor: at + ins.length }, scrollIntoView: true })
  v.focus()
}

/** A picture pasted (a screenshot, a copied image) or dropped (files, an image from a web page) → the vault → the note. */
export const imagePasteAndDrop = EditorView.domEventHandlers({
  paste(e, v) {
    const dt = e.clipboardData
    // text goes as text (a table copied from Excel carries a picture of itself too)
    if (!dt || dt.getData('text/plain').trim() || !hasImages(dt)) return false
    e.preventDefault()
    const at = v.state.selection.main.head
    const warn = v.state.facet(editorHost).warn
    void takeImages({ files: [...dt.files] }, warn).then((rels) => insertImages(v, rels, at))
    return true
  },
  dragover(e) {
    const t = e.dataTransfer?.types ?? []
    if (!t.includes('Files') && !t.includes('text/html')) return false
    // (text dragged inside the note stays CodeMirror's)
    if (t.includes('Files')) e.preventDefault()
    return false
  },
  drop(e, v) {
    const dt = e.dataTransfer
    const uri = hasImages(dt) ? undefined : draggedImageUrl(dt)
    if (!dt || (!hasImages(dt) && !uri)) return false
    e.preventDefault()
    const pos = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head
    const warn = v.state.facet(editorHost).warn
    void takeImages({ files: [...dt.files], uri }, warn).then((rels) => insertImages(v, rels, pos))
    return true
  },
})

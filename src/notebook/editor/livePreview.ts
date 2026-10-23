import type { Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { AUDIO_EMBED, IMAGE_EMBED } from '@shared/vault'
import { parseNoteLink } from '@shared/noteEvents'
import { fenceLang } from '@renderer/lib/codeblocks'
import { transcribing } from '@renderer/lib/notebook'
import { AudioWidget } from './audio'
import { CodeBarWidget, codeFencesField } from './codeBlocks'
import { componentRanges } from './components/componentField'
import { chipStamp, EventChip } from './eventChips'
import { ImageWidget } from './images'

/**
 * Live preview, like Obsidian's: what is finished reads as the result — headings, bold, links, lists, checkboxes,
 * quotes, code blocks with their bar, pictures and recordings, [[links]], emoji — and the Markdown signs show only
 * where the cursor is. (Components draw themselves; {{ values }} — valueChips.)
 */

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-lp-bullet'
    s.textContent = '•'
    return s
  }
}
/** A task's box: a click turns «[ ]» into «[x]» and back. */
class CheckWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  eq(o: CheckWidget): boolean {
    return o.checked === this.checked
  }
  toDOM(v: EditorView): HTMLElement {
    const c = document.createElement('input')
    c.type = 'checkbox'
    c.className = 'cm-lp-check'
    c.checked = this.checked
    c.onmousedown = (e) => e.preventDefault()
    c.onclick = (e) => {
      e.preventDefault()
      // "[ ]" ↔ "[x]" where the box is now
      const pos = v.posAtDOM(c)
      const cur = v.state.sliceDoc(pos, pos + 3)
      if (/^\[[ xX]\]$/.test(cur)) v.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.checked ? ' ' : 'x' } })
    }
    return c
  }
  ignoreEvent(): boolean {
    return true
  }
}
class RuleWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-lp-hr'
    return s
  }
}
const hide = Decoration.replace({})
const bullet = Decoration.replace({ widget: new BulletWidget() })
const rule = Decoration.replace({ widget: new RuleWidget() })

const EMOJI = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*/gu
const EMOJI_LINE = /^\s*(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*\s*){1,3}$/u
/** A [[link]] to another note ([[name|label]] — the label shown). Global: reset lastIndex before exec loops. */
export const WIKI_LINK = /\[\[([^\]\n]+)\]\]/g

function decorate(v: EditorView): DecorationSet {
  const s = v.state
  const out: Range<Decoration>[] = []
  const focus = v.hasFocus
  const sels = s.selection.ranges
  /** The cursor / selection touches this place (raw Markdown is shown there). */
  const touched = (from: number, to: number) => focus && sels.some((r) => r.from <= to && r.to >= from)
  const lineOf = (pos: number) => s.doc.lineAt(pos)
  const lineActive = (pos: number) => {
    const l = lineOf(pos)
    return touched(l.from, l.to)
  }
  const spaceAfter = (pos: number) => (s.sliceDoc(pos, pos + 1) === ' ' ? pos + 1 : pos)
  const lineDeco = (from: number, to: number, cls: string) => {
    for (let p = from; p <= to; ) {
      const l = lineOf(p)
      out.push(Decoration.line({ class: cls }).range(l.from))
      p = l.to + 1
    }
  }
  /** The parser's code outside our code blocks (an unclosed / indented fence): plain text lines. */
  const plainLines = (from: number, to: number) => {
    for (let p = from; p <= to; ) {
      const l = lineOf(p)
      if (!inCode(l.from)) out.push(Decoration.line({ class: 'cm-lp-plain' }).range(l.from))
      p = l.to + 1
    }
  }

  // code blocks: ``` … ``` (any indent — also inside a list item); Markdown inside them is not rendered
  const blocks = s.field(codeFencesField, false) ?? []
  const inCode = (pos: number) => blocks.some((b) => pos >= b.from && pos <= b.to)
  // the components draw themselves
  const comps = componentRanges(s)
  const inComp = (pos: number) => comps.some((c) => pos >= c.from && pos <= c.to)
  for (const b of blocks) {
    if (inComp(b.from)) continue
    const last = b.close ?? s.doc.lineAt(b.to).number
    const vis = v.visibleRanges.some((r) => r.from <= b.to && r.to >= b.from)
    if (!vis) continue
    const shown = !touched(b.from, b.to)
    for (let no = b.open; no <= last; no++) {
      const l = s.doc.line(no)
      const top = no === b.open
      const bot = no === b.close
      const fence = shown && (top || bot)
      out.push(Decoration.line({ class: `cm-lp-code${top ? ' cm-lp-code-top' : ''}${bot ? ' cm-lp-code-bot' : ''}${fence ? ' cm-lp-fence' : ''}` }).range(l.from))
    }
    if (shown) {
      const code: string[] = []
      for (let no = b.open + 1; no < (b.close ?? last + 1); no++) code.push(s.doc.line(no).text)
      const open = s.doc.line(b.open)
      out.push(Decoration.replace({ widget: new CodeBarWidget(code.join('\n'), fenceLang(open.text.replace(/^\s*(`{3,}|~{3,})/, ''))) }).range(open.from, open.to))
      if (b.close) {
        const cl = s.doc.line(b.close)
        if (cl.length) out.push(hide.range(cl.from, cl.to))
      }
    }
  }

  for (const { from, to } of v.visibleRanges) {
    syntaxTree(s).iterate({
      from,
      to,
      enter: (n) => {
        // a node wholly inside a component (it draws itself); not one that only starts there — the document
        // itself starts at 0, and a component on the first line must not hide everything after it
        if (comps.some((c) => n.from >= c.from && n.to <= c.to)) return false
        // the parser's code (it may run past our block — an indented closing fence): plain text outside our blocks
        if (n.name === 'FencedCode' || n.name === 'CodeBlock') {
          plainLines(n.from, n.to)
          return false
        }
        // (wholly inside a code block — the document itself starts there when a block is on the first line)
        if (blocks.some((b) => n.from >= b.from && n.to <= b.to)) return false
        switch (n.name) {
          case 'HeaderMark':
            if (n.node.parent?.name.startsWith('ATXHeading') && !lineActive(n.from)) out.push(hide.range(n.from, spaceAfter(n.to)))
            break
          case 'EmphasisMark':
          case 'StrikethroughMark': {
            const p = n.node.parent
            if (p && !touched(p.from, p.to)) out.push(hide.range(n.from, n.to))
            break
          }
          case 'CodeMark': {
            const p = n.node.parent
            if (p?.name === 'InlineCode' && !touched(p.from, p.to)) out.push(hide.range(n.from, n.to))
            break
          }
          case 'InlineCode':
            out.push(Decoration.mark({ class: 'cm-lp-icode' }).range(n.from, n.to))
            break
          case 'Blockquote':
            lineDeco(n.from, n.to, 'cm-lp-quote')
            break
          case 'QuoteMark':
            if (!lineActive(n.from)) out.push(hide.range(n.from, spaceAfter(n.to)))
            break
          case 'ListMark': {
            const list = n.node.parent?.parent
            // a task item keeps its mark hidden behind the checkbox; a plain bullet becomes "•"
            const task = n.node.parent?.getChild('Task')
            if (list?.name === 'BulletList' && !lineActive(n.from)) out.push((task ? hide : bullet).range(n.from, task ? spaceAfter(n.to) : n.to))
            break
          }
          case 'TaskMarker': {
            if (touched(n.from, n.to)) break
            const checked = /x/i.test(s.sliceDoc(n.from, n.to))
            out.push(Decoration.replace({ widget: new CheckWidget(checked) }).range(n.from, n.to))
            if (checked) {
              const task = n.node.parent
              if (task && spaceAfter(n.to) < task.to) out.push(Decoration.mark({ class: 'cm-lp-done' }).range(spaceAfter(n.to), task.to))
            }
            break
          }
          case 'HorizontalRule':
            if (!lineActive(n.from)) out.push(rule.range(n.from, n.to))
            break
          case 'Link': {
            if (touched(n.from, n.to)) return false
            const marks = n.node.getChildren('LinkMark')
            const url = n.node.getChild('URL')
            const ev = url ? parseNoteLink(s.sliceDoc(url.from, url.to)) : undefined
            if (ev && marks.length >= 2) {
              out.push(Decoration.replace({ widget: new EventChip(ev, s.sliceDoc(marks[0].to, marks[1].from), chipStamp()) }).range(n.from, n.to))
              return false
            }
            if (marks.length >= 2 && url && marks[1].from > marks[0].to) {
              const href = s.sliceDoc(url.from, url.to)
              out.push(hide.range(n.from, marks[0].to))
              out.push(Decoration.mark({ class: 'cm-lp-link', attributes: { 'data-url': href, title: href } }).range(marks[0].to, marks[1].from))
              out.push(hide.range(marks[1].from, n.to))
            }
            return false
          }
          case 'URL': {
            // a bare link (not inside [text](url))
            if (n.node.parent?.name === 'Link' || touched(n.from, n.to)) break
            out.push(Decoration.mark({ class: 'cm-lp-link', attributes: { 'data-url': s.sliceDoc(n.from, n.to) } }).range(n.from, n.to))
            break
          }
        }
      },
    })
    // recordings, pictures and [[links]] — not Markdown nodes: by the text of the lines
    for (let pos = from; pos <= to; ) {
      const line = lineOf(pos)
      const m = line.text.match(AUDIO_EMBED)
      const im = line.text.match(IMAGE_EMBED)
      if (inCode(line.from) || inComp(line.from)) {
        // code — as it is
      } else if (im) {
        // the picture; with the cursor on its line — its text, and the picture under it
        if (touched(line.from, line.to)) out.push(Decoration.widget({ widget: new ImageWidget(im[1], true), side: 1 }).range(line.to))
        else out.push(Decoration.replace({ widget: new ImageWidget(im[1], false) }).range(line.from, line.to))
      } else if (m) {
        if (!touched(line.from, line.to) && line.length) out.push(Decoration.replace({ widget: new AudioWidget(m[1], transcribing.get(m[1]) ?? '') }).range(line.from, line.to))
      } else {
        WIKI_LINK.lastIndex = 0
        let w: RegExpExecArray | null
        while ((w = WIKI_LINK.exec(line.text))) {
          const a = line.from + w.index
          const b = a + w[0].length
          if (touched(a, b)) out.push(Decoration.mark({ class: 'cm-wiki' }).range(a, b))
          else {
            const label = w[1].split('|')[1]
            out.push(hide.range(a, label ? a + 2 + w[1].indexOf('|') + 1 : a + 2))
            out.push(Decoration.mark({ class: 'cm-wiki', attributes: { 'data-wiki': w[1].split('|')[0] } }).range(label ? a + 2 + w[1].indexOf('|') + 1 : a + 2, b - 2))
            out.push(hide.range(b - 2, b))
          }
        }
        // emoji: a bit bigger than the text; up to three alone on a line — big
        if (/\p{Extended_Pictographic}/u.test(line.text)) {
          const big = EMOJI_LINE.test(line.text)
          EMOJI.lastIndex = 0
          let em: RegExpExecArray | null
          while ((em = EMOJI.exec(line.text))) out.push(Decoration.mark({ class: big ? 'cm-emoji big' : 'cm-emoji' }).range(line.from + em.index, line.from + em.index + em[0].length))
        }
      }
      pos = line.to + 1
    }
  }
  return Decoration.set(out, true)
}

/** Live preview, drawn again on every update (the cursor shows the raw Markdown where it is). */
export const livePreview = [
  codeFencesField,
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(v: EditorView) {
        this.decorations = decorate(v)
      }
      update(u: ViewUpdate): void {
        this.decorations = decorate(u.view)
      }
    },
    { decorations: (p) => p.decorations },
  ),
]

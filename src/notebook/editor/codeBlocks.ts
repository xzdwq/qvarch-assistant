import { EditorState, StateField } from '@codemirror/state'
import { EditorView, WidgetType } from '@codemirror/view'
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { FENCE_PICK, FORMATTABLE, formatCode } from '@renderer/lib/codeblocks'
import { ICON_CHECK, ICON_COPY, ICON_FORMAT, widgetButton } from './icons'
import { wikiNotes } from './wikiComplete'

/**
 * Code blocks of a note (``` … ```, any indent — inside a list item too): where they are, the bar on them (the
 * language, «Форматировать», «Скопировать»), the languages offered when a fence is typed.
 */

/** A code block: its opening and closing lines (1-based; no closing — open to the end) and its text range. */
export interface CodeFence {
  open: number
  close?: number
  from: number
  to: number
}
/** The note's code blocks (scanned once per change of the text). */
function scanCodeFences(state: EditorState): CodeFence[] {
  const out: CodeFence[] = []
  let cur: { open: number; ch: string; len: number } | undefined
  for (let no = 1; no <= state.doc.lines; no++) {
    const text = state.doc.line(no).text
    const m = text.match(/^\s*(`{3,}|~{3,})/)
    if (!m) continue
    if (!cur) cur = { open: no, ch: m[1][0], len: m[1].length }
    else if (m[1][0] === cur.ch && m[1].length >= cur.len && !text.trim().slice(m[1].length).trim()) {
      out.push({ open: cur.open, close: no, from: state.doc.line(cur.open).from, to: state.doc.line(no).to })
      cur = undefined
    }
  }
  if (cur) out.push({ open: cur.open, from: state.doc.line(cur.open).from, to: state.doc.length })
  return out
}
export const codeFencesField = StateField.define<CodeFence[]>({
  create: scanCodeFences,
  update: (v, tr) => (tr.docChanged ? scanCodeFences(tr.state) : v),
})

/** Formats the code of the block whose opening fence is at `pos` (one undo step). */
async function formatBlockAt(v: EditorView, pos: number, lang: string): Promise<void> {
  const doc = v.state.doc
  const open = doc.lineAt(pos)
  const m = /^\s*(`{3,}|~{3,})/.exec(open.text)
  if (!m) throw new Error('Блок не найден')
  let close = 0
  for (let no = open.number + 1; no <= doc.lines; no++) {
    const t2 = doc.line(no).text.trim()
    if (t2.startsWith(m[1]) && !t2.slice(m[1].length).trim()) {
      close = no
      break
    }
  }
  if (!close || close === open.number + 1) return
  const from = doc.line(open.number + 1).from
  const to = doc.line(close - 1).to
  const code = v.state.sliceDoc(from, to)
  const out = await formatCode(lang, code)
  // the text may have changed while formatting — only the same code is replaced
  if (v.state.sliceDoc(from, to) === code && out !== code) v.dispatch({ changes: { from, to, insert: out } })
}

/** The bar of a code block (top right, like Obsidian): its language, «Форматировать» (known languages), «Скопировать». */
export class CodeBarWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly lang: string | undefined,
  ) {
    super()
  }
  eq(o: CodeBarWidget): boolean {
    return o.code === this.code && o.lang === this.lang
  }
  toDOM(v: EditorView): HTMLElement {
    const bar = document.createElement('span')
    bar.className = 'cm-lp-bar'
    if (this.lang) {
      const l = document.createElement('span')
      l.className = 'cm-lp-lang'
      l.textContent = this.lang
      bar.append(l)
    }
    if (this.lang && FORMATTABLE.has(this.lang)) {
      const lang = this.lang
      bar.append(
        widgetButton(
          ICON_FORMAT,
          'Форматировать',
          (b) => {
            void formatBlockAt(v, v.posAtDOM(bar), lang).then(
              () => {
                b.innerHTML = ICON_CHECK
                setTimeout(() => (b.innerHTML = ICON_FORMAT), 1200)
              },
              (err: unknown) => {
                b.classList.add('err')
                b.title = `Не получилось: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`
                setTimeout(() => {
                  b.classList.remove('err')
                  b.title = 'Форматировать'
                }, 4000)
              },
            )
          },
          { className: 'cm-lp-copy' },
        ),
      )
    }
    bar.append(
      widgetButton(
        ICON_COPY,
        'Скопировать код',
        (b) => {
          void navigator.clipboard.writeText(this.code).then(() => {
            b.innerHTML = ICON_CHECK
            setTimeout(() => (b.innerHTML = ICON_COPY), 1200)
          })
        },
        { className: 'cm-lp-copy' },
      ),
    )
    return bar
  }
  ignoreEvent(): boolean {
    return true
  }
}

/**
 * Typing ``` opens the language list at once — nothing picked: Enter / space just go on typing; the arrows
 * pick, Enter takes the picked one (and closes the block if it is not closed yet, the cursor inside).
 */
function fenceLanguages(ctx: CompletionContext): CompletionResult | null {
  const line = ctx.state.doc.lineAt(ctx.pos)
  const m = /^(\s*)(`{3,}|~{3,})(\w*)$/.exec(line.text.slice(0, ctx.pos - line.from))
  if (!m || line.text.slice(ctx.pos - line.from).trim()) return null
  // an opening fence only: an even number of fences above it
  let fences = 0
  for (let no = 1; no < line.number; no++) if (/^\s*(`{3,}|~{3,})/.test(ctx.state.doc.line(no).text)) fences++
  if (fences % 2) return null
  const from = ctx.pos - m[3].length
  return {
    from,
    validFor: /^\w*$/,
    options: FENCE_PICK.map((l) => ({
      label: l.name,
      detail: l.title,
      apply: (v: EditorView, _c: unknown, a: number, b: number) => {
        // the block is closed further down already — only the name
        let closed = false
        for (let no = line.number + 1; no <= v.state.doc.lines; no++) {
          const t2 = v.state.doc.line(no).text.trim()
          if (t2.startsWith(m[2])) {
            closed = !/^(`{3,}|~{3,})\w/.test(t2)
            break
          }
        }
        if (closed) v.dispatch({ changes: { from: a, to: b, insert: l.name }, selection: { anchor: a + l.name.length } })
        else {
          const ins = `${l.name}\n${m[1]}\n${m[1]}${m[2]}`
          v.dispatch({ changes: { from: a, to: b, insert: ins }, selection: { anchor: a + l.name.length + 1 + m[1].length } })
        }
      },
    })),
  }
}
// (one completion for the note: a fence's languages, the notes after «[[»)
export const fenceLanguagePicker = autocompletion({ override: [fenceLanguages, wikiNotes], activateOnTyping: true, selectOnOpen: false, icons: false, closeOnBlur: true })

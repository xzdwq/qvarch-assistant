<script setup lang="ts">
import { createApp, nextTick, onBeforeUnmount, onMounted, ref, watch, type App } from 'vue'
import ThinkingOrb from './ThinkingOrb.vue'
import Icon from './Icon.vue'
import { EditorSelection, EditorState, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { tags as t } from '@lezer/highlight'
import { AUDIO_EMBED } from '@shared/vault'
import { audioUrl, fixDuration, transcribing } from '../lib/notebook'

/**
 * The notebook's editor (CodeMirror 6), like Obsidian's Live Preview: what is finished reads as the result —
 * headings, bold, links, lists, checkboxes, quotes — and the Markdown signs show only where the cursor is.
 * A recording line is a player; [[a link]] opens that note.
 */
const props = defineProps<{ text: string }>()
const emit = defineEmits<{ change: [text: string]; wiki: [target: string]; transcribe: [audio: string]; dropAudio: [audio: string]; toEvent: [text: string] }>()

const host = ref<HTMLElement>()
let view: EditorView | undefined

// ---------- the look ----------
const mdStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.75em', fontWeight: '700', color: '#eef0ff' },
  { tag: t.heading2, fontSize: '1.45em', fontWeight: '700', color: '#e4e7ff' },
  { tag: t.heading3, fontSize: '1.22em', fontWeight: '650', color: '#dfe3ff' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '650', color: '#d8dcff' },
  { tag: t.strong, fontWeight: '700', color: '#f4f4f8' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: '#8b93a7' },
  { tag: t.link, color: '#a5b4fc' },
  { tag: t.url, color: '#818cf8' },
  { tag: t.monospace, fontFamily: 'Consolas, "Cascadia Mono", monospace', fontSize: '0.9em' },
  { tag: t.quote, color: '#b8c0d6' },
  { tag: [t.processingInstruction, t.meta], color: '#6f7894' },
  { tag: t.contentSeparator, color: '#6f7894' },
])
const theme = EditorView.theme(
  {
    '&': { color: '#dfe2ea', backgroundColor: 'transparent', fontSize: '1em' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.65', padding: '4px 0 40vh', overflow: 'visible' },
    '.cm-content': { caretColor: '#a5b4fc', padding: '0 24px 0 10px' },
    '.cm-cursor': { borderLeftColor: '#a5b4fc', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(124, 108, 246, 0.35) !important' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: '#3f465a', fontSize: '0.78em', paddingTop: '0.35em' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 4px', minWidth: '28px' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#8b93a7' },
    '.cm-placeholder': { color: '#5b6275' },
    '.cm-searchMatch': { backgroundColor: 'rgba(250, 204, 21, 0.22)', outline: '1px solid rgba(250, 204, 21, 0.45)', borderRadius: '2px' },
    '.cm-searchMatch-selected': { backgroundColor: 'rgba(250, 204, 21, 0.45)' },
    '.cm-selectionMatch': { backgroundColor: 'rgba(124, 108, 246, 0.18)' },
    // the search panel: in the app's style
    '.cm-panels': { backgroundColor: 'transparent', color: '#dfe2ea', border: 'none' },
    '.cm-panels.cm-panels-top': { borderBottom: 'none' },
    '.cm-search': {
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: '6px',
      margin: '6px 24px 10px 46px',
      padding: '8px 36px 8px 10px',
      position: 'relative',
      borderRadius: '10px',
      border: '1px solid rgba(255,255,255,0.1)',
      background: '#1b1e29',
      boxShadow: '0 10px 28px rgba(0,0,0,0.45)',
      fontSize: '12.5px',
    },
    '.cm-search br': { flexBasis: '100%', height: '0' },
    '.cm-textfield': {
      margin: '0',
      padding: '5px 9px',
      minWidth: '180px',
      borderRadius: '7px',
      border: '1px solid #262b3a',
      background: '#0b0d13',
      color: '#dfe2ea',
      font: 'inherit',
      fontSize: '12.5px',
      outline: 'none',
    },
    '.cm-textfield:focus': { borderColor: '#6366f1' },
    '.cm-button': {
      margin: '0',
      padding: '4px 10px',
      borderRadius: '7px',
      border: '1px solid rgba(255,255,255,0.12)',
      backgroundImage: 'none',
      backgroundColor: 'transparent',
      color: '#c7d2fe',
      font: 'inherit',
      fontSize: '12px',
      cursor: 'pointer',
    },
    '.cm-button:hover': { backgroundColor: 'rgba(124,108,246,0.18)' },
    '.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#aab1c3', fontSize: '12px', cursor: 'pointer' },
    '.cm-search input[type=checkbox]': { accentColor: '#7c6cf6', margin: '0' },
    '.cm-search button[name=close]': {
      position: 'absolute',
      top: '6px',
      right: '8px',
      padding: '0 6px',
      border: 'none',
      borderRadius: '6px',
      background: 'transparent',
      color: '#8b93a7',
      fontSize: '17px',
      lineHeight: '24px',
      cursor: 'pointer',
    },
    '.cm-search button[name=close]:hover': { background: 'rgba(255,255,255,0.08)', color: '#fff' },
    // live preview
    '.cm-wiki': { color: '#a5b4fc', textDecoration: 'underline', textDecorationColor: 'rgba(165,180,252,0.4)', cursor: 'pointer' },
    '.cm-lp-link': { color: '#a5b4fc', textDecoration: 'underline', textDecorationColor: 'rgba(165,180,252,0.4)', cursor: 'pointer' },
    '.cm-lp-bullet': { display: 'inline-block', width: '1.1em', color: '#a78bfa', fontWeight: '700' },
    '.cm-lp-check': { verticalAlign: '-0.12em', margin: '0 0.35em 0 0', width: '1em', height: '1em', accentColor: '#7c6cf6', cursor: 'pointer' },
    '.cm-lp-hr': { display: 'inline-block', width: '100%', height: '0', borderTop: '1px solid rgba(255,255,255,0.14)', verticalAlign: 'middle' },
    '.cm-lp-quote': { borderLeft: '3px solid rgba(124,108,246,0.6)', paddingLeft: '12px !important', color: '#b8c0d6' },
    '.cm-lp-code': { backgroundColor: 'rgba(255,255,255,0.045)', fontFamily: 'Consolas, "Cascadia Mono", monospace !important', fontSize: '0.88em', paddingLeft: '16px !important', paddingRight: '16px !important' },
    // inside code nothing is Markdown: one colour, one weight
    '.cm-lp-code *': { fontFamily: 'inherit !important', fontSize: 'inherit !important', fontWeight: '400 !important', fontStyle: 'normal !important', textDecoration: 'none !important', color: '#d6dae6 !important' },
    '.cm-lp-code-top': { borderTopLeftRadius: '8px', borderTopRightRadius: '8px', position: 'relative' },
    '.cm-lp-code-bot': { borderBottomLeftRadius: '8px', borderBottomRightRadius: '8px' },
    // a hidden fence is a thin edge of the block: the code starts right at its top
    // after a fence the parser may still think it is code (an indented closing fence): plain text there
    '.cm-lp-plain, .cm-lp-plain *': { fontFamily: 'inherit !important', color: 'inherit !important', fontSize: 'inherit !important' },
    '.cm-lp-icode': { fontFamily: 'Consolas, "Cascadia Mono", monospace', fontSize: '0.9em', color: '#fbcfe8', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', padding: '0 3px' },
    '.cm-lp-copy': {
      position: 'absolute',
      top: '4px',
      right: '6px',
      zIndex: '2',
      display: 'inline-flex',
      padding: '4px',
      border: 'none',
      borderRadius: '6px',
      background: 'transparent',
      color: '#8b93a7',
      cursor: 'pointer',
    },
    '.cm-lp-copy:hover': { background: 'rgba(255,255,255,0.08)', color: '#e5e7eb' },
    '.cm-lp-done': { textDecoration: 'line-through', color: '#8b93a7' },
  },
  { dark: true },
)
/** The search panel in Russian. */
const phrases = EditorState.phrases.of({
  Find: 'Найти',
  Replace: 'Заменить на',
  next: 'Далее',
  previous: 'Назад',
  all: 'Все',
  'match case': 'Учитывать регистр',
  'by word': 'Слово целиком',
  regexp: 'Рег. выражение',
  replace: 'Заменить',
  'replace all': 'Заменить все',
  close: 'Закрыть',
  'current match': 'текущее совпадение',
  'on line': 'в строке',
  'replaced match on line $': 'заменено в строке $',
  'replaced $ matches': 'заменено совпадений: $',
  'Go to line': 'Перейти к строке',
  go: 'Перейти',
})

// ---------- widgets ----------
const ICON = (paths: string, size = 15) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
const CAPTIONS = ICON('<rect width="18" height="14" x="3" y="5" rx="2" ry="2"/><path d="M7 15h4M15 15h2M7 11h2M13 11h4"/>')
const TRASH = ICON('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 14)
const COPY = ICON('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>', 15)
const CHECK = ICON('<path d="M20 6 9 17l-5-5"/>', 15)
const MIC = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>'
class AudioWidget extends WidgetType {
  constructor(
    readonly rel: string,
    readonly state: string,
  ) {
    super()
  }
  eq(o: AudioWidget): boolean {
    return o.rel === this.rel && o.state === this.state
  }
  toDOM(): HTMLElement {
    const box = document.createElement('span')
    box.className = 'cm-audio'
    const icon = document.createElement('span')
    icon.className = 'cm-audio-ic'
    icon.innerHTML = MIC
    const a = document.createElement('audio')
    a.controls = true
    a.preload = 'metadata'
    fixDuration(a)
    void audioUrl(this.rel)
      .then((u) => (a.src = u))
      .catch(() => {
        box.classList.add('missing')
        box.title = 'Файл записи не найден'
      })
    const btn = (svg: string, cls: string, title: string, fn: () => void) => {
      const b = document.createElement('button')
      b.className = cls
      b.innerHTML = svg
      b.title = title
      b.onmousedown = (e) => e.preventDefault()
      b.onclick = (e) => {
        e.preventDefault()
        fn()
      }
      return b
    }
    // transcribing: the orb; else the button (the text goes on the line below the player)
    let tr: HTMLElement
    if (this.state === 'run') {
      tr = document.createElement('span')
      tr.className = 'cm-audio-orb'
      tr.title = 'Расшифровка…'
      const app = createApp(ThinkingOrb, { state: 'weaving', size: 20, px: 22, tint: '#a5b4fc' })
      app.mount(tr)
      ;(box as HTMLElement & { _orb?: App })._orb = app
    } else tr = btn(CAPTIONS, 'cm-audio-tr', this.state === 'error' ? 'Расшифровать ещё раз (прошлая попытка не удалась)' : 'Расшифровать (локально) — текст строкой ниже', () => emit('transcribe', this.rel))
    const del = btn(TRASH, 'cm-audio-del', 'Удалить запись из заметки и с диска (текст расшифровки останется)', () => {
      if (confirm('Удалить аудиозапись из заметки и с диска? Текст расшифровки останется.')) emit('dropAudio', this.rel)
    })
    box.append(icon, a, tr, del)
    return box
  }
  destroy(dom: HTMLElement): void {
    ;(dom as HTMLElement & { _orb?: App })._orb?.unmount()
  }
  ignoreEvent(): boolean {
    return true
  }
}
/** The copy button of a code block (top right, like Obsidian). */
class CopyWidget extends WidgetType {
  constructor(readonly code: string) {
    super()
  }
  eq(o: CopyWidget): boolean {
    return o.code === this.code
  }
  toDOM(): HTMLElement {
    const b = document.createElement('button')
    b.className = 'cm-lp-copy'
    b.title = 'Скопировать код'
    b.innerHTML = COPY
    b.onmousedown = (e) => e.preventDefault()
    b.onclick = (e) => {
      e.preventDefault()
      void navigator.clipboard.writeText(this.code).then(() => {
        b.innerHTML = CHECK
        setTimeout(() => (b.innerHTML = COPY), 1200)
      })
    }
    return b
  }
  ignoreEvent(): boolean {
    return true
  }
}
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

// ---------- live preview ----------
const WIKI = /\[\[([^\]\n]+)\]\]/g
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

  // code blocks: ``` … ``` (any indent — also inside a list item); Markdown inside them is not rendered
  const blocks: Array<{ open: number; close?: number; from: number; to: number }> = []
  {
    let cur: { open: number; ch: string; len: number } | undefined
    for (let no = 1; no <= s.doc.lines; no++) {
      const text = s.doc.line(no).text
      const m = text.match(/^\s*(`{3,}|~{3,})/)
      if (!m) continue
      if (!cur) cur = { open: no, ch: m[1][0], len: m[1].length }
      else if (m[1][0] === cur.ch && m[1].length >= cur.len && !text.trim().slice(m[1].length).trim()) {
        blocks.push({ open: cur.open, close: no, from: s.doc.line(cur.open).from, to: s.doc.line(no).to })
        cur = undefined
      }
    }
    if (cur) blocks.push({ open: cur.open, from: s.doc.line(cur.open).from, to: s.doc.length })
  }
  const inCode = (pos: number) => blocks.some((b) => pos >= b.from && pos <= b.to)
  for (const b of blocks) {
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
      out.push(Decoration.replace({ widget: new CopyWidget(code.join('\n')) }).range(open.from, open.to))
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
        // the parser's code (it may run past our block — an indented closing fence): plain text outside our blocks
        if (n.name === 'FencedCode' || n.name === 'CodeBlock') {
          for (let p = n.from; p <= n.to; ) {
            const l = lineOf(p)
            if (!inCode(l.from)) out.push(Decoration.line({ class: 'cm-lp-plain' }).range(l.from))
            p = l.to + 1
          }
          return false
        }
        if (inCode(n.from)) return false
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
          case 'FencedCode': {
            // the parser's code block outside our blocks (an unclosed / indented fence) — plain text
            for (let p = n.from; p <= n.to; ) {
              const l = lineOf(p)
              if (!inCode(l.from)) out.push(Decoration.line({ class: 'cm-lp-plain' }).range(l.from))
              p = l.to + 1
            }
            return false
          }
          case 'CodeBlock': {
            for (let p = n.from; p <= n.to; ) {
              const l = lineOf(p)
              if (!inCode(l.from)) out.push(Decoration.line({ class: 'cm-lp-plain' }).range(l.from))
              p = l.to + 1
            }
            return false
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
    // recordings and [[links]] — not Markdown nodes: by the text of the lines
    for (let pos = from; pos <= to; ) {
      const line = lineOf(pos)
      const m = line.text.match(AUDIO_EMBED)
      if (inCode(line.from)) {
        // code — as it is
      } else if (m) {
        if (!touched(line.from, line.to) && line.length) out.push(Decoration.replace({ widget: new AudioWidget(m[1], transcribing.get(m[1]) ?? '') }).range(line.from, line.to))
      } else {
        WIKI.lastIndex = 0
        let w: RegExpExecArray | null
        while ((w = WIKI.exec(line.text))) {
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
      }
      pos = line.to + 1
    }
  }
  return Decoration.set(out, true)
}
const live = ViewPlugin.fromClass(
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
)
/** Clicks on what is rendered: a link opens in the browser, [[a note]] opens it; Ctrl+click works on raw text too. */
const clicks = EditorView.domEventHandlers({
  mousedown(e, v) {
    const el = e.target as HTMLElement
    const url = el.closest<HTMLElement>('.cm-lp-link')?.dataset.url
    if (url) {
      e.preventDefault()
      if (/^https?:\/\//i.test(url)) window.qa.openExternal(url)
      return true
    }
    const wiki = el.closest<HTMLElement>('.cm-wiki')?.dataset.wiki
    if (wiki) {
      e.preventDefault()
      emit('wiki', wiki)
      return true
    }
    if (!(e.ctrlKey || e.metaKey)) return false
    const pos = v.posAtCoords({ x: e.clientX, y: e.clientY })
    if (pos == null) return false
    const line = v.state.doc.lineAt(pos)
    WIKI.lastIndex = 0
    let w: RegExpExecArray | null
    while ((w = WIKI.exec(line.text))) {
      const a = line.from + w.index
      if (pos >= a && pos <= a + w[0].length) {
        e.preventDefault()
        emit('wiki', w[1].split('|')[0])
        return true
      }
    }
    return false
  },
})

/** Ctrl+B / Ctrl+I: wrap the selection. */
function wrap(mark: string) {
  return (v: EditorView) => {
    v.dispatch(
      v.state.changeByRange((r) => {
        const text = v.state.sliceDoc(r.from, r.to)
        return { changes: { from: r.from, to: r.to, insert: `${mark}${text}${mark}` }, range: EditorSelection.range(r.from + mark.length, r.from + mark.length + text.length) }
      }),
    )
    return true
  }
}

// ---------- the right-click menu: cut / copy / paste, and for a selection — "В событие" and Markdown styles ----------
const menu = ref<{ x: number; y: number; sel: boolean }>()
const menuEl = ref<HTMLElement>()
const menuPos = ref({ left: 0, top: 0 })
const contextMenu = EditorView.domEventHandlers({
  contextmenu(e, v) {
    e.preventDefault()
    // a right click outside the selection puts the cursor there (as in any text editor)
    const pos = v.posAtCoords({ x: e.clientX, y: e.clientY })
    const r = v.state.selection.main
    if (pos != null && (r.empty || pos < r.from || pos > r.to)) v.dispatch({ selection: { anchor: pos } })
    v.focus()
    menu.value = { x: e.clientX, y: e.clientY, sel: !v.state.selection.main.empty }
    menuPos.value = { left: e.clientX, top: e.clientY }
    void nextTick(() => {
      const el = menuEl.value
      if (!el) return
      menuPos.value = {
        left: Math.max(4, Math.min(e.clientX, window.innerWidth - el.offsetWidth - 4)),
        top: Math.max(4, Math.min(e.clientY, window.innerHeight - el.offsetHeight - 4)),
      }
    })
    return true
  },
})
function closeMenu(): void {
  menu.value = undefined
}
function onMenuDown(e: MouseEvent): void {
  if (menu.value && !menuEl.value?.contains(e.target as Node)) closeMenu()
}
function onMenuKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && menu.value) closeMenu()
}
const selText = () => (view ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) : '')
/** The menu's actions; each closes it and gives the focus back to the text. */
function act(what: 'cut' | 'copy' | 'paste' | 'all' | 'event' | 'code' | 'bold' | 'heading' | 'list'): void {
  const v = view
  closeMenu()
  if (!v) return
  const r = v.state.selection.main
  const text = selText()
  if (what === 'copy') void navigator.clipboard.writeText(text)
  else if (what === 'cut') {
    void navigator.clipboard.writeText(text)
    v.dispatch({ changes: { from: r.from, to: r.to }, selection: { anchor: r.from } })
  } else if (what === 'paste')
    void navigator.clipboard.readText().then((t) => {
      if (!t || !view) return
      const s = view.state.selection.main
      view.dispatch({ changes: { from: s.from, to: s.to, insert: t }, selection: { anchor: s.from + t.length }, scrollIntoView: true })
    })
  else if (what === 'all') v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } })
  else if (what === 'event') {
    if (text.trim()) emit('toEvent', text.trim())
    return
  } else if (what === 'bold') wrap('**')(v)
  else if (what === 'code') {
    if (text.includes('\n')) {
      // several lines — a code block on lines of its own
      const a = v.state.doc.lineAt(r.from)
      const b = v.state.doc.lineAt(r.to)
      const body = v.state.sliceDoc(a.from, b.to)
      const ins = `\`\`\`\n${body}\n\`\`\``
      v.dispatch({ changes: { from: a.from, to: b.to, insert: ins }, selection: { anchor: a.from + 4, head: a.from + 4 + body.length } })
    } else wrap('`')(v)
  } else {
    // line by line: a heading / a list item each (the old marker is replaced)
    const a = v.state.doc.lineAt(r.from)
    const b = v.state.doc.lineAt(r.to)
    const changes: Array<{ from: number; to: number; insert: string }> = []
    for (let n = a.number; n <= b.number; n++) {
      const line = v.state.doc.line(n)
      if (!line.text.trim()) continue
      const m = what === 'heading' ? /^\s*#{1,6}\s+/.exec(line.text) : /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/.exec(line.text)
      const indent = what === 'list' ? (/^\s*/.exec(line.text)?.[0] ?? '') : ''
      const cut = m ? m[0].length : what === 'list' ? indent.length : 0
      changes.push({ from: line.from, to: line.from + cut, insert: what === 'heading' ? '## ' : `${indent}- ` })
    }
    v.dispatch({ changes })
  }
  v.focus()
}
onMounted(() => {
  window.addEventListener('mousedown', onMenuDown, true)
  window.addEventListener('keydown', onMenuKey)
  window.addEventListener('blur', closeMenu)
})
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onMenuDown, true)
  window.removeEventListener('keydown', onMenuKey)
  window.removeEventListener('blur', closeMenu)
})

onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: props.text,
      extensions: [
        history(),
        lineNumbers(),
        highlightActiveLineGutter(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, extensions: [{ remove: ['SetextHeading'] }] }),
        syntaxHighlighting(mdStyle),
        highlightSelectionMatches(),
        search({ top: true }),
        phrases,
        theme,
        live,
        clicks,
        contextMenu,
        placeholder('Пишите… # заголовок, **жирный**, - список, - [ ] задача, [[другая заметка]]'),
        keymap.of([{ key: 'Mod-b', run: wrap('**') }, { key: 'Mod-i', run: wrap('*') }, indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) emit('change', u.state.doc.toString())
        }),
      ],
    }),
  })
})
onBeforeUnmount(() => view?.destroy())

// the same note changed elsewhere (another pane, a transcript, a reload): only the changed middle is replaced
watch(
  () => props.text,
  (text) => {
    if (!view) return
    const cur = view.state.doc.toString()
    if (cur === text) return
    let a = 0
    while (a < cur.length && a < text.length && cur[a] === text[a]) a++
    let b = 0
    while (b < cur.length - a && b < text.length - a && cur[cur.length - 1 - b] === text[text.length - 1 - b]) b++
    view.dispatch({ changes: { from: a, to: cur.length - b, insert: text.slice(a, text.length - b) } })
  },
)
// a transcription started / failed: the player's button follows
watch(
  () => [...transcribing.entries()].join(),
  () => view?.dispatch({}),
)

defineExpose({
  focus: () => view?.focus(),
  /** Inserts text as its own lines after the cursor's line. */
  insertBlock(text: string): void {
    if (!view) return
    const s = view.state
    const line = s.doc.lineAt(s.selection.main.head)
    const at = line.length ? line.to : line.from
    // a blank line before: the recording is not glued to a list or a paragraph
    const ins = (line.length ? '\n\n' : '') + text + '\n'
    view.dispatch({ changes: { from: at, insert: ins }, selection: { anchor: at + ins.length }, scrollIntoView: true })
    view.focus()
  },
  /** Goes to a place (a search hit): selects it and scrolls it into the middle. */
  reveal(line: number, col = 0, len = 0): void {
    if (!view) return
    const l = view.state.doc.line(Math.min(view.state.doc.lines, line + 1))
    const from = Math.min(l.to, l.from + col)
    view.dispatch({ selection: { anchor: from, head: Math.min(l.to, from + len) }, effects: EditorView.scrollIntoView(from, { y: 'center' }) })
    view.focus()
  },
})
</script>

<template>
  <div ref="host" class="mde"></div>
  <Teleport to="body">
    <div v-if="menu" ref="menuEl" class="mde-menu" :style="{ left: `${menuPos.left}px`, top: `${menuPos.top}px` }" @contextmenu.prevent>
      <button :disabled="!menu.sel" @click="act('cut')"><Icon name="scissors" :size="14" />Вырезать<kbd>Ctrl+X</kbd></button>
      <button :disabled="!menu.sel" @click="act('copy')"><Icon name="copy" :size="14" />Копировать<kbd>Ctrl+C</kbd></button>
      <button @click="act('paste')"><Icon name="clipboard" :size="14" />Вставить<kbd>Ctrl+V</kbd></button>
      <button @click="act('all')"><Icon name="checkSquare" :size="14" />Выделить всё<kbd>Ctrl+A</kbd></button>
      <template v-if="menu.sel">
        <hr />
        <button class="ev" @click="act('event')"><Icon name="plus" :size="14" />В событие</button>
        <hr />
        <button @click="act('code')"><Icon name="code" :size="14" />Код</button>
        <button @click="act('bold')"><Icon name="bold" :size="14" />Жирный<kbd>Ctrl+B</kbd></button>
        <button @click="act('heading')"><Icon name="heading" :size="14" />Заголовок</button>
        <button @click="act('list')"><Icon name="list" :size="14" />Список</button>
      </template>
    </div>
  </Teleport>
</template>

<style>
/* the right-click menu (teleported) */
.mde-menu {
  position: fixed;
  z-index: 2000;
  min-width: 200px;
  padding: 5px;
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #1c2030;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55);
}
.mde-menu button {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #e2e6f0;
  font-size: 12.5px;
  text-align: left;
  cursor: default;
}
.mde-menu button:hover:not(:disabled) {
  background: rgba(139, 92, 246, 0.18);
}
.mde-menu button:disabled {
  opacity: 0.4;
}
.mde-menu button svg {
  flex: none;
  color: #9aa3b8;
}
.mde-menu .ev svg {
  color: #a78bfa;
}
.mde-menu kbd {
  margin-left: auto;
  padding-left: 18px;
  color: #6b7387;
  font: inherit;
  font-size: 11px;
}
.mde-menu hr {
  margin: 4px 6px;
  border: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
</style>

<style scoped>
.mde {
  width: 100%;
  max-width: 820px;
  margin: 0 auto;
  min-height: 0;
}
.mde :deep(.cm-audio) {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 8px;
  margin: 2px 0;
  border-radius: 10px;
  border: 1px solid rgba(124, 108, 246, 0.35);
  background: rgba(124, 108, 246, 0.08);
  vertical-align: middle;
  font-size: 12px;
}
.mde :deep(.cm-audio.missing) {
  border-color: rgba(248, 113, 113, 0.5);
  opacity: 0.7;
}
.mde :deep(.cm-audio-ic) {
  display: inline-flex;
  color: #a5b4fc;
}
.mde :deep(.cm-audio audio) {
  height: 30px;
  width: 300px;
  color-scheme: dark;
}
.mde :deep(.cm-audio button) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #a5b4fc;
  cursor: pointer;
}
.mde :deep(.cm-audio-orb) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
}
.mde :deep(.cm-audio button:hover:not(:disabled)) {
  background: rgba(124, 108, 246, 0.18);
}
.mde :deep(.cm-audio .cm-audio-del) {
  color: #fca5a5;
}
.mde :deep(.cm-audio .cm-audio-del:hover) {
  background: rgba(248, 113, 113, 0.15);
}
.mde :deep(.cm-audio button:disabled) {
  opacity: 0.6;
  cursor: default;
}
</style>

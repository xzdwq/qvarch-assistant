<script setup lang="ts">
import { computed, createApp, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type App } from 'vue'
import ThinkingOrb from './ThinkingOrb.vue'
import Icon, { iconSvg } from './Icon.vue'
import { EditorSelection, EditorState, Prec, type Range } from '@codemirror/state'
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
import { codeFolding, foldGutter, foldKeymap, HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { CODE_LANGUAGES, FENCE_PICK, fenceLang, FORMATTABLE, formatCode, indentFold } from '../lib/codeblocks'
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { tags as t } from '@lezer/highlight'
import { AUDIO_EMBED, IMAGE_EMBED, imageEmbed } from '@shared/vault'
import { audioUrl, draggedImageUrl, fixDuration, hasImages, imageUrl, takeImages, transcribing } from '../lib/notebook'
import { durText, eventLink, jiraLink, parseNoteLink, periodText, pickGroups, statusOf, statusText, type EventRef, type NoteLink } from '@shared/noteEvents'
import type { JiraIssue } from '@shared/jira'
import { eventOf, events, eventsNow, eventsTick, issueOf, jiraSite, kindOf } from '../lib/noteEvents'
import { todayKey } from '../lib/today'

/**
 * The notebook's editor (CodeMirror 6), like Obsidian's Live Preview: what is finished reads as the result —
 * headings, bold, links, lists, checkboxes, quotes — and the Markdown signs show only where the cursor is.
 * A recording line is a player; [[a link]] opens that note.
 */
const props = defineProps<{ text: string }>()
const emit = defineEmits<{ change: [text: string]; wiki: [target: string]; transcribe: [audio: string]; dropAudio: [audio: string]; toEvent: [text: string, at: { from: number; to: number }]; exitUp: []; warn: [text: string] }>()

const host = ref<HTMLElement>()
let view: EditorView | undefined

// ---------- the look ----------
const mdStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.75em', fontWeight: '700', color: 'var(--text-hi)' },
  { tag: t.heading2, fontSize: '1.45em', fontWeight: '700', color: 'var(--text-hi)' },
  { tag: t.heading3, fontSize: '1.22em', fontWeight: '650', color: 'var(--text)' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '650', color: 'var(--text)' },
  { tag: t.strong, fontWeight: '700', color: '#f4f4f8' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--muted)' },
  { tag: t.link, color: 'var(--accent-fg)' },
  { tag: t.url, color: 'var(--accent-hi)' },
  { tag: t.monospace, fontFamily: 'var(--font-data)', fontSize: '0.9em' },
  { tag: t.quote, color: '#b8c0d6' },
  { tag: [t.processingInstruction, t.meta], color: '#6f7894' },
  { tag: t.contentSeparator, color: '#6f7894' },
])
/** Code inside the blocks: a dark palette close to VS Code's. */
const codeStyle = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword], color: '#c792ea' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#c3e88d' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#f78c6c' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: '#697098', fontStyle: 'italic' },
  { tag: [t.propertyName, t.attributeName], color: '#82aaff' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#82aaff' },
  { tag: [t.typeName, t.className, t.tagName, t.standard(t.tagName)], color: '#ffcb6b' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket, t.angleBracket], color: '#89ddff' },
  { tag: [t.variableName, t.definition(t.variableName)], color: '#e6e9f2' },
  { tag: t.special(t.variableName), color: '#f07178' },
  { tag: t.attributeValue, color: '#c3e88d' },
])
const theme = EditorView.theme(
  {
    '&': { color: 'var(--text)', backgroundColor: 'transparent', fontSize: '1em' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.65', padding: '4px 0 40vh', overflow: 'visible' },
    '.cm-content': { caretColor: 'var(--accent-fg)', padding: '0 24px 0 10px' },
    '.cm-cursor': { borderLeftColor: 'var(--accent-fg)', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgb(var(--accent-rgb) / 0.3) !important' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--border-3)', fontSize: '0.78em', paddingTop: '0.35em' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 4px', minWidth: '28px' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--muted)' },
    '.cm-placeholder': { color: '#5b6275' },
    '.cm-searchMatch': { backgroundColor: 'rgba(250, 204, 21, 0.22)', outline: '1px solid rgba(250, 204, 21, 0.45)', borderRadius: '2px' },
    '.cm-searchMatch-selected': { backgroundColor: 'rgba(250, 204, 21, 0.45)' },
    '.cm-selectionMatch': { backgroundColor: 'rgb(var(--accent-rgb) / 0.16)' },
    // the search panel: in the app's style
    '.cm-panels': { backgroundColor: 'transparent', color: 'var(--text)', border: 'none' },
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
      background: 'var(--pop)',
      boxShadow: '0 10px 28px rgba(0,0,0,0.45)',
      fontSize: '12.5px',
    },
    '.cm-search br': { flexBasis: '100%', height: '0' },
    '.cm-textfield': {
      margin: '0',
      padding: '5px 9px',
      minWidth: '180px',
      borderRadius: '7px',
      border: '1px solid var(--border-2)',
      background: 'var(--field-bg)',
      color: 'var(--text)',
      font: 'inherit',
      fontSize: '12.5px',
      outline: 'none',
    },
    '.cm-textfield:focus': { borderColor: 'var(--accent)' },
    '.cm-button': {
      margin: '0',
      padding: '4px 10px',
      borderRadius: '7px',
      border: '1px solid rgba(255,255,255,0.12)',
      backgroundImage: 'none',
      backgroundColor: 'transparent',
      color: 'var(--accent-fg)',
      font: 'inherit',
      fontSize: '12px',
      cursor: 'pointer',
    },
    '.cm-button:hover': { backgroundColor: 'rgb(var(--accent-rgb) / 0.16)' },
    '.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#aab1c3', fontSize: '12px', cursor: 'pointer' },
    '.cm-search input[type=checkbox]': { accentColor: 'var(--accent)', margin: '0' },
    '.cm-search button[name=close]': {
      position: 'absolute',
      top: '6px',
      right: '8px',
      padding: '0 6px',
      border: 'none',
      borderRadius: '6px',
      background: 'transparent',
      color: 'var(--muted)',
      fontSize: '17px',
      lineHeight: '24px',
      cursor: 'pointer',
    },
    '.cm-search button[name=close]:hover': { background: 'rgba(255,255,255,0.08)', color: 'var(--text-hi)' },
    // live preview
    '.cm-wiki': { color: 'var(--accent-fg)', textDecoration: 'underline', textDecorationColor: 'rgba(255,162,92,0.4)', cursor: 'pointer' },
    '.cm-lp-link': { color: 'var(--accent-fg)', textDecoration: 'underline', textDecorationColor: 'rgba(255,162,92,0.4)', cursor: 'pointer' },
    '.cm-lp-bullet': { display: 'inline-block', width: '1.1em', color: 'var(--accent-hi)', fontWeight: '700' },
    '.cm-lp-check': { verticalAlign: '-0.12em', margin: '0 0.35em 0 0', width: '1em', height: '1em', accentColor: 'var(--accent)', cursor: 'pointer' },
    '.cm-lp-hr': { display: 'inline-block', width: '100%', height: '0', borderTop: '1px solid rgba(255,255,255,0.14)', verticalAlign: 'middle' },
    '.cm-lp-quote': { borderLeft: '3px solid rgb(var(--accent-rgb) / 0.6)', paddingLeft: '12px !important', color: '#b8c0d6' },
    '.cm-lp-code': { backgroundColor: 'rgba(255,255,255,0.045)', fontFamily: 'var(--font-data) !important', fontSize: '0.88em', paddingLeft: '16px !important', paddingRight: '16px !important' },
    // inside code nothing is Markdown: one colour, one weight
    '.cm-line.cm-lp-code': { color: '#d6dae6' },
    '.cm-lp-code *': { fontFamily: 'inherit !important', fontSize: 'inherit !important', fontWeight: '400 !important', textDecoration: 'none !important' },
    '.cm-lp-bar': { position: 'absolute', top: '4px', right: '6px', zIndex: '2', display: 'inline-flex', alignItems: 'center', gap: '2px' },
    '.cm-lp-bar .cm-lp-copy': { position: 'static' },
    '.cm-lp-lang': { marginRight: '4px', color: 'var(--dim)', fontSize: '11px', fontFamily: 'var(--font-data)', textTransform: 'lowercase', userSelect: 'none' },
    '.cm-lp-copy.err': { color: '#f87171' },
    '.cm-tooltip.cm-tooltip-autocomplete': { border: '1px solid rgba(255,255,255,0.1)', borderRadius: '9px', background: 'var(--pop)', boxShadow: '0 12px 30px rgba(0,0,0,0.5)', overflow: 'hidden' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'inherit', maxHeight: '240px', padding: '4px' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '4px 10px', borderRadius: '6px', color: '#d6dae6', fontSize: '12.5px' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'rgb(var(--accent-rgb) / 0.28)', color: 'var(--text-hi)' },
    '.cm-completionDetail': { marginLeft: '10px', color: '#7d8599', fontStyle: 'normal' },
    '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--accent-fg)' },
    '.cm-foldGutter .cm-gutterElement': { padding: '0 2px', color: 'var(--dim)', cursor: 'pointer' },
    '.cm-foldGutter .cm-gutterElement:hover': { color: 'var(--accent-fg)' },
    '.cm-foldPlaceholder': { margin: '0 4px', padding: '0 6px', border: '1px solid rgb(var(--accent-rgb) / 0.4)', borderRadius: '6px', background: 'rgb(var(--accent-rgb) / 0.14)', color: 'var(--accent-fg)', cursor: 'pointer' },
    '.cm-lp-code-top': { borderTopLeftRadius: '8px', borderTopRightRadius: '8px', position: 'relative' },
    '.cm-lp-code-bot': { borderBottomLeftRadius: '8px', borderBottomRightRadius: '8px' },
    // a hidden fence is a thin edge of the block: the code starts right at its top
    // after a fence the parser may still think it is code (an indented closing fence): plain text there
    '.cm-lp-plain, .cm-lp-plain *': { fontFamily: 'inherit !important', color: 'inherit !important', fontSize: 'inherit !important' },
    '.cm-lp-icode': { fontFamily: 'var(--font-data)', fontSize: '0.9em', color: '#fbcfe8', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', padding: '0 3px' },
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
      color: 'var(--muted)',
      cursor: 'pointer',
    },
    '.cm-lp-copy:hover': { background: 'rgba(255,255,255,0.08)', color: '#e5e7eb' },
    '.cm-lp-done': { textDecoration: 'line-through', color: 'var(--muted)' },
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
const EXPAND = ICON('<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>', 14)
/** A picture over everything, as big as the window lets it (a click / Esc closes it). */
function showFull(src: string): void {
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
function removeLine(v: EditorView, text: string): void {
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
class ImageWidget extends WidgetType {
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
    img.onclick = () => img.src && showFull(img.src)
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
    const btn = (svg: string, title: string, fn: () => void) => {
      const b = document.createElement('button')
      b.innerHTML = svg
      b.title = title
      b.onmousedown = (e) => e.preventDefault()
      b.onclick = (e) => {
        e.preventDefault()
        e.stopPropagation()
        fn()
      }
      return b
    }
    bar.append(
      btn(EXPAND, 'Открыть в полный размер', () => img.src && showFull(img.src)),
      btn(TRASH, 'Убрать изображение из заметки (Ctrl+Z — вернуть)', () => removeLine(v, imageEmbed(this.rel))),
    )
    inner.append(img, bar)
    box.append(inner)
    return box
  }
  ignoreEvent(): boolean {
    return true
  }
}
// ---------- an event / a Jira task mentioned in the note: a live chip ----------
const dmShort = (t: number) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace(/\.$/, '')
class EventChip extends WidgetType {
  constructor(
    readonly link: NoteLink,
    /** The link's own text (shown when the event is not known). */
    readonly text: string,
    /** Changes when what the chip shows may have (the list reloaded, a minute passed). */
    readonly stamp: string,
  ) {
    super()
  }
  eq(o: EventChip): boolean {
    return o.stamp === this.stamp && o.text === this.text && JSON.stringify(o.link) === JSON.stringify(this.link)
  }
  toDOM(): HTMLElement {
    const box = document.createElement('span')
    box.className = 'cm-ev'
    const now = Date.now()
    const part = (cls: string, text: string, title?: string) => {
      const e = document.createElement('span')
      e.className = cls
      e.textContent = text
      if (title) e.title = title
      return e
    }
    const ic = document.createElement('span')
    ic.className = 'cm-ev-ic'
    box.append(ic)
    const l = this.link
    if (l.kind === 'event') {
      const e = eventOf(l.day, l.id)
      if (!e) {
        ic.innerHTML = iconSvg('calendar', 13)
        box.classList.add(events.value.length ? 'gone' : 'wait')
        box.append(part('cm-ev-t', this.text))
        if (events.value.length) box.append(part('cm-ev-st gone', 'событие удалено'))
        box.title = events.value.length ? 'Этого события больше нет на таймлайне' : ''
      } else {
        const k = kindOf(e.kind)
        ic.innerHTML = iconSvg(k?.icon ?? 'tag', 13)
        if (k?.color) box.style.setProperty('--ev', k.color)
        const st = statusOf(e, now)
        box.append(part('cm-ev-t', e.label || this.text), part('cm-ev-p', `${periodText(e, now)} · ${durText(e.end - e.start)}`), part(`cm-ev-st ${st}`, statusText(e, now)))
        if (e.created) box.append(part('cm-ev-c', `созд. ${dmShort(e.created)}`, `Создано ${new Date(e.created).toLocaleString('ru-RU')}`))
        box.title = `${k?.label ?? e.kind}${e.outlook ? ' · встреча Outlook' : ''}${e.task ? ` · ${e.task}` : ''} — клик: открыть на таймлайне`
        box.onclick = () => window.qa.openMain(e.day, e.id)
      }
    } else {
      const is = issueOf(l.key)
      ic.innerHTML = iconSvg('jira', 13)
      box.style.setProperty('--ev', '#2684ff')
      box.append(part('cm-ev-t', is ? `${is.key} ${is.summary}` : this.text))
      if (is) box.append(part(`cm-ev-st ${is.category === 'done' ? 'done' : is.category === 'indeterminate' ? 'now' : 'ahead'}`, is.status))
      box.title = 'Задача Jira — клик: открыть в браузере'
      box.onclick = () => jiraSite.value && window.qa.openExternal(`${jiraSite.value.replace(/\/$/, '')}/browse/${l.key}`)
    }
    box.onmousedown = (ev) => ev.preventDefault()
    return box
  }
  ignoreEvent(): boolean {
    return true
  }
}
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
      const app = createApp(ThinkingOrb, { state: 'weaving', size: 20, px: 22, tint: 'var(--accent-fg)' })
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
const FORMAT = ICON('<path d="M21 6H3"/><path d="M15 12H3"/><path d="M17 18H3"/>', 15)
/** The bar of a code block (top right, like Obsidian): its language, "Форматировать" (known languages), "Скопировать". */
class CodeBarWidget extends WidgetType {
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
    const btn = (svg: string, title: string, fn: (b: HTMLButtonElement) => void) => {
      const b = document.createElement('button')
      b.className = 'cm-lp-copy'
      b.title = title
      b.innerHTML = svg
      b.onmousedown = (e) => e.preventDefault()
      b.onclick = (e) => {
        e.preventDefault()
        fn(b)
      }
      return b
    }
    if (this.lang) {
      const l = document.createElement('span')
      l.className = 'cm-lp-lang'
      l.textContent = this.lang
      bar.append(l)
    }
    if (this.lang && FORMATTABLE.has(this.lang)) {
      const lang = this.lang
      bar.append(
        btn(FORMAT, 'Форматировать', (b) => {
          const pos = v.posAtDOM(bar)
          void formatBlock(v, pos, lang).then(
            () => {
              b.innerHTML = CHECK
              setTimeout(() => (b.innerHTML = FORMAT), 1200)
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
        }),
      )
    }
    bar.append(
      btn(COPY, 'Скопировать код', (b) => {
        void navigator.clipboard.writeText(this.code).then(() => {
          b.innerHTML = CHECK
          setTimeout(() => (b.innerHTML = COPY), 1200)
        })
      }),
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
function fenceLangs(ctx: CompletionContext): CompletionResult | null {
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
const fencePicker = autocompletion({ override: [fenceLangs], activateOnTyping: true, selectOnOpen: false, icons: false, closeOnBlur: true })

/** Formats the code of the block whose opening fence is at `pos` (one undo step). */
async function formatBlock(v: EditorView, pos: number, lang: string): Promise<void> {
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
    // recordings and [[links]] — not Markdown nodes: by the text of the lines
    for (let pos = from; pos <= to; ) {
      const line = lineOf(pos)
      const m = line.text.match(AUDIO_EMBED)
      const im = line.text.match(IMAGE_EMBED)
      if (inCode(line.from)) {
        // code — as it is
      } else if (im) {
        // the picture; with the cursor on its line — its text, and the picture under it
        if (touched(line.from, line.to)) out.push(Decoration.widget({ widget: new ImageWidget(im[1], true), side: 1 }).range(line.to))
        else out.push(Decoration.replace({ widget: new ImageWidget(im[1], false) }).range(line.from, line.to))
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
/** Pictures put in the note's own lines, at the line of `pos` (after it, when it has text). */
function insertImages(v: EditorView, rels: string[], pos = v.state.selection.main.head): void {
  if (!rels.length) return
  const line = v.state.doc.lineAt(Math.min(pos, v.state.doc.length))
  const body = rels.map(imageEmbed).join('\n')
  const at = line.length ? line.to : line.from
  const ins = (line.length ? '\n' : '') + body + '\n'
  v.dispatch({ changes: { from: at, insert: ins }, selection: { anchor: at + ins.length }, scrollIntoView: true })
  v.focus()
}
const warn = (t: string) => emit('warn', t)
/** A picture pasted (a screenshot, a copied image) or dropped (files, an image from a web page) → the vault. */
const pictures = EditorView.domEventHandlers({
  paste(e, v) {
    const dt = e.clipboardData
    // text goes as text (a table copied from Excel carries a picture of itself too)
    if (!dt || dt.getData('text/plain').trim() || !hasImages(dt)) return false
    e.preventDefault()
    const at = v.state.selection.main.head
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
    void takeImages({ files: [...dt.files], uri }, warn).then((rels) => insertImages(v, rels, pos))
    return true
  },
})
// ---------- «@»: the events to mention ----------
const chipNow = ref(Date.now())
const chipStamp = () => `${eventsTick.value}:${Math.floor(chipNow.value / 30000)}`
interface Picker {
  /** Where «@» is. */
  from: number
  to: number
  query: string
  x: number
  y: number
  up: boolean
}
const picker = ref<Picker>()
const pickIdx = ref(0)
/** «@» closed with Esc: not opened again for it. */
let dismissedAt = -1
const AT = /(?:^|[\s(«"'])@([^\n@]{0,60})$/
function inCodeAt(v: EditorView, pos: number): boolean {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(v.state).resolveInner(pos, -1); n; n = n.parent) if (/Code/.test(n.name)) return true
  return false
}
function checkPicker(v: EditorView): void {
  const sel = v.state.selection.main
  if (!sel.empty) return closePicker()
  const line = v.state.doc.lineAt(sel.head)
  const m = AT.exec(line.text.slice(0, sel.head - line.from))
  if (!m || /\s{2,}$/.test(m[1]) || inCodeAt(v, sel.head)) return closePicker()
  const from = sel.head - m[1].length - 1
  if (from === dismissedAt) return closePicker()
  const c = v.coordsAtPos(from)
  if (!c) return closePicker()
  const up = window.innerHeight - c.bottom < 380 && c.top > window.innerHeight - c.bottom
  if (picker.value?.query !== m[1]) pickIdx.value = 0
  picker.value = { from, to: sel.head, query: m[1], x: Math.min(c.left, window.innerWidth - 500), y: up ? window.innerHeight - c.top + 4 : c.bottom + 4, up }
  void eventsNow()
}
function closePicker(): void {
  picker.value = undefined
}
// the Jira tasks for the query (asked a moment after typing stops)
const jiraHits = shallowRef<JiraIssue[]>([])
let jiraTimer: ReturnType<typeof setTimeout> | undefined
let jiraSeq = 0
watch(
  () => (picker.value ? picker.value.query.trim() : undefined),
  (q) => {
    clearTimeout(jiraTimer)
    if (q === undefined) return void (jiraHits.value = [])
    const my = ++jiraSeq
    jiraTimer = setTimeout(async () => {
      try {
        const r = await window.qa.jiraFind(q, 0, q ? 6 : 3, 'pick')
        if (my === jiraSeq) jiraHits.value = r.items
      } catch {
        if (my === jiraSeq) jiraHits.value = []
      }
    }, 220)
  },
)
type PickRow = { head: string; more?: number } | { ev: EventRef } | { jira: JiraIssue }
const pickRows = computed<PickRow[]>(() => {
  void eventsTick.value
  const p = picker.value
  if (!p) return []
  const g = pickGroups(events.value, p.query, chipNow.value, todayKey.value)
  const out: PickRow[] = []
  const group = (head: string, list: EventRef[], more?: number) => {
    if (!list.length) return
    out.push({ head, more })
    for (const ev of list) out.push({ ev })
  }
  group('Сегодня', g.today)
  group('Запланировано', g.ahead, g.more.ahead)
  group('Ранее', g.past, g.more.past)
  if (jiraHits.value.length) {
    out.push({ head: 'Задачи Jira' })
    for (const jira of jiraHits.value) out.push({ jira })
  }
  return out
})
const pickable = computed(() => pickRows.value.filter((r) => !('head' in r)))
watch(pickable, (l) => pickIdx.value >= l.length && (pickIdx.value = Math.max(0, l.length - 1)))
function pickAt(i: number): void {
  const r = pickable.value[i]
  const p = picker.value
  if (!r || !p || !view) return
  const ins = 'ev' in r ? eventLink(r.ev) : 'jira' in r ? jiraLink(r.jira.key, r.jira.summary) : ''
  view.dispatch({ changes: { from: p.from, to: p.to, insert: `${ins} ` }, selection: { anchor: p.from + ins.length + 1 }, scrollIntoView: true })
  closePicker()
  view.focus()
}
const pickerKeys = Prec.highest(
  keymap.of([
    { key: 'ArrowDown', run: () => (picker.value && pickable.value.length ? ((pickIdx.value = (pickIdx.value + 1) % pickable.value.length), scrollPick(), true) : false) },
    { key: 'ArrowUp', run: () => (picker.value && pickable.value.length ? ((pickIdx.value = (pickIdx.value - 1 + pickable.value.length) % pickable.value.length), scrollPick(), true) : false) },
    { key: 'Enter', run: () => (picker.value && pickable.value.length ? (pickAt(pickIdx.value), true) : false) },
    { key: 'Tab', run: () => (picker.value && pickable.value.length ? (pickAt(pickIdx.value), true) : false) },
    {
      key: 'Escape',
      run: () => {
        if (!picker.value) return false
        dismissedAt = picker.value.from
        closePicker()
        return true
      },
    },
  ]),
)
const pickEl = ref<HTMLElement>()
function scrollPick(): void {
  void nextTick(() => pickEl.value?.querySelector('.pk.on')?.scrollIntoView({ block: 'nearest' }))
}
const rowIndex = (r: PickRow) => pickable.value.indexOf(r)
const kindIcon = (k: string) => kindOf(k)?.icon ?? 'tag'
const kindColor = (k: string) => kindOf(k)?.color ?? 'var(--muted)'
const kindLabel = (k: string) => kindOf(k)?.label ?? k
const dayText = (t: number) => dmShort(t)
// the chips follow the clock and the list
const chipTimer = setInterval(() => {
  chipNow.value = Date.now()
  if (view?.state.doc.toString().includes('qvarch://')) view.dispatch({})
}, 30_000)
onBeforeUnmount(() => clearInterval(chipTimer))
watch(eventsTick, () => view?.dispatch({}))

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
    if (text.trim()) emit('toEvent', text.trim(), { from: r.from, to: r.to })
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
        markdown({ base: markdownLanguage, codeLanguages: CODE_LANGUAGES, extensions: [{ remove: ['SetextHeading'] }] }),
        syntaxHighlighting(mdStyle),
        syntaxHighlighting(codeStyle),
        codeFolding({ placeholderText: '…' }),
        foldGutter({ openText: '▾', closedText: '▸' }),
        indentFold,
        fencePicker,
        highlightSelectionMatches(),
        search({ top: true }),
        phrases,
        theme,
        live,
        clicks,
        pictures,
        pickerKeys,
        contextMenu,
        placeholder('Пишите… # заголовок, **жирный**, - список, - [ ] задача, [[другая заметка]]'),
        keymap.of([
          // ↑ on the first line — up into the note's title
          {
            key: 'ArrowUp',
            run: (v) => {
              const sel = v.state.selection.main
              if (!sel.empty || v.state.doc.lineAt(sel.head).number !== 1) return false
              // a long first line wraps: only from its top row
              const a = v.coordsAtPos(sel.head)
              const b = v.coordsAtPos(0)
              if (a && b && Math.abs(a.top - b.top) > 2) return false
              emit('exitUp')
              return true
            },
          },
        ]),
        keymap.of([{ key: 'Mod-b', run: wrap('**') }, { key: 'Mod-i', run: wrap('*') }, indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) emit('change', u.state.doc.toString())
          if (u.focusChanged && !u.view.hasFocus) closePicker()
          else if (u.transactions.some((t) => t.isUserEvent('input') || t.isUserEvent('delete') || t.isUserEvent('select'))) checkPicker(u.view)
          else if (u.docChanged && picker.value) closePicker()
        }),
      ],
    }),
  })
})
onMounted(() => props.text.includes('qvarch://') && void eventsNow())
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
  /**
   * A piece of the text («В событие») replaced by the event made from it — where it still is (the text may have
   * moved meanwhile), else after the cursor's line.
   */
  linkEvent(at: { from: number; to: number }, text: string, ev: Pick<EventRef, 'day' | 'id' | 'label'>): void {
    if (!view) return
    const doc = view.state.doc.toString()
    const link = eventLink(ev)
    let from = doc.slice(at.from, at.to).trim() === text ? at.from : doc.indexOf(text)
    let to = from >= 0 ? (doc.slice(at.from, at.to).trim() === text ? at.to : from + text.length) : -1
    if (from < 0) {
      from = to = view.state.doc.lineAt(view.state.selection.main.head).to
      view.dispatch({ changes: { from, insert: ` ${link}` } })
      return
    }
    view.dispatch({ changes: { from, to, insert: link }, selection: { anchor: from + link.length } })
  },
  /** Pictures (already in the vault) into the note, at the cursor's line. */
  insertImages(rels: string[]): void {
    if (view) insertImages(view, rels)
  },
  /** The cursor at the very start of the text (coming down from the title). */
  focusStart(): void {
    if (!view) return
    view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true })
    view.focus()
  },
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
    <div v-if="picker" ref="pickEl" class="mde-pick" :class="{ up: picker.up }" :style="{ left: `${picker.x}px`, [picker.up ? 'bottom' : 'top']: `${picker.y}px` }" @mousedown.prevent>
      <template v-for="(r, i) in pickRows" :key="i">
        <div v-if="'head' in r" class="pk-h">{{ r.head }}<span v-if="r.more" class="pk-more">ещё {{ r.more }} — уточните поиск</span></div>
        <button v-else-if="'ev' in r" class="pk" :class="{ on: rowIndex(r) === pickIdx }" @mouseenter="pickIdx = rowIndex(r)" @click="pickAt(rowIndex(r))">
          <span class="pk-ic" :style="{ color: kindColor(r.ev.kind), background: `color-mix(in srgb, ${kindColor(r.ev.kind)} 16%, transparent)` }"><Icon :name="kindIcon(r.ev.kind)" :size="14" /></span>
          <span class="pk-b">
            <span class="pk-t">{{ r.ev.label || 'Без названия' }}</span>
            <span class="pk-m">{{ kindLabel(r.ev.kind) }}<template v-if="r.ev.outlook"> · Outlook</template> · {{ periodText(r.ev, chipNow) }} · {{ durText(r.ev.end - r.ev.start) }}<template v-if="r.ev.created"> · созд. {{ dayText(r.ev.created) }}</template></span>
          </span>
          <span class="pk-st" :class="statusOf(r.ev, chipNow)">{{ statusText(r.ev, chipNow) }}</span>
        </button>
        <button v-else class="pk" :class="{ on: rowIndex(r) === pickIdx }" @mouseenter="pickIdx = rowIndex(r)" @click="pickAt(rowIndex(r))">
          <span class="pk-ic" style="color: #2684ff; background: rgba(38, 132, 255, 0.16)"><Icon name="jira" :size="14" /></span>
          <span class="pk-b">
            <span class="pk-t">{{ r.jira.key }} {{ r.jira.summary }}</span>
            <span class="pk-m">{{ r.jira.type }} · {{ r.jira.project.name }}</span>
          </span>
          <span class="pk-st" :class="r.jira.category === 'done' ? 'done' : r.jira.category === 'indeterminate' ? 'now' : 'ahead'">{{ r.jira.status }}</span>
        </button>
      </template>
      <p v-if="!pickRows.length" class="pk-empty">{{ events.length ? 'Ничего не нашлось' : 'Загружаю события…' }}</p>
      <div class="pk-f">↑↓ — выбрать · Enter — вставить · Esc — закрыть · пишите дальше — поиск</div>
    </div>
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
.mde-pick {
  position: fixed;
  z-index: 5000;
  display: flex;
  flex-direction: column;
  width: 480px;
  max-width: calc(100vw - 16px);
  max-height: 360px;
  padding: 4px;
  overflow-y: auto;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
  font-family: var(--font-ui);
}
.mde-pick .pk-h {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 8px 4px;
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.mde-pick .pk-more {
  color: var(--dim);
  font-family: var(--font-ui);
  letter-spacing: 0;
  text-transform: none;
}
.mde-pick .pk {
  flex: none;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  text-align: left;
}
.mde-pick .pk.on {
  background: rgb(var(--accent-rgb) / 0.14);
}
.mde-pick .pk-ic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--r2);
}
.mde-pick .pk-b {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.mde-pick .pk-t,
.mde-pick .pk-m {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mde-pick .pk-t {
  font-size: 13px;
}
.mde-pick .pk-m {
  color: var(--muted);
  font-size: 11.5px;
}
.mde-pick .pk-st,
.cm-ev-st {
  padding: 1px 7px;
  border-radius: 10px;
  font-size: 11px;
  white-space: nowrap;
}
.mde-pick .pk-st.done,
.cm-ev-st.done {
  background: rgba(148, 163, 184, 0.14);
  color: var(--text-2);
}
.mde-pick .pk-st.now,
.cm-ev-st.now {
  background: rgba(0, 230, 118, 0.16);
  color: var(--up-fg);
}
.mde-pick .pk-st.ahead,
.cm-ev-st.ahead {
  background: rgba(56, 189, 248, 0.15);
  color: var(--info-fg, #7dd3fc);
}
.cm-ev-st.gone {
  background: rgba(248, 113, 113, 0.14);
  color: var(--down-fg);
}
.mde-pick .pk-empty {
  margin: 0;
  padding: 14px 10px;
  color: var(--muted);
  font-size: 12.5px;
}
.mde-pick .pk-f {
  position: sticky;
  bottom: -4px;
  margin: 4px -4px -4px;
  padding: 6px 12px;
  border-top: 1px solid var(--border);
  background: var(--pop);
  color: var(--dim);
  font-size: 11px;
}
.qa-lightbox {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.82);
  cursor: zoom-out;
}
.qa-lightbox img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
}
/* the right-click menu (teleported) */
.mde-menu {
  position: fixed;
  z-index: 5000;
  min-width: 200px;
  padding: 5px;
  display: flex;
  flex-direction: column;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: var(--panel-2);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55);
}
.mde-menu button {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 9px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
  cursor: default;
}
.mde-menu button:hover:not(:disabled) {
  background: rgb(var(--accent-rgb) / 0.18);
}
.mde-menu button:disabled {
  opacity: 0.4;
}
.mde-menu button svg {
  flex: none;
  color: var(--muted);
}
.mde-menu .ev svg {
  color: var(--accent-fg);
}
.mde-menu kbd {
  margin-left: auto;
  padding-left: 18px;
  color: var(--dim);
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
.mde :deep(.cm-ev) {
  --ev: var(--accent);
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 100%;
  margin: 1px 0;
  padding: 1px 8px 1px 3px;
  border: 1px solid color-mix(in srgb, var(--ev) 45%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--ev) 9%, transparent);
  vertical-align: baseline;
  line-height: 1.5;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}
.mde :deep(.cm-ev:hover) {
  background: color-mix(in srgb, var(--ev) 18%, transparent);
}
.mde :deep(.cm-ev-ic) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--ev) 22%, transparent);
  color: var(--ev);
}
.mde :deep(.cm-ev-t) {
  overflow: hidden;
  color: var(--text-hi);
  font-size: 0.95em;
  font-weight: 500;
  text-overflow: ellipsis;
}
.mde :deep(.cm-ev-p),
.mde :deep(.cm-ev-c) {
  color: var(--muted);
  font-size: 0.8em;
}
.mde :deep(.cm-ev.gone .cm-ev-t) {
  color: var(--muted);
  text-decoration: line-through;
}
.mde :deep(.cm-ev.wait) {
  opacity: 0.6;
}
.mde :deep(.cm-img) {
  display: inline-block;
  max-width: 100%;
  margin: 4px 0;
  vertical-align: top;
  line-height: 0;
}
/* under its line's text: a row of its own */
.mde :deep(.cm-img.under) {
  width: 100%;
  margin-top: 6px;
}
.mde :deep(.cm-img-in) {
  position: relative;
  display: inline-block;
  max-width: 100%;
}
.mde :deep(.cm-img img) {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  cursor: zoom-in;
  box-shadow: 0 0 0 1px var(--border);
}
.mde :deep(.cm-img.missing) {
  padding: 10px 12px;
  border: 1px dashed var(--border-2);
  border-radius: 6px;
  color: var(--muted);
  font-size: 0.85em;
  line-height: 1.4;
}
.mde :deep(.cm-img-bar) {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.12s;
}
.mde :deep(.cm-img-in:hover .cm-img-bar) {
  opacity: 1;
}
.mde :deep(.cm-img-bar button) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: rgba(15, 17, 23, 0.78);
  color: #e6e9f2;
  line-height: 1;
}
.mde :deep(.cm-img-bar button:hover) {
  background: rgba(15, 17, 23, 0.95);
  color: #fff;
}
.mde :deep(.cm-audio) {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 8px;
  margin: 2px 0;
  border-radius: 4px;
  border: 1px solid rgb(var(--accent-rgb) / 0.35);
  background: rgb(var(--accent-rgb) / 0.08);
  vertical-align: middle;
  font-size: 12px;
}
.mde :deep(.cm-audio.missing) {
  border-color: rgba(255, 61, 61, 0.5);
  opacity: 0.7;
}
.mde :deep(.cm-audio-ic) {
  display: inline-flex;
  color: var(--accent-fg);
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
  border-radius: var(--r2);
  background: transparent;
  color: var(--accent-fg);
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
  background: rgb(var(--accent-rgb) / 0.18);
}
.mde :deep(.cm-audio .cm-audio-del) {
  color: var(--down-fg);
}
.mde :deep(.cm-audio .cm-audio-del:hover) {
  background: rgba(255, 61, 61, 0.15);
}
.mde :deep(.cm-audio button:disabled) {
  opacity: 0.6;
  cursor: default;
}
</style>

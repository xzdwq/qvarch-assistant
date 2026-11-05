import { computed, nextTick, reactive, ref, shallowRef, watch } from 'vue'
import { Prec, Transaction } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { startCompletion } from '@codemirror/autocomplete'
import { eventLink, jiraLink } from '@shared/noteEvents'
import { boardMd } from '@nb/blocks/board/model'
import { chatFeedMd, chatMd } from '@nb/blocks/chat/model'
import { spaceOfPath } from '@nb/workspace/sharedDocs'
import { newTable, tableMd } from '@nb/blocks/table/model'
import { TABLE_VAR_BASE } from '@nb/domain/tableVars'
import type { CommandEffect } from '@nb/commands/command'
import { pickerMode } from '@nb/commands/registry'
import { eventsNow } from '@renderer/lib/noteEvents'
import { searchEmoji, useEmoji, type Emoji } from '@renderer/lib/emoji'
import { focusNewBlock } from '../components/componentWidget'
import { COMPONENT_INPUT, editorHost } from '../editorHost'
import { commandContext, loadDbConnections } from './commandContext'
import { createBoard, createChat } from './menuCreate'
import { useMenuRows } from './menuRows'

/**
 * The note's «@» menu (as Notion's «/»): opened by «@» in the text, it offers what to insert (the commands), emoji,
 * boards, the events and Jira tasks to mention (menuRows) — and turns into a sub-menu of its own for emoji and a
 * table's size. Its state for the CommandMenu component (a popover at the «@»), its keys and its following of the
 * text as an editor extension.
 */
export interface MenuPlace {
  /** Where «@» is (and the query after it ends). */
  from: number
  to: number
  query: string
  /** The menu's corner: its left edge, and its top (under the «@») or its bottom (over it — `up`). */
  x: number
  y: number
  up: boolean
  /** The height it has room for inside the note's pane, px (it scrolls within). */
  room: number
}

/** «@» right before the cursor, and the query typed after it. */
const AT = /(?:^|[\s(«"'])@([^\n@]{0,60})$/
const EMOJI_COLS = 10
/** The menu's width and the room under the «@» it wants (else it opens over it). */
const MENU_W = 500
const MENU_ROOM = 380
/** Never shorter than a couple of rows (a pane too short for more — it scrolls). */
const MENU_MIN_H = 120

/** The cursor is in code (a fence, inline code): «@» there is code, not the menu. */
function inCodeAt(v: EditorView, pos: number): boolean {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(v.state).resolveInner(pos, -1); n; n = n.parent) if (/Code/.test(n.name)) return true
  return false
}

/** The part of the page an element is seen in: the window cut by every scrolling box around it (the note's pane). */
function seenBox(el: HTMLElement): { top: number; bottom: number; left: number; right: number } {
  const box = { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth }
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (!/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowY)) continue
    const r = p.getBoundingClientRect()
    box.top = Math.max(box.top, r.top)
    box.bottom = Math.min(box.bottom, r.bottom)
    box.left = Math.max(box.left, r.left)
    box.right = Math.min(box.right, r.right)
  }
  return box
}
/**
 * Where the menu stands for a «@» at `pos`: under it, or over it when the note's pane has more room there; none —
 * the «@» is not in sight (scrolled out of the pane) — the menu does not hang over the rest of the window.
 */
function placeAt(v: EditorView, pos: number): Pick<MenuPlace, 'x' | 'y' | 'up' | 'room'> | undefined {
  const c = v.coordsAtPos(pos)
  const box = seenBox(v.dom)
  if (!c || c.bottom <= box.top || c.top >= box.bottom) return undefined
  const below = box.bottom - c.bottom
  const above = c.top - box.top
  const up = below < MENU_ROOM && above > below
  const x = Math.max(box.left, Math.min(c.left, box.right - MENU_W))
  return { x, y: up ? window.innerHeight - c.top + 4 : c.bottom + 4, up, room: Math.max(MENU_MIN_H, (up ? above : below) - 8) }
}

export function useCommandMenu(getView: () => EditorView | undefined) {
  loadDbConnections()
  const place = ref<MenuPlace>()
  const pickIdx = ref(0)
  /** The emoji picked in the emoji row of the list (← →). */
  const stripIdx = ref(0)
  /** The emoji picked in the emoji grid. */
  const emojiIdx = ref(0)
  /** A new table's size (the grid). */
  const size = ref({ c: 3, r: 3 })
  /** The list's element (it scrolls to the row picked). */
  const listEl = shallowRef<HTMLElement>()
  /** «@» closed with Esc: not opened again for it. */
  let dismissedAt = -1

  // ---------- opening, following, closing ----------
  /** The menu opened / moved / closed by the text before the cursor. */
  function follow(v: EditorView): void {
    const sel = v.state.selection.main
    if (!sel.empty) return close()
    const line = v.state.doc.lineAt(sel.head)
    const m = AT.exec(line.text.slice(0, sel.head - line.from))
    if (!m || /\s{2,}$/.test(m[1]) || inCodeAt(v, sel.head)) return close()
    const from = sel.head - m[1].length - 1
    if (from === dismissedAt) return close()
    const at = placeAt(v, from)
    if (!at) return close()
    if (place.value?.query !== m[1]) pickIdx.value = 0
    place.value = { from, to: sel.head, query: m[1], ...at }
    void eventsNow()
  }
  function close(): void {
    place.value = undefined
  }
  /** The text scrolled (by the person, or by the editor itself while typing): the menu moves with its «@»; out of sight — false. */
  function keepAtAt(): boolean {
    const v = getView()
    const p = place.value
    const at = v && p && placeAt(v, p.from)
    if (!p || !at) return false
    place.value = { ...p, ...at }
    return true
  }
  /** Esc: closed, and not opened again for this «@» (the popover layer asks — true: Esc is the menu's). */
  function dismiss(): boolean {
    if (place.value) dismissedAt = place.value.from
    return true
  }
  /** The popover is open while there is a place; closed by it (a press outside, a scroll, Esc) — the place cleared. */
  const open = computed({
    get: () => !!place.value,
    set: (on) => void (on || close()),
  })

  // ---------- what it offers ----------
  /** «@эмодзи …» / «@таблица» / «@доска»: a sub-menu of its own. */
  const mode = computed(() => (place.value ? pickerMode(place.value.query) : undefined))
  /** The space of the note being edited (a shared note's). */
  function noteSpace() {
    const v = getView()
    return v ? spaceOfPath(v.state.facet(editorHost).notePath()) : undefined
  }
  const { rows, emojiAll } = useMenuRows(
    () => place.value?.query,
    () => mode.value,
    noteSpace,
  )
  /** The rows that can be picked (not the group heads). */
  const pickable = computed(() => rows.value.filter((r) => !('head' in r)))
  watch(pickable, (l) => pickIdx.value >= l.length && (pickIdx.value = Math.max(0, l.length - 1)))
  watch(pickIdx, () => (stripIdx.value = 0))
  const emojiShown = computed(() => (mode.value?.mode === 'emoji' ? searchEmoji(emojiAll.value, mode.value.q, 400) : []))
  watch(
    () => (mode.value?.mode === 'emoji' ? mode.value.q : undefined),
    () => (emojiIdx.value = 0),
  )
  watch(
    () => (mode.value?.mode === 'table' ? mode.value : undefined),
    (m) => m && (size.value = { c: Math.min(10, Math.max(1, m.c ?? size.value.c)), r: Math.min(12, Math.max(2, m.r ?? size.value.r)) }),
  )

  // ---------- what a pick does ----------
  /** «@…» replaced by a text (the menu stays when asked: a sub-menu of its own). */
  function replaceQuery(text: string, keepMenu = false): void {
    const p = place.value
    const v = getView()
    if (!p || !v) return
    v.dispatch({ changes: { from: p.from, to: p.to, insert: text }, selection: { anchor: p.from + text.length }, scrollIntoView: true })
    if (keepMenu) follow(v)
    else close()
    v.focus()
  }
  /** A component put on lines of its own where «@» was (the text around it stays on its own lines); it takes the focus. */
  function insertBlock(md: string): void {
    const p = place.value
    const v = getView()
    if (!p || !v) return
    const line = v.state.doc.lineAt(p.from)
    const before = v.state.sliceDoc(line.from, p.from)
    const after = v.state.sliceDoc(p.to, line.to)
    const from = before.trim() ? p.from : line.from
    const to = after.trim() ? p.to : line.to
    // a blank line before (other Markdown editors want a table / a fence apart from a paragraph) and a line
    // after it, always — to write on after the component (the rest of the line goes there)
    const prev = line.number > 1 ? v.state.doc.line(line.number - 1).text : ''
    const ins = `${before.trim() ? '\n\n' : prev.trim() ? '\n' : ''}${md}\n`
    v.dispatch({ changes: { from, to, insert: ins }, selection: { anchor: from + ins.length }, effects: focusNewBlock.of(from + ins.length - md.length - 1), annotations: Transaction.userEvent.of(COMPONENT_INPUT), scrollIntoView: true })
    close()
  }
  /** What a command asked for, carried out. */
  function applyEffect(e: CommandEffect): void {
    switch (e.kind) {
      case 'insertBlock':
        return insertBlock(e.markdown)
      case 'insertText': {
        replaceQuery(e.text, e.keepMenu)
        const v = getView()
        if (e.complete && v) startCompletion(v)
        return
      }
      case 'request': {
        replaceQuery('')
        const host = getView()?.state.facet(editorHost)
        switch (e.action) {
          case 'record':
            return host?.requestRecording()
          case 'pickImage':
            return host?.requestImage()
        }
      }
    }
  }
  const warn = (msg: string) => getView()?.state.facet(editorHost).warn(msg)
  /** The row picked (by its index among the pickable rows) carried out. */
  function pickAt(i: number): void {
    const r = pickable.value[i]
    const p = place.value
    const v = getView()
    if (!r || !p || !v) return
    const notePath = v.state.facet(editorHost).notePath()
    if ('cmd' in r) return applyEffect(r.cmd.run(commandContext(v, notePath, p.query)))
    if ('emojis' in r) return pickEmoji(r.emojis[Math.min(stripIdx.value, r.emojis.length - 1)])
    if ('board' in r) return insertBlock(boardMd(r.board, 'edit'))
    if ('newBoard' in r) return void createBoard(r.newBoard, notePath, insertBlock)
    if ('chatRoom' in r) return insertBlock(chatMd(r.chatRoom.id))
    if ('newChat' in r) return void createChat(r.newChat, notePath, insertBlock, warn)
    if ('chatFeed' in r) return insertBlock(chatFeedMd())
    const ins = 'ev' in r ? eventLink(r.ev) : 'jira' in r ? jiraLink(r.jira.key, r.jira.summary) : ''
    v.dispatch({ changes: { from: p.from, to: p.to, insert: `${ins} ` }, selection: { anchor: p.from + ins.length + 1 }, scrollIntoView: true })
    close()
    v.focus()
  }
  function pickEmoji(e: Emoji | undefined): void {
    if (!e) return
    useEmoji(e.u)
    replaceQuery(e.u)
  }
  /** A new table, named at once (its variable in the note). */
  function pickTable(): void {
    const v = getView()
    const name = v ? commandContext(v, v.state.facet(editorHost).notePath(), '').freeName(TABLE_VAR_BASE) : undefined
    insertBlock(tableMd({ ...newTable(size.value.c, size.value.r), name }))
  }

  // ---------- keys ----------
  /** The arrows in a grid (emoji / sizes) or along the emoji row; false — not in one. */
  function gridMove(dx: number, dy: number): boolean {
    const m = mode.value?.mode
    if (m === 'emoji') {
      const n = emojiShown.value.length
      if (!n) return true
      emojiIdx.value = Math.min(n - 1, Math.max(0, emojiIdx.value + dx + dy * EMOJI_COLS))
      void nextTick(() => listEl.value?.querySelector('.em.on')?.scrollIntoView({ block: 'nearest' }))
      return true
    }
    if (m === 'table') {
      size.value = { c: Math.min(10, Math.max(1, size.value.c + dx)), r: Math.min(12, Math.max(2, size.value.r + dy)) }
      return true
    }
    // the emoji row of the list: ← → move along it
    const row = pickable.value[pickIdx.value]
    if (dx && row && 'emojis' in row) {
      stripIdx.value = Math.min(row.emojis.length - 1, Math.max(0, stripIdx.value + dx))
      return true
    }
    return false
  }
  /** Enter in a grid: its pick; false — not in one. */
  function gridEnter(): boolean {
    const m = mode.value?.mode
    if (m === 'emoji') {
      pickEmoji(emojiShown.value[emojiIdx.value])
      return true
    }
    if (m === 'table') {
      pickTable()
      return true
    }
    return false
  }
  function scrollToPick(): void {
    if (pickIdx.value === 0 && listEl.value) listEl.value.scrollTop = 0
    void nextTick(() => listEl.value?.querySelector('.pk.on')?.scrollIntoView({ block: 'nearest' }))
  }
  const step = (d: number) => {
    const n = pickable.value.length
    if (!place.value || !n) return false
    pickIdx.value = (pickIdx.value + d + n) % n
    scrollToPick()
    return true
  }
  const pickNow = () => (!!place.value && gridEnter()) || (!!place.value && !!pickable.value.length && (pickAt(pickIdx.value), true))
  // (Esc is the popover layer's: the last thing opened closes first)
  const keys = Prec.highest(
    keymap.of([
      { key: 'ArrowLeft', run: () => !!place.value && gridMove(-1, 0) },
      { key: 'ArrowRight', run: () => !!place.value && gridMove(1, 0) },
      { key: 'ArrowDown', run: () => (!!place.value && gridMove(0, 1)) || step(1) },
      { key: 'ArrowUp', run: () => (!!place.value && gridMove(0, -1)) || step(-1) },
      { key: 'Enter', run: pickNow },
      { key: 'Tab', run: pickNow },
    ]),
  )
  /** The menu follows the typing: opened / moved by input, deletion and selection; closed when the editor loses the focus. */
  const following = EditorView.updateListener.of((u) => {
    if (u.focusChanged && !u.view.hasFocus) close()
    else if (u.transactions.some((t) => t.isUserEvent('input') || t.isUserEvent('delete') || t.isUserEvent('select'))) follow(u.view)
    else if (u.docChanged && place.value) close()
  })

  return {
    /** The menu's state and actions for the CommandMenu component (reactive: its refs read as values). */
    menu: reactive({ place, open, dismiss, keepAtAt, pickIdx, stripIdx, emojiIdx, size, listEl, mode, rows, pickable, emojiAll, emojiShown, pickAt, pickEmoji, pickTable }),
    /** Its keys (over the editor's own) and its following of the text — for the editor's extensions. */
    extensions: [keys, following],
  }
}
export type CommandMenuState = ReturnType<typeof useCommandMenu>['menu']

import { computed, nextTick, onBeforeUnmount, reactive, ref, shallowRef, watch } from 'vue'
import { Prec, Transaction } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { startCompletion } from '@codemirror/autocomplete'
import { eventLink, jiraLink, pickGroups, type EventRef } from '@shared/noteEvents'
import type { JiraIssue } from '@shared/jira'
import { boardMd } from '@nb/blocks/board/model'
import { chatFeedMd, chatMd } from '@nb/blocks/chat/model'
import { chatTitleOf, isComment, type ChatRoom } from '@shared/transport/chat'
import { chatOnline, chatRooms } from '@renderer/lib/chat'
import { serverCall } from '@renderer/lib/transport'
import { createChat as newOwnChat } from '@renderer/lib/chatActions'
import { ROLE_RIGHTS } from '@shared/transport/space'
import { noteName } from '@nb/domain/notePaths'
import { spaceOfPath } from '@nb/workspace/sharedDocs'
import { newTable, tableMd } from '@nb/blocks/table/model'
import { TABLE_VAR_BASE } from '@nb/domain/tableVars'
import type { CommandEffect, NoteCommand } from '@nb/commands/command'
import { matchCommands, pickerMode } from '@nb/commands/registry'
import { events, eventsNow, eventsTick } from '@renderer/lib/noteEvents'
import { todayKey } from '@renderer/lib/today'
import { loadTree, tree } from '@renderer/lib/notebook'
import { freshBoard } from '@renderer/lib/boardPrefs'
import { serializeBoard } from '@shared/whiteboard'
import { visibleRect } from '@renderer/lib/floating'
import { loadEmoji, searchEmoji, useEmoji, type Emoji } from '@renderer/lib/emoji'
import { focusNewBlock } from '../components/componentWidget'
import { COMPONENT_INPUT, editorHost } from '../editorHost'
import { chipClock } from '../eventChips'
import { commandContext, loadDbConnections } from './commandContext'

/**
 * The note's «@» menu (as Notion's «/»): opened by «@» in the text, it offers what to insert (the commands), emoji,
 * boards, the events and Jira tasks to mention — and turns into a sub-menu of its own for emoji and a table's size.
 * Its state for the CommandMenu component, its keys and its following of the text as an editor extension.
 */
export interface MenuPlace {
  /** Where «@» is (and the query after it ends). */
  from: number
  to: number
  query: string
  x: number
  y: number
  up: boolean
}
export type MenuRow = { head: string; more?: number } | { cmd: NoteCommand } | { emojis: Emoji[] } | { board: string } | { newBoard: string } | { chatRoom: ChatRoom } | { newChat: string } | { chatFeed: true } | { ev: EventRef } | { jira: JiraIssue }

/** «@» right before the cursor, and the query typed after it. */
const AT = /(?:^|[\s(«"'])@([^\n@]{0,60})$/
const EMOJI_COLS = 10

/** The cursor is in code (a fence, inline code): «@» there is code, not the menu. */
function inCodeAt(v: EditorView, pos: number): boolean {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(v.state).resolveInner(pos, -1); n; n = n.parent) if (/Code/.test(n.name)) return true
  return false
}
/** Every board of the notebook (its path). */
function allBoards(): string[] {
  const out: string[] = []
  const walk = (ns: typeof tree.value) => ns.forEach((n) => (n.dir ? walk(n.children ?? []) : n.board && out.push(n.path)))
  walk(tree.value)
  return out
}
/** The boards a query names (all — for an empty one). */
function boardsFor(q: string): string[] {
  const w = q.toLowerCase().split(/\s+/).filter(Boolean)
  return allBoards().filter((p) => w.every((x) => p.toLowerCase().includes(x)))
}
/**
 * The chats a note may hold that a query names (all — for an empty one): a shared note — its space's chats (the
 * others of it see them), any other note — the chats of no space.
 */
function chatsFor(q: string, space?: string): ChatRoom[] {
  const w = q.toLowerCase().split(/\s+/).filter(Boolean)
  return chatRooms.value.filter((r) => r.space === space && !isComment(r) && w.every((x) => `${r.title} ${r.members.map((m) => m.name).join(' ')}`.toLowerCase().includes(x)))
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
    const c = v.coordsAtPos(from)
    if (!c) return close()
    const up = window.innerHeight - c.bottom < 380 && c.top > window.innerHeight - c.bottom
    if (place.value?.query !== m[1]) pickIdx.value = 0
    place.value = { from, to: sel.head, query: m[1], x: Math.min(c.left, window.innerWidth - 500), y: up ? window.innerHeight - c.top + 4 : c.bottom + 4, up }
    void eventsNow()
  }
  function close(): void {
    place.value = undefined
  }
  /** The note scrolled while the menu is open: the menu goes with the «@» (out of sight — closed). */
  function onScroll(e: Event): void {
    const v = getView()
    if (!place.value || !v || (e.target instanceof Element && e.target.closest('.mde-pick'))) return
    const c = v.coordsAtPos(place.value.from)
    const box = visibleRect(v.contentDOM)
    if (!c || !box || c.bottom < box.top || c.top > box.bottom) return close()
    follow(v)
  }
  watch(
    () => !!place.value,
    (on) => (on ? window.addEventListener('scroll', onScroll, true) : window.removeEventListener('scroll', onScroll, true)),
  )
  onBeforeUnmount(() => window.removeEventListener('scroll', onScroll, true))

  // ---------- what it offers ----------
  // the Jira tasks for the query (asked a moment after typing stops)
  const jiraHits = shallowRef<JiraIssue[]>([])
  let jiraTimer: ReturnType<typeof setTimeout> | undefined
  let jiraSeq = 0
  watch(
    () => (place.value ? place.value.query.trim() : undefined),
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
  const emojiAll = shallowRef<Emoji[]>([])
  watch(
    () => !!place.value,
    (on) => on && !emojiAll.value.length && void loadEmoji().then((l) => (emojiAll.value = l)),
  )
  /** «@эмодзи …» / «@таблица» / «@доска»: a sub-menu of its own. */
  const mode = computed(() => (place.value ? pickerMode(place.value.query) : undefined))
  const rows = computed<MenuRow[]>(() => {
    void eventsTick.value
    const p = place.value
    if (!p) return []
    const out: MenuRow[] = []
    // «@доска …»: the boards only
    if (mode.value?.mode === 'board') {
      const bs = boardsFor(mode.value.q)
      out.push({ head: 'Доски' })
      out.push({ newBoard: mode.value.q.trim() })
      for (const board of bs.slice(0, 50)) out.push({ board })
      return out
    }
    // «@чат …»: the chats only
    if (mode.value?.mode === 'chat') {
      const space = noteSpace()
      const cs = chatsFor(mode.value.q, space?.id)
      if (!chatOnline.value) out.push({ head: 'Чаты — сервер не подключён (Настройки → Сервер и чат)' })
      else if (space) out.push({ head: 'Чаты документа' }, ...(ROLE_RIGHTS[space.role].chat ? [{ newChat: mode.value.q.trim() }] : []))
      // a plain note: a new chat of one's own (people are added from its head)
      else out.push({ head: 'Чаты' }, { newChat: mode.value.q.trim() })
      // every chat in one place — wherever one wants it
      out.push({ chatFeed: true })
      for (const chatRoom of cs.slice(0, 50)) out.push({ chatRoom })
      return out
    }
    const g = pickGroups(events.value, p.query, chipClock.value, todayKey.value)
    const cmds = matchCommands(p.query)
    if (cmds.length) {
      out.push({ head: 'Вставить' })
      for (const cmd of cmds) out.push({ cmd })
    }
    // one search through everything: emoji and boards by name come right here too
    const q = p.query.trim()
    if (q.length >= 2) {
      const em = searchEmoji(emojiAll.value, q, 12)
      if (em.length) {
        out.push({ head: 'Эмодзи' })
        out.push({ emojis: em })
      }
      const bs = boardsFor(q).slice(0, 5)
      if (bs.length) {
        out.push({ head: 'Доски' })
        for (const board of bs) out.push({ board })
      }
      const cs = chatsFor(q, noteSpace()?.id).slice(0, 3)
      if (cs.length) {
        out.push({ head: 'Чаты' })
        for (const chatRoom of cs) out.push({ chatRoom })
      }
    }
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
    v.dispatch({ changes: { from, to, insert: ins }, selection: { anchor: from + ins.length }, effects: focusNewBlock.of(md), annotations: Transaction.userEvent.of(COMPONENT_INPUT), scrollIntoView: true })
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
  /** The row picked (by its index among the pickable rows) carried out. */
  function pickAt(i: number): void {
    const r = pickable.value[i]
    const p = place.value
    const v = getView()
    if (!r || !p || !v) return
    if ('cmd' in r) return applyEffect(r.cmd.run(commandContext(v, v.state.facet(editorHost).notePath(), p.query)))
    if ('emojis' in r) return pickEmoji(r.emojis[Math.min(stripIdx.value, r.emojis.length - 1)])
    if ('board' in r) return insertBlock(boardMd(r.board, 'edit'))
    if ('newBoard' in r) return void createBoard(r.newBoard, v.state.facet(editorHost).notePath())
    if ('chatRoom' in r) return insertBlock(chatMd(r.chatRoom.id))
    if ('newChat' in r) return void createChat(r.newChat, v.state.facet(editorHost).notePath())
    if ('chatFeed' in r) return insertBlock(chatFeedMd())
    const ins = 'ev' in r ? eventLink(r.ev) : 'jira' in r ? jiraLink(r.jira.key, r.jira.summary) : ''
    v.dispatch({ changes: { from: p.from, to: p.to, insert: `${ins} ` }, selection: { anchor: p.from + ins.length + 1 }, scrollIntoView: true })
    close()
    v.focus()
  }
  /** A new board next to the note (named as typed after «@доска»), put in to be drawn on right there. */
  async function createBoard(name: string, notePath: string): Promise<void> {
    const dir = notePath.split('/').slice(0, -1).join('/')
    const path = await window.qa.vaultCreate(dir, 'board', name || undefined, serializeBoard(freshBoard()))
    await loadTree()
    insertBlock(boardMd(path, 'edit'))
  }
  /** The space of the note being edited (a shared note's). */
  function noteSpace() {
    const v = getView()
    return v ? spaceOfPath(v.state.facet(editorHost).notePath()) : undefined
  }
/** A new chat put in: a shared note's — of its space (its members); a plain note's — one's own alone (people added later). */
  async function createChat(title: string, notePath: string): Promise<void> {
    const space = spaceOfPath(notePath)
    const name = title || chatTitleOf(noteName(notePath), new Date())
    const made = space ? serverCall('space.chat', { space: space.id, title: name }) : newOwnChat(name)
    const room = await made.catch((e: Error) => (getView()?.state.facet(editorHost).warn(e.message), undefined))
    if (room) insertBlock(chatMd(room.id))
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
  const keys = Prec.highest(
    keymap.of([
      { key: 'ArrowLeft', run: () => !!place.value && gridMove(-1, 0) },
      { key: 'ArrowRight', run: () => !!place.value && gridMove(1, 0) },
      { key: 'ArrowDown', run: () => (!!place.value && gridMove(0, 1)) || step(1) },
      { key: 'ArrowUp', run: () => (!!place.value && gridMove(0, -1)) || step(-1) },
      { key: 'Enter', run: () => (!!place.value && gridEnter()) || (!!place.value && !!pickable.value.length && (pickAt(pickIdx.value), true)) },
      { key: 'Tab', run: () => (!!place.value && gridEnter()) || (!!place.value && !!pickable.value.length && (pickAt(pickIdx.value), true)) },
      {
        key: 'Escape',
        run: () => {
          if (!place.value) return false
          dismissedAt = place.value.from
          close()
          return true
        },
      },
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
    menu: reactive({ place, pickIdx, stripIdx, emojiIdx, size, listEl, mode, rows, pickable, emojiAll, emojiShown, pickAt, pickEmoji, pickTable }),
    /** Its keys (over the editor's own) and its following of the text — for the editor's extensions. */
    extensions: [keys, following],
  }
}
export type CommandMenuState = ReturnType<typeof useCommandMenu>['menu']

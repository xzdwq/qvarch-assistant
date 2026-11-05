import { computed, shallowRef, watch, type Ref } from 'vue'
import { pickGroups, type EventRef } from '@shared/noteEvents'
import type { JiraIssue } from '@shared/jira'
import { isComment, type ChatRoom } from '@shared/transport/chat'
import { ROLE_RIGHTS, type Space } from '@shared/transport/space'
import { chatOnline, chatRooms } from '@renderer/lib/chat'
import { events, eventsTick } from '@renderer/lib/noteEvents'
import { todayKey } from '@renderer/lib/today'
import { loadEmoji, searchEmoji, type Emoji } from '@renderer/lib/emoji'
import type { NoteCommand } from '@nb/commands/command'
import { matchCommands, type PickerMode } from '@nb/commands/registry'
import { tree } from '@nb/workspace/vaultTreeStore'
import { chipClock } from '../eventChips'

/**
 * What the «@» menu offers for its query: the commands, emoji, boards, chats, the events and Jira tasks to mention —
 * each source its own provider; a sub-menu («@доска», «@чат») — its own list only.
 */
export type MenuRow = { head: string; more?: number } | { cmd: NoteCommand } | { emojis: Emoji[] } | { board: string } | { newBoard: string } | { chatRoom: ChatRoom } | { newChat: string } | { chatFeed: true } | { ev: EventRef } | { jira: JiraIssue }

/** Words of a query (lower case). */
const wordsOf = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean)

/** Every board of the notebook (its path). */
function allBoards(): string[] {
  const out: string[] = []
  const walk = (ns: typeof tree.value) => ns.forEach((n) => (n.dir ? walk(n.children ?? []) : n.board && out.push(n.path)))
  walk(tree.value)
  return out
}
/** The boards a query names (all — for an empty one). */
function boardsFor(q: string): string[] {
  const w = wordsOf(q)
  return allBoards().filter((p) => w.every((x) => p.toLowerCase().includes(x)))
}
/**
 * The chats a note may hold that a query names (all — for an empty one): a shared note — its space's chats (the
 * others of it see them), any other note — the chats of no space.
 */
function chatsFor(q: string, space?: string): ChatRoom[] {
  const w = wordsOf(q)
  return chatRooms.value.filter((r) => r.space === space && !isComment(r) && w.every((x) => `${r.title} ${r.members.map((m) => m.name).join(' ')}`.toLowerCase().includes(x)))
}

/** The Jira tasks for the query (asked a moment after typing stops; none — the menu closed). */
function useJiraHits(query: () => string | undefined): Ref<JiraIssue[]> {
  const hits = shallowRef<JiraIssue[]>([])
  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0
  watch(query, (q) => {
    clearTimeout(timer)
    if (q === undefined) return void (hits.value = [])
    const my = ++seq
    timer = setTimeout(async () => {
      try {
        const r = await window.qa.jiraFind(q, 0, q ? 6 : 3, 'pick')
        if (my === seq) hits.value = r.items
      } catch {
        if (my === seq) hits.value = []
      }
    }, 220)
  })
  return hits
}
/** Every emoji (loaded the first time the menu opens). */
function useEmojiList(open: () => boolean): Ref<Emoji[]> {
  const all = shallowRef<Emoji[]>([])
  watch(open, (on) => on && !all.value.length && void loadEmoji().then((l) => (all.value = l)))
  return all
}

/** «@доска …»: the boards only. */
function boardRows(q: string): MenuRow[] {
  return [{ head: 'Доски' }, { newBoard: q.trim() }, ...boardsFor(q).slice(0, 50).map((board) => ({ board }))]
}
/** «@чат …»: the chats only. */
function chatRows(q: string, space: Space | undefined): MenuRow[] {
  const out: MenuRow[] = []
  // a shared note's chat is of its space's members — made on the server only
  if (space) out.push(chatOnline.value ? { head: 'Чаты документа' } : { head: 'Чаты документа — сервер не подключён' }, ...(chatOnline.value && ROLE_RIGHTS[space.role].chat ? [{ newChat: q.trim() }] : []))
  // a plain note: a new chat of one's own (people are added from its head) — with no server too: made once it is there
  else out.push({ head: chatOnline.value ? 'Чаты' : 'Чаты — сервер не подключён: новый чат появится на нём при подключении' }, { newChat: q.trim() })
  // every chat in one place — wherever one wants it
  out.push({ chatFeed: true })
  for (const chatRoom of chatsFor(q, space?.id).slice(0, 50)) out.push({ chatRoom })
  return out
}
/** The general list: the commands; emoji, boards and chats by name; the events; the Jira tasks. */
function generalRows(query: string, emojiAll: Emoji[], jira: JiraIssue[], space: Space | undefined): MenuRow[] {
  const out: MenuRow[] = []
  const section = <T>(head: string, list: readonly T[], row: (x: T) => MenuRow, more?: number) => {
    if (list.length) out.push({ head, more }, ...list.map(row))
  }
  section('Вставить', matchCommands(query), (cmd) => ({ cmd }))
  // one search through everything: emoji and boards by name come right here too
  const q = query.trim()
  if (q.length >= 2) {
    const em = searchEmoji(emojiAll, q, 12)
    if (em.length) out.push({ head: 'Эмодзи' }, { emojis: em })
    section('Доски', boardsFor(q).slice(0, 5), (board) => ({ board }))
    section('Чаты', chatsFor(q, space?.id).slice(0, 3), (chatRoom) => ({ chatRoom }))
  }
  const g = pickGroups(events.value, query, chipClock.value, todayKey.value)
  section('Сегодня', g.today, (ev) => ({ ev }))
  section('Запланировано', g.ahead, (ev) => ({ ev }), g.more.ahead)
  section('Ранее', g.past, (ev) => ({ ev }), g.more.past)
  section('Задачи Jira', jira, (j) => ({ jira: j }))
  return out
}

/** The menu's rows for its query and mode (none — closed); the emoji list (its grid shows it too). */
export function useMenuRows(query: () => string | undefined, mode: () => PickerMode | undefined, space: () => Space | undefined) {
  const jiraHits = useJiraHits(() => query()?.trim())
  const emojiAll = useEmojiList(() => query() !== undefined)
  const rows = computed<MenuRow[]>(() => {
    void eventsTick.value
    const q = query()
    if (q === undefined) return []
    const m = mode()
    switch (m?.mode) {
      case 'board':
        return boardRows(m.q)
      case 'chat':
        return chatRows(m.q, space())
      // (the emoji grid and a table's size draw a sub-menu of their own over it)
      default:
        return generalRows(q, emojiAll.value, jiraHits.value, space())
    }
  })
  return { rows, emojiAll }
}

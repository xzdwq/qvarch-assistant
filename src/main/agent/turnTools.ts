import { noteForAgent } from '../../shared/agent/contextPack'
import { inFolders, type AgentProfile } from '../../shared/agent/profiles'
import { mayUse, type TurnRequest } from '../../shared/agent/turn'
import { linksIn, sectionOf, type NoteLinkRef } from '../../shared/notebook/links'
import { sharedDocOf } from '../../shared/transport/space'
import { filesOf, resolveWiki, type VaultHit, type VaultNode } from '../../shared/vault'
import type { McpTool } from '../mcp'

/**
 * The tools of one agent's turn: the app's tools (MCP's) and the turn's own — the note the chat is in, its links,
 * the search, the discussion's earlier part, a section of the note, a folder of its work. Which of them the agent
 * gets — by who called it (its owner: all; anyone else: reading and the shared note).
 */
export interface TurnToolsCtx {
  req: TurnRequest
  profile: AgentProfile
  base: McpTool[]
  tree: () => VaultNode[]
  search: (q: string) => VaultHit[]
  backlinks: (path: string) => string[]
  mkdir: (dir: string, name: string) => string
  /** The window does it (the notes live there): read, write, refresh. */
  ui: <T>(op: string, args: Record<string, unknown>) => Promise<T>
}

const str = (v: unknown, name: string, max = 200_000): string => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Нужен параметр ${name}`)
  return v.slice(0, max)
}
const notePath = (p: string) => (/\.(md|qboard)$/i.test(p) ? p : `${p}.md`).replace(/^\/+/, '')
const noteTitle = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/i, '')
/** A text changed as `doc_edit` asks: a fragment replaced (it must be there once), a text put after a line, one appended. */
export function editedText(text: string, a: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  let out = text
  const find = s(a.find)
  if (find) {
    const n = out.split(find).length - 1
    if (n !== 1) throw new Error(n ? `Фрагмент встречается ${n} раз — уточни find` : 'Фрагмент find не найден — перечитай документ (doc_read)')
    out = out.replace(find, () => s(a.replace))
  }
  const after = s(a.after)
  if (after && s(a.text)) {
    const lines = out.split('\n')
    const at = lines.findIndex((l) => l.includes(after))
    if (at < 0) throw new Error('Строка after не найдена — перечитай документ (doc_read)')
    lines.splice(at + 1, 0, s(a.text))
    out = lines.join('\n')
  }
  if (s(a.append)) out = `${out.replace(/\n*$/, '')}\n\n${s(a.append)}\n`
  return out
}
const READ_MAX = 60_000
const cut = (s: string) => (s.length > READ_MAX ? `${s.slice(0, READ_MAX)}\n…(обрезано: ещё ${s.length - READ_MAX} символов)` : s)

export function turnTools(c: TurnToolsCtx): McpTool[] {
  const doc = c.req.doc
  const read = (path: string) => c.ui<string>('read', { path })
  /** A link as the model gave it (written as in the note, or just a note's name). */
  const parse = (s: string): NoteLinkRef => linksIn(s)[0] ?? { kind: 'note', raw: s, target: s.replace(/^\[\[|\]\]$/g, '') }

  /** What a link points to, read (a note, a part of it, a shared note, a task, an event, a file). */
  async function openLink(raw: string): Promise<string> {
    const known = c.req.links.find((l) => l.raw === raw || l.raw.includes(raw))
    const l = parse(known?.raw ?? raw)
    switch (l.kind) {
      case 'note': {
        const path = resolveWiki(l.target, filesOf(c.tree()))
        if (!path) return `Заметки «${l.target}» нет`
        const text = noteForAgent(await read(path))
        return cut(l.section ? (sectionOf(text, l.section) ?? `Раздела «${l.section}» нет. Заметка ${path}:\n${text}`) : `Заметка ${path}:\n${text}`)
      }
      case 'doc': {
        // (had here — read; a link with a code — joined first, as its owner would by a click)
        const path = await c.ui<string>('docLink', { url: l.target })
        return cut(`Общая заметка ${path}:\n${noteForAgent(await read(path))}`)
      }
      case 'jira':
      case 'event':
        return known?.full ?? known?.says ?? 'Нет данных'
      case 'file':
        return `Файл ${l.target} (содержимое файлов-картинок и записей не читается)`
      case 'web':
        return `Внешняя ссылка ${l.target}${c.req.caller === 'owner' ? ' — открыть можно через browser_open' : ''}`
    }
  }

  /** The note the chat is in, to change (someone else's call: only a shared one — the owner's own notes stay as they are). */
  async function docToWrite(): Promise<{ path: string; text: string }> {
    if (!doc) throw new Error('Чат без документа — создай заметку (note_create)')
    const text = await read(doc.path)
    if (c.req.caller !== 'owner' && !sharedDocOf(text)) throw new Error('Писать в личную заметку владельца по чужой просьбе нельзя — ответь в чат')
    return { path: doc.path, text }
  }

  const own: McpTool[] = [
    {
      name: 'doc_read',
      access: 'read',
      description: 'Текущий документ (в котором идёт обсуждение) целиком, свежий текст.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => (doc ? cut(noteForAgent(await read(doc.path))) : 'Чат без документа'),
    },
    {
      name: 'link_read',
      access: 'read',
      description: 'Открыть ссылку из документа или чата: [[Заметка]], [[Заметка#Раздел]], общую заметку, задачу Jira (с описанием), событие, файл. link — ссылка как написана или имя заметки.',
      inputSchema: { type: 'object', properties: { link: { type: 'string' } }, required: ['link'] },
      run: (a) => openLink(str(a.link, 'link', 2000)),
    },
    {
      name: 'notes_search',
      access: 'read',
      description: 'Поиск по тексту всех заметок (личных и общих папок): пути и строки с совпадениями.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      run: async (a) => {
        const hits = c.search(str(a.query, 'query', 300)).filter((h) => inFolders(c.profile, h.path))
        if (!hits.length) return 'Ничего не найдено'
        return hits
          .slice(0, 30)
          .map((h) => `${h.path}${h.lines.length ? `\n${h.lines.map((x) => `  ${x.line + 1}: ${x.text.trim()}`).join('\n')}` : ''}`)
          .join('\n')
      },
    },
    {
      name: 'note_backlinks',
      access: 'read',
      description: 'Какие заметки ссылаются ([[…]]) на заметку path («» — на текущий документ).',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      run: async (a) => {
        const path = typeof a.path === 'string' && a.path.trim() ? notePath(a.path.trim()) : doc?.path
        if (!path) return 'Чат без документа — укажи path'
        const list = c.backlinks(path)
        return list.length ? list.join('\n') : `На ${path} никто не ссылается`
      },
    },
    {
      name: 'chat_history',
      access: 'read',
      description: 'Более ранние сообщения обсуждения (которые не вошли в контекст): count — сколько, skip — сколько последних пропустить.',
      inputSchema: { type: 'object', properties: { count: { type: 'number' }, skip: { type: 'number' } } },
      run: async (a) => {
        const before = c.req.messages.slice(0, c.req.question)
        const skip = Math.max(0, Number(a.skip) || 0)
        const count = Math.min(200, Math.max(1, Number(a.count) || 50))
        const part = before.slice(Math.max(0, before.length - skip - count), before.length - skip)
        return part.length ? cut(part.map((m) => `${m.name}: ${m.text}${m.attach ? `\n  ${m.attach}` : ''}`).join('\n')) : 'Раньше сообщений нет'
      },
    },
    {
      name: 'doc_section',
      access: 'doc',
      description: 'Записать в текущий документ раздел «## heading»: заменить его текст, если раздел есть, иначе добавить в конец. Пиши свои результаты в свой раздел.',
      inputSchema: { type: 'object', properties: { heading: { type: 'string' }, text: { type: 'string' } }, required: ['heading', 'text'] },
      run: async (a) => {
        const heading = str(a.heading, 'heading', 200).replace(/^#+\s*/, '').trim()
        const body = str(a.text, 'text')
        const { path, text } = await docToWrite()
        const old = sectionOf(text, heading)
        const block = `## ${heading}\n${body.trim()}\n`
        const next = old ? text.replace(old, block.trimEnd()) : `${text.replace(/\n*$/, '')}\n\n${block}`
        await c.ui('write', { path, text: next })
        return `${old ? 'Обновлён' : 'Добавлен'} раздел «${heading}» в ${path} — ссылка на него: [[${noteTitle(path)}#${heading}]]`
      },
    },
    {
      name: 'doc_edit',
      access: 'doc',
      description:
        'Точечная правка текущего документа: заменить фрагмент find на replace (find — ровно одно вхождение, например строка, куда вставить ссылку на задачу), или after — вставить text после строки, содержащей after, или append — дописать в конец.',
      inputSchema: { type: 'object', properties: { find: { type: 'string' }, replace: { type: 'string' }, after: { type: 'string' }, text: { type: 'string' }, append: { type: 'string' } } },
      run: async (a) => {
        const { path, text } = await docToWrite()
        const next = editedText(text, a)
        if (next === text) throw new Error('Нечего менять: укажи find + replace, after + text или append')
        await c.ui('write', { path, text: next })
        return `Изменено: ${path}`
      },
    },
    {
      name: 'share_to_chat',
      access: 'write',
      description:
        'Дать заметку участникам чата. mode=link — ссылка на общую заметку (если заметка не общая — она станет общей, участники получат доступ на чтение по ссылке); вставь возвращённую ссылку в ответ. mode=file — отправить в чат копию файлом.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, mode: { type: 'string', enum: ['link', 'file'] }, text: { type: 'string', description: 'Подпись к файлу' } }, required: ['path'] },
      run: async (a) => {
        const path = notePath(str(a.path, 'path', 1000))
        if (a.mode === 'file') return `Отправлен файл ${await c.ui<string>('forward', { room: c.req.room, path, agent: c.req.agent, text: typeof a.text === 'string' ? a.text : '' })}`
        return `Ссылка для ответа: ${await c.ui<string>('shareLink', { path })}`
      },
    },
    {
      name: 'folder_create',
      access: 'write',
      description: 'Папка для своей работы (документы исследования, сводки). folder — где («» — папка ИИ из настроек), name — имя. Возвращает путь.',
      inputSchema: { type: 'object', properties: { folder: { type: 'string' }, name: { type: 'string' } }, required: ['name'] },
      run: async (a) => {
        const dir = typeof a.folder === 'string' && a.folder.trim() ? a.folder.trim() : c.profile.workRoot
        const path = c.mkdir(dir, str(a.name, 'name', 120).replace(/[\\/:*?"<>|]+/g, ' ').trim())
        await c.ui('refresh', {})
        return `Создана папка: ${path}`
      },
    },
  ]
  return [...own, ...c.base].filter((t) => mayUse(c.req.caller, t.access))
}

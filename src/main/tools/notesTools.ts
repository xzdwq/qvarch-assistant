import { findBlocks } from '../../notebook/domain/findBlocks'
import { fencedBlocksOf } from '../../notebook/domain/noteBlocks'
import { findLoops } from '../../notebook/domain/loop'
import { BLOCK_SPECS } from '../../notebook/blocks/specs'
import { componentsGuide } from '../../notebook/blocks/catalog'
import type { VaultNode } from '../../shared/vault'
import type { McpTool } from '../mcp'
import type { ToolCtx } from '../mcpTools'
import { notePath, opt, str } from './toolArgs'

function flat(nodes: VaultNode[], under = ''): Array<{ path: string; dir: boolean; board: boolean }> {
  const out: Array<{ path: string; dir: boolean; board: boolean }> = []
  const walk = (ns: VaultNode[]) => {
    for (const n of ns) {
      if (!under || n.path === under || n.path.startsWith(`${under}/`)) out.push({ path: n.path, dir: n.dir, board: !!n.board })
      if (n.children) walk(n.children)
    }
  }
  walk(nodes)
  return out
}
/** Every block of a note for the assistant: its kind, its name (a fenced block's name=, a loop's name=), its line, flags. */
function blocksOf(text: string): Array<{ kind: string; title: string; name?: string; line: number; lib?: boolean; soft?: boolean; runnable?: boolean }> {
  const fenced = new Map(fencedBlocksOf(text).map((b) => [b.line0, b]))
  const loops = new Map(findLoops(text.split('\n')).map((l) => [l.line0, l]))
  return findBlocks(text.split('\n')).map((b) => {
    const spec = BLOCK_SPECS[b.kind]
    const info = fenced.get(b.line0)?.info
    const loop = loops.get(b.line0)
    return {
      kind: b.kind,
      title: spec.title,
      name: info?.name ?? loop?.info.name,
      line: b.line0,
      lib: info?.lib || undefined,
      soft: info?.soft || loop?.info.soft || undefined,
      runnable: (!!spec.runnable && !info?.lib) || (b.kind === 'loop' && loop?.end !== undefined) || undefined,
    }
  })
}

/** The notes' tools: the list, a task's folder, reading, creating, writing, editing, a note's data. */
export function notesTools(c: ToolCtx): McpTool[] {
  return [
    {
      name: 'note_components',
      access: 'read',
      description: 'Компоненты заметок Qvarch (работа за период, график, таблица, выноска, схема, запросы, SQL…): для чего каждый, его настройки и образец Markdown. kind — один компонент (work, chart…), пусто — все.',
      inputSchema: { type: 'object', properties: { kind: { type: 'string' } } },
      run: async (a) => componentsGuide(opt(a.kind)),
    },
    {
      name: 'notes_list',
      access: 'read',
      description: 'Список папок и заметок блокнота (пути). folder — показать только эту папку.',
      inputSchema: { type: 'object', properties: { folder: { type: 'string', description: 'Путь папки, например «ABC-123 Статусы»' } } },
      run: async (a) => {
        const list = flat(c.tree(), opt(a.folder) ?? '')
        return list.length ? list.map((x) => `${x.dir ? '📁' : x.board ? '🧩' : '📄'} ${x.path}`).join('\n') : 'Пусто'
      },
    },
    {
      name: 'task_folder',
      access: 'write',
      description: 'Папка задачи: находит папку, чьё имя начинается с ключа задачи (ABC-123), иначе создаёт «КЛЮЧ — название из Jira». Все тесты и документы по задаче — в ней.',
      inputSchema: { type: 'object', properties: { key: { type: 'string', description: 'Ключ задачи Jira, например ABC-42' }, title: { type: 'string', description: 'Название, если задачи нет в Jira' } }, required: ['key'] },
      run: async (a) => {
        const key = str(a.key, 'key', 50).trim().toUpperCase()
        const dirs = flat(c.tree()).filter((x) => x.dir)
        const found = dirs.find((d) => (d.path.split('/').pop() ?? '').toUpperCase().startsWith(key))
        if (found) {
          const inside = flat(c.tree(), found.path).filter((x) => x.path !== found.path)
          return `Папка есть: ${found.path}\n${inside.map((x) => `  ${x.dir ? '📁' : '📄'} ${x.path}`).join('\n') || '  (пустая)'}`
        }
        const issue = c.issue(key)
        const title = opt(a.title) ?? issue?.summary ?? ''
        const name = `${key}${title ? ` — ${title}` : ''}`.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 120).trim()
        const path = c.mkdir('', name)
        await c.ui('refresh', {})
        return `Создана папка: ${path}${issue ? `\nЗадача: ${issue.summary} (${issue.status})` : '\n(в Jira-кэше задачи нет)'}`
      },
    },
    {
      name: 'note_read',
      access: 'read',
      description: 'Текст заметки (Markdown с блоками) и список её блоков (вид, имя, строка).',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      run: async (a) => {
        const path = notePath(str(a.path, 'path', 1000))
        const text = await c.ui<string>('read', { path })
        const bl = blocksOf(text)
        return `${text}\n\n---\nБлоки: ${bl.length ? bl.map((b) => `${b.kind} (${b.title})${b.name ? ` «${b.name}»` : ''} (строка ${b.line}${b.runnable ? ', выполняется' : ''}${b.lib ? ', lib' : ''}${b.soft ? ', soft' : ''})`).join('; ') : 'нет'}`
      },
    },
    {
      name: 'note_create',
      access: 'write',
      description: 'Новая заметка в папке (свободное имя). Текст — Markdown с блоками (см. qvarch_guide). Возвращает путь.',
      inputSchema: { type: 'object', properties: { folder: { type: 'string', description: 'Папка ("" — корень)' }, name: { type: 'string' }, text: { type: 'string' } }, required: ['name', 'text'] },
      run: async (a) => {
        const path = await c.ui<string>('create', { dir: opt(a.folder) ?? '', name: str(a.name, 'name', 150), text: str(a.text, 'text') })
        return `Создана: ${path}`
      },
    },
    {
      name: 'note_write',
      access: 'write',
      description: 'Записать заметку целиком (существующую — заменить текст; новой по этому пути — создать).',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string' } }, required: ['path', 'text'] },
      run: async (a) => {
        const path = notePath(str(a.path, 'path', 1000))
        await c.ui('write', { path, text: str(a.text, 'text') })
        return `Записано: ${path}`
      },
    },
    {
      name: 'note_edit',
      access: 'write',
      description: 'Точечная правка: заменить фрагмент find на replace (find должен встречаться ровно один раз), или append — дописать в конец.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' }, append: { type: 'string' } }, required: ['path'] },
      run: async (a) => {
        const path = notePath(str(a.path, 'path', 1000))
        let text = await c.ui<string>('read', { path })
        if (typeof a.find === 'string' && a.find) {
          const n = text.split(a.find).length - 1
          if (n !== 1) throw new Error(n ? `Фрагмент встречается ${n} раз — уточни find` : 'Фрагмент find не найден — прочитай заметку заново (note_read)')
          text = text.replace(a.find, String(a.replace ?? ''))
        }
        if (typeof a.append === 'string' && a.append) text = `${text.replace(/\n*$/, '')}\n\n${a.append}\n`
        await c.ui('write', { path, text })
        return `Изменено: ${path}`
      },
    },
    {
      name: 'data_set',
      access: 'write',
      description: 'Мок-данные / настройки в заметку: блок данных с именем name (```json name=…) — заменяет значение, если такой есть, иначе добавляет блок (после заголовка «## Данные», если он есть, иначе в конец). Значение доступно другим блокам как переменная.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, name: { type: 'string', description: 'Имя переменной (латиница)' }, value: { description: 'Любое JSON-значение' } }, required: ['path', 'name', 'value'] },
      run: async (a) => {
        const path = notePath(str(a.path, 'path', 1000))
        const name = str(a.name, 'name', 60)
        if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error('name — латиница, цифры, _ (не с цифры)')
        const body = JSON.stringify(a.value, null, 2)
        const text = await c.ui<string>('read', { path })
        const lines = text.split('\n')
        const b = fencedBlocksOf(text).find((x) => x.kind === 'data' && x.info.name === name)
        let next: string
        if (b) {
          lines.splice(b.line0, b.line1 - b.line0 - 1, ...body.split('\n'))
          next = lines.join('\n')
        } else {
          const block = `\`\`\`json name=${name}\n${body}\n\`\`\``
          const h = lines.findIndex((l) => /^#{2,3}\s+(данные|мок|mock|data)/i.test(l))
          if (h >= 0) {
            lines.splice(h + 1, 0, '', block)
            next = lines.join('\n')
          } else next = `${text.replace(/\n*$/, '')}\n\n${block}\n`
        }
        await c.ui('write', { path, text: next })
        return `${b ? 'Обновлён' : 'Добавлен'} блок данных «${name}» в ${path}`
      },
    },
  ]
}

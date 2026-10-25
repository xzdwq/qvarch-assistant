import { LINK_GUIDE } from '../notebook/links'

/**
 * What an agent is given for a turn: the note the chat is in, what the note links to, what lies beside it, and the
 * discussion — read as the reasoning around a question, not as roles: people and agents alike, «Name: text». The
 * question is the message that called the agent. Built anew each turn, within a size the model takes.
 */

/** A message of the discussion as the agent reads it. */
export interface PackMessage {
  name: string
  text: string
  /** Its attachment in a line («📎 SQL «rows», 120 строк»). */
  attach?: string
}
/** A link of the note, said in a line: what it is and what it points to. */
export interface PackLink {
  raw: string
  /** «заметка «Аналитика/Требования.md»», «задача «…», статус …», «не найдено». */
  says: string
}
export interface PackInput {
  agentName: string
  /** Its owner's name (whose knowledge it holds). */
  owner: string
  instructions: string
  /** The note the chat is in (none — a chat of its own). */
  doc?: { title: string; path: string; text: string }
  links: PackLink[]
  /** The notes and files beside it. */
  folder: string[]
  messages: PackMessage[]
  /** The message to answer (its index). */
  question: number
  /** The size the pack keeps to, characters. */
  budget: number
  /** The agent can call tools (else it answers from the pack alone). */
  tools: boolean
  /** The app's components, a line each (what it may put in a note). */
  components?: string
}
export interface Pack {
  system: string
  prompt: string
  /** How many earlier messages were left out (the size). */
  omitted: number
}

export const DEFAULT_BUDGET = 120_000
/** At most this share of the budget for the discussion (the rest — the note, its links). */
const TALK_SHARE = 0.5
const MESSAGE_MAX = 4000

/** The note's text as the agent reads it: the shared mark off, the chat blocks — a word (the discussion is given apart). */
export function noteForAgent(text: string): string {
  return text
    .replace(/^<!-- qa:shared doc=[0-9a-f-]{36} -->\n?/i, '')
    .replace(/^(```|~~~)\s*(chat|chatfeed)\b[^\n]*\n[\s\S]*?^\1\s*$/gm, '[чат]')
    .trim()
}
/** A long text cut to a size: its headings (an outline) and its start; the rest — by a tool. */
function cutText(text: string, max: number, tools: boolean): string {
  if (text.length <= max) return text
  const outline = text
    .split('\n')
    .filter((l) => /^#{1,6}\s/.test(l))
    .join('\n')
  const head = text.slice(0, Math.max(0, max - outline.length - 200))
  return `${head}\n…\n[Документ длиннее — показано начало${tools ? '; целиком — инструмент doc_read' : ''}]\n\nОглавление:\n${outline}`
}
const line = (m: PackMessage) => `${m.name}: ${m.text.length > MESSAGE_MAX ? `${m.text.slice(0, MESSAGE_MAX)}…` : m.text}${m.attach ? `\n  ${m.attach}` : ''}`

export function buildPack(p: PackInput): Pack {
  const system = [
    `Ты — «${p.agentName}», ИИ-помощник ${p.owner}. Ты участвуешь в обсуждении в документе вместе с людьми и другими ИИ.`,
    'Обсуждение — это ход рассуждения по вопросу: учитывай его как контекст. Ответь на отмеченное сообщение по существу, на языке обсуждения.',
    p.tools
      ? [
          'Ты работаешь внутри приложения Qvarch и свободно пользуешься его инструментами: дочитывай документ и ссылки (doc_read, link_read), ищи по заметкам (notes_search), смотри задачи Jira (jira_issue) и работу (work_today, work_period).',
          'Длинный результат пиши в документ (doc_section — свой раздел, doc_edit — точечно, «прилинкуй / добавь в документ» — тоже сюда) или в отдельную заметку, а в ответе дай итог и ссылку на место: [[Документ#Раздел]].',
          'Документ — заметка Markdown с компонентами приложения. Где компонент подходит, вставляй его, а не самодельную замену: например, итоги и аналитика работы за период — компонент work. Как писать каждый — note_components.',
          p.components ? `Компоненты:\n${p.components}` : '',
          `Ссылки пиши так, чтобы приложение их открывало:\n${Object.values(LINK_GUIDE)
            .map((s) => `- ${s}`)
            .join('\n')}`,
        ]
          .filter(Boolean)
          .join('\n')
      : 'Инструментов нет: отвечай по тому, что дано.',
    'Ответ — текст сообщения в чат, без вступлений. Не выдавай секреты (токены, пароли, cookie).',
    p.instructions ? `\nУказания владельца:\n${p.instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  // the discussion: the question and as many messages before it as fit (the latest kept first)
  const talkMax = Math.floor(p.budget * TALK_SHARE)
  const before = p.messages.slice(0, p.question)
  const asked = p.messages[p.question]
  const kept: string[] = []
  let size = asked ? line(asked).length : 0
  for (let i = before.length - 1; i >= 0; i--) {
    const l = line(before[i])
    if (size + l.length > talkMax) break
    kept.unshift(l)
    size += l.length
  }
  const omitted = before.length - kept.length
  const talk = [
    ...(omitted ? [`[…ещё ${omitted} сообщений раньше${p.tools ? ' — инструмент chat_history' : ''}]`] : []),
    ...kept,
    ...(asked ? [`→ ${line(asked)}   ← ответь на это`] : []),
  ].join('\n')

  const links = p.links.length ? `Ссылки в документе:\n${p.links.map((l) => `- ${l.raw} → ${l.says}`).join('\n')}` : ''
  const folder = p.folder.length ? `Рядом в папке: ${p.folder.join(', ')}` : ''
  const fixed = [links, folder, `Обсуждение:\n${talk}`].filter(Boolean).join('\n\n')
  const docMax = Math.max(2000, p.budget - fixed.length - system.length)
  const doc = p.doc ? `Документ «${p.doc.title}» (${p.doc.path}):\n${cutText(noteForAgent(p.doc.text), docMax, p.tools) || '(пусто)'}` : 'Чат без документа.'
  return { system, prompt: `${doc}\n\n${fixed}`, omitted }
}

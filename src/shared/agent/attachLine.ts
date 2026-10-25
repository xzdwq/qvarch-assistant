import type { AttachKind, ChatAttach } from '../transport/chat'

/**
 * A message's attachment as an agent reads it: what it is and its data in short (a query's rows, a request's answer,
 * code as written) — enough to reason about, never the whole of a big table.
 */
const DATA_MAX = 3000
const json = (v: unknown) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s && s.length > DATA_MAX ? `${s.slice(0, DATA_MAX)}…` : (s ?? '')
}
const field = <T>(a: ChatAttach, k: string): T | undefined => (a.data && typeof a.data === 'object' ? ((a.data as Record<string, unknown>)[k] as T) : undefined)

const SAYS: Record<AttachKind, (a: ChatAttach) => string> = {
  sql: (a) => `📎 SQL «${a.title}»: ${field<string>(a, 'sql') ?? ''}\n  колонки: ${json(field(a, 'columns'))}\n  строки (${field<number>(a, 'total') ?? '?'}): ${json(field(a, 'rows'))}`,
  http: (a) => `📎 HTTP «${a.title}»: ${field<string>(a, 'method') ?? ''} ${field<string>(a, 'url') ?? ''} → ${field<number>(a, 'status') ?? ''}\n  ${json(field(a, 'body'))}`,
  code: (a) => `📎 код «${a.title}»:\n${json(field(a, 'source') ?? a.data)}${field(a, 'hasValue') ? `\n  результат: ${json(field(a, 'value'))}` : ''}`,
  pw: (a) => `📎 тест браузера «${a.title}»:\n${json(field(a, 'source') ?? a.data)}`,
  value: (a) => `📎 значение «${a.title}»: ${json(field(a, 'value') ?? a.data)}`,
  image: (a) => `🖼 картинка «${a.title}»`,
  file: (a) => `📎 файл «${a.title}»`,
  // (its words are not read: the agent knows only that there is one)
  voice: (a) => `🎤 голосовое сообщение (${a.title}) — его текст недоступен`,
  // (an agent's own steps: not a part of the discussion)
  trace: () => '',
}
export const attachForAgent = (a: ChatAttach): string => SAYS[a.kind](a)

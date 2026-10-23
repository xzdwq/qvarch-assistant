import { DB_DEFAULTS, type DbKind } from './connection'

/** A driver's error in words: what happened, and that nothing is held. The rules — a table per database. */

interface ErrorFacts {
  code: string
  errno?: number
  msg: string
  timeoutSec: number
  lockSec: number
}
/** One rule: the codes / errnos it knows, or a pattern over the message (or over code + message). */
interface ErrorRule {
  codes?: string[]
  errnos?: number[]
  pattern?: RegExp
  /** What the pattern is tried on. */
  over?: 'msg' | 'codeMsg'
  say: (e: ErrorFacts) => string
}

const KIND_RULES: Record<DbKind, ErrorRule[]> = {
  pg: [
    { codes: ['55P03'], say: (e) => `Таблица или строки заняты другим сеансом — ждали ${e.lockSec} с и сняли запрос. Ничего не держим. (${e.msg})` },
    { codes: ['40P01'], say: (e) => `Взаимная блокировка (deadlock) — сервер снял запрос. Ничего не держим. (${e.msg})` },
    { codes: ['57014'], say: (e) => (/statement timeout/i.test(e.msg) ? `Запрос шёл дольше ${e.timeoutSec} с — сервер его снял` : 'Запрос остановлен') },
    { codes: ['25006'], say: (e) => `Только чтение: ${e.msg}` },
    { codes: ['28P01', '28000'], say: (e) => `Вход не удался: ${e.msg}` },
    { codes: ['3D000'], say: (e) => `Нет такой базы: ${e.msg}` },
    { codes: ['42P01'], say: (e) => `Нет такой таблицы: ${e.msg}` },
  ],
  mysql: [
    { codes: ['ER_LOCK_WAIT_TIMEOUT'], errnos: [1205], say: (e) => `Строки заняты другим сеансом — ждали ${e.lockSec} с и сняли запрос. Ничего не держим.` },
    { codes: ['ER_LOCK_DEADLOCK'], errnos: [1213], say: () => 'Взаимная блокировка (deadlock) — сервер снял запрос. Ничего не держим.' },
    { codes: ['ER_QUERY_TIMEOUT', 'ER_STATEMENT_TIMEOUT'], errnos: [3024, 1969], say: (e) => `Запрос шёл дольше ${e.timeoutSec} с — сервер его снял` },
    { codes: ['ER_QUERY_INTERRUPTED'], errnos: [1317], say: () => 'Запрос остановлен' },
    { codes: ['ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION'], errnos: [1792], say: (e) => `Только чтение: ${e.msg}` },
    { codes: ['ER_ACCESS_DENIED_ERROR'], say: (e) => `Вход не удался: ${e.msg}` },
  ],
  sqlite: [{ pattern: /SQLITE_BUSY|database is locked/i, over: 'msg', say: (e) => `Файл базы занят другой программой — ждали ${e.lockSec} с. Ничего не держим.` }],
}
/** The network's errors: the same for every database. */
const NETWORK_RULES: ErrorRule[] = [
  { pattern: /ECONNREFUSED/, say: (e) => `Сервер не принимает подключение (${e.msg})` },
  { pattern: /ETIMEDOUT|timeout expired|connect timeout/i, say: (e) => `Не удалось подключиться за ${DB_DEFAULTS.connectSec} с (${e.msg})` },
  { pattern: /ENOTFOUND|EAI_AGAIN/, say: (e) => `Нет такого хоста (${e.msg})` },
]

function ruleMatches(r: ErrorRule, e: ErrorFacts): boolean {
  if (r.codes?.includes(e.code)) return true
  if (e.errno !== undefined && r.errnos?.includes(e.errno)) return true
  return !!r.pattern && r.pattern.test(r.over === 'msg' ? e.msg : e.code + e.msg)
}

/** A driver's error in words: what happened, and that nothing is held. */
export function sqlErrorText(kind: DbKind, e: { code?: string | number; errno?: number; message?: string }, ctx: { timeoutSec: number; lockSec: number }): string {
  const facts: ErrorFacts = { code: String(e.code ?? ''), errno: e.errno, msg: (e.message ?? String(e)).split('\n')[0], ...ctx }
  const rule = [...KIND_RULES[kind], ...NETWORK_RULES].find((r) => ruleMatches(r, facts))
  return rule ? rule.say(facts) : facts.msg
}

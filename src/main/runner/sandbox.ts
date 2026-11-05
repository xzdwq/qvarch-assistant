import { inspect } from 'node:util'
import { stripTypeScriptTypes } from 'node:module'

/**
 * What every block's code runs with (code, loop head, Playwright): the console it writes to, the values it hands
 * back, its JS / TS wrapped into one async function.
 */

export interface SandboxLog {
  level: 'log' | 'info' | 'warn' | 'error'
  text: string
}
/** At most this many console lines kept per run, each at most this long (a loop of logs must not eat the memory). */
const LOGS_MAX = 2000
const LOG_TEXT_MAX = 20_000

/** A value as the console shows it. */
export const show = (a: unknown) => (typeof a === 'string' ? a : inspect(a, { depth: 5, breakLength: 110, maxArrayLength: 200, maxStringLength: 4000 }))

/** A value that can go to another process (functions, symbols… become text). */
export function plain(v: unknown): unknown {
  try {
    return structuredClone(v)
  } catch {
    try {
      return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : typeof x === 'function' ? `[function ${x.name || ''}]` : x)))
    } catch {
      return show(v)
    }
  }
}

/** A name a variable can have (the context's values become the code's variables by it). */
export const isName = (s: string) => /^[A-Za-z_$][\w$]*$/.test(s)

/** The code's `console`: every method writes into `logs`, within the limits. */
export function sandboxConsole(logs: SandboxLog[]) {
  const log =
    (level: SandboxLog['level']) =>
    (...a: unknown[]) => {
      if (logs.length < LOGS_MAX) logs.push({ level, text: a.map(show).join(' ').slice(0, LOG_TEXT_MAX) })
    }
  return { log: log('log'), info: log('info'), debug: log('log'), warn: log('warn'), error: log('error'), table: log('log'), dir: log('log') }
}

/** The code inside `async function <name>() {…}` (a top-level `return` and `await` allowed), TS turned into JS. */
export function wrapBody(code: string, ts: boolean, name: string): string {
  const src = `async function ${name}() {\n${code}\n}`
  // (Node's own TS support; its typings here are older)
  return ts ? stripTypeScriptTypes(src, { mode: 'transform' } as unknown as { mode: 'strip' }) : src
}

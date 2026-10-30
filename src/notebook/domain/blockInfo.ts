/**
 * The info line of a fenced block (```lang key=value flag …): what a runnable block is and how it runs.
 *
 *   ```http name=login              a request (the .http format of JetBrains / VS Code REST Client)
 *   ```ts run name=total            code run apart from the app; its return value published as `total`
 *   ```ts lib                       shared functions put before every code block of the note
 *   ```ts playwright name=shot      a browser scenario (flags: headed, notrace, session, browser=chrome)
 *   ```json name=items              data, published as soon as it parses
 *   ```json ref=login.body          a value of the note's context, shown live
 *   ```sql db=main name=rows        a read-only database query
 *   ```md template name=text        Markdown with {{ values }}, published filled
 */
import { keepOf } from './emits'

/**
 * Where a value of the note's context came from (a block kind, set() of code, the browser component); `run` — what
 * started «Выполнить всё» (its `trigger`).
 */
export type ValueSource = 'http' | 'code' | 'data' | 'ref' | 'pw' | 'sql' | 'tpl' | 'loop' | 'set' | 'browser' | 'table' | 'run' | 'save'
/** The values the note's text itself gives (data, a table): nothing to clear — they come back from the text at once. */
export const TEXT_VALUE_SOURCES: ReadonlySet<ValueSource> = new Set<ValueSource>(['data', 'table'])
/** The value «Выполнить всё» gives of what started it (by hand, by the AI, by a schedule) — no block may take its name. */
export const TRIGGER_NAME = 'trigger'

/** The browsers a Playwright block can drive (installed ones; Chromium — if it was downloaded). */
export const PW_BROWSERS = ['msedge', 'chrome', 'chromium'] as const
export type PwBrowser = (typeof PW_BROWSERS)[number]

/** How a block inside a loop shows its results: gathered into one (acc) or each pass apart (each). */
export const LOOP_OUT_MODES = ['acc', 'each'] as const
export type LoopOutMode = (typeof LOOP_OUT_MODES)[number]
/** How a data value may be shown other than as JSON. */
export const DATA_VIEWS = ['table'] as const
export type DataView = (typeof DATA_VIEWS)[number]

/** One of a set of names (a guard for a value read from text). */
const oneOf = <T extends string>(set: readonly T[], v: string): v is T => (set as readonly string[]).includes(v)

export interface BlockInfo {
  lang: string
  name?: string
  ref?: string
  run: boolean
  /** Shared functions: put before every code block of the note (not run alone). */
  lib: boolean
  /** Seconds a code block may run (default 30; a Playwright one — 120). */
  timeout?: number
  /** A Playwright scenario (```ts playwright). */
  pw?: boolean
  /** Playwright: the browser's window shown. */
  headed?: boolean
  /** Playwright: no trace kept. */
  notrace?: boolean
  /** Playwright: which browser (default msedge). */
  browser?: PwBrowser
  /** Its error does not stop «Выполнить всё» (a check expected to fail, a flaky one). */
  soft?: boolean
  /** Playwright: the Браузер section's sign-ins (its cookies) — a site entered there (SSO too) is entered here. */
  session?: boolean
  /** A database query (```sql db=…): the connection's name (its settings — in «Базы данных», not in the note). */
  db?: string
  /** A text by a template (```md template): Markdown with {{ values }} — published as the text filled. */
  template?: boolean
  /** A text by a template sent, filled, into the note's chat (an `@ИИ · …` in it calls that AI) — each run. */
  chat?: boolean
  /** The head of a loop (```js loop, right under <!-- qa:loop -->). */
  loop?: boolean
  /** Inside a loop — how its results are shown: one at a time (none), gathered into one (acc), each apart (each). */
  out?: LoopOutMode
  /** A data value shown as a table (```json ref=rows view=table). */
  view?: DataView
  /** An unnamed runnable block's own id (its results are kept by it — not by its line, which moves). */
  id?: string
  /** What its emit() gathers goes on from the last run: its last N items / lines (none — every run anew). */
  keep?: number
  /** The height of what a block shows under its text (a query's ER diagram and rows), px — as its edge was dragged. */
  h?: number
}
/** A block's shown part's height within these bounds, px. */
export const BLOCK_H = { min: 200, max: 2400 } as const

/** A block's own id: eight small letters and digits. */
export const BLOCK_ID = /^[a-z0-9]{8}$/

/** The flags an info line may carry (a word without `=`), each setting its field to true. */
const FLAGS = new Map<string, keyof BlockInfo>([
  ['run', 'run'],
  ['lib', 'lib'],
  ['playwright', 'pw'],
  ['pw', 'pw'],
  ['headed', 'headed'],
  ['notrace', 'notrace'],
  ['soft', 'soft'],
  ['session', 'session'],
  ['template', 'template'],
  ['chat', 'chat'],
  ['loop', 'loop'],
])

/** The `key=value` words an info line may carry, each writing its field when the value fits it. */
const SETTINGS: Record<string, (out: BlockInfo, v: string) => void> = {
  name: (out, v) => {
    if (isName(v)) out.name = v
  },
  ref: (out, v) => {
    out.ref = v
  },
  db: (out, v) => {
    out.db = v
  },
  out: (out, v) => {
    if (oneOf(LOOP_OUT_MODES, v)) out.out = v
  },
  view: (out, v) => {
    if (oneOf(DATA_VIEWS, v)) out.view = v
  },
  timeout: (out, v) => {
    if (Number(v) > 0) out.timeout = Math.min(3600, Number(v))
  },
  browser: (out, v) => {
    if (oneOf(PW_BROWSERS, v)) out.browser = v
  },
  id: (out, v) => {
    if (BLOCK_ID.test(v)) out.id = v
  },
  h: (out, v) => {
    if (Number(v) > 0) out.h = Math.round(Math.min(BLOCK_H.max, Math.max(BLOCK_H.min, Number(v))))
  },
  keep: (out, v) => {
    out.keep = keepOf(v) ?? out.keep
  },
}

/** Parses an info line: `lang key=value flag …` (unknown words are ignored). */
export function parseInfo(info: string): BlockInfo {
  const parts = info.trim().split(/\s+/).filter(Boolean)
  const out: BlockInfo = { lang: (parts.shift() ?? '').toLowerCase(), run: false, lib: false }
  for (const p of parts) {
    const m = /^([\w-]+)=(.*)$/.exec(p)
    if (!m) {
      const flag = FLAGS.get(p)
      if (flag) (out as unknown as Record<string, unknown>)[flag] = true
      continue
    }
    const [, k, v] = m
    if (Object.hasOwn(SETTINGS, k)) SETTINGS[k](out, v)
  }
  return out
}

/** A name a block may publish under: a JS identifier, not one the runners give themselves. */
export const isName = (s: string) => /^[A-Za-z_$][\w$]*$/.test(s) && !RESERVED_NAMES.has(s)
const RESERVED_NAMES = new Set([TRIGGER_NAME, 'ctx', 'runs', 'set', 'body', 'loop','console', 'page', 'context', 'browser', 'expect', 'step', 'devices', 'await', 'return', 'function', 'class', 'const', 'let', 'var', 'new', 'this', 'import', 'export', 'default', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'delete', 'void', 'yield', 'null', 'true', 'false', 'undefined'])

/** Writes an info line back (a stable order of its words; defaults left out). */
export function infoMd(i: BlockInfo): string {
  return [
    i.lang,
    i.template ? 'template' : '',
    i.template && i.chat ? 'chat' : '',
    i.loop ? 'loop' : '',
    i.pw ? 'playwright' : '',
    i.run && !i.pw ? 'run' : '',
    i.lib ? 'lib' : '',
    i.db !== undefined ? `db=${i.db}` : '',
    i.name ? `name=${i.name}` : '',
    i.ref ? `ref=${i.ref}` : '',
    i.view ? `view=${i.view}` : '',
    i.pw && i.browser && i.browser !== 'msedge' ? `browser=${i.browser}` : '',
    i.pw && i.headed ? 'headed' : '',
    i.pw && i.notrace ? 'notrace' : '',
    i.pw && i.session ? 'session' : '',
    i.soft ? 'soft' : '',
    i.timeout ? `timeout=${i.timeout}` : '',
    i.out ? `out=${i.out}` : '',
    i.id ? `id=${i.id}` : '',
    i.h ? `h=${i.h}` : '',
    i.keep ? `keep=${i.keep}` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/** The languages a code / Playwright block may be written in. */
export const CODE_LANGS = ['js', 'javascript', 'ts', 'typescript'] as const
export const isCodeLang = (lang: string) => oneOf(CODE_LANGS, lang)
/** A code language is TypeScript (its types are cut away before it runs). */
export const isTsLang = (lang: string) => lang.startsWith('t')

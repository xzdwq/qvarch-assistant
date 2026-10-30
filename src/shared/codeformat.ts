/** Formatting the code of a notebook code block: SQL (sql-formatter), JS / TS / HTML / CSS / YAML (prettier), JSON, shell. */
/** The common indent of the lines (a block inside a list item is indented) — taken off and put back. */
function dedent(code: string): { body: string; pad: string } {
  const lines = code.split('\n')
  const pads = lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0])
  let pad = pads[0] ?? ''
  for (const p of pads) while (!p.startsWith(pad)) pad = pad.slice(0, -1)
  return { body: lines.map((l) => l.slice(Math.min(pad.length, /^\s*/.exec(l)![0].length))).join('\n'), pad }
}

interface FormatOptions {
  sqlDialect?: 'postgresql' | 'mysql' | 'mariadb' | 'sqlite'
}
type Formatter = (body: string, opts: FormatOptions) => Promise<string> | string

/** prettier's parsers used here → the plugins each needs (loaded on demand). */
const PRETTIER_PLUGINS = {
  html: () => Promise.all([import('prettier/plugins/html'), import('prettier/plugins/babel'), import('prettier/plugins/estree'), import('prettier/plugins/postcss')]),
  css: () => Promise.all([import('prettier/plugins/postcss')]),
  typescript: () => Promise.all([import('prettier/plugins/typescript'), import('prettier/plugins/estree')]),
  babel: () => Promise.all([import('prettier/plugins/babel'), import('prettier/plugins/estree')]),
  json5: () => Promise.all([import('prettier/plugins/babel'), import('prettier/plugins/estree')]),
  yaml: () => Promise.all([import('prettier/plugins/yaml')]),
} satisfies Record<string, () => Promise<unknown[]>>
type PrettierParser = keyof typeof PRETTIER_PLUGINS

/** The languages with a formatter of their own; any other goes to prettier (its parser by the language). */
const FORMATTERS = new Map<string, Formatter>([
  [
    'sql',
    async (body, opts) => {
      const { format } = await import('sql-formatter')
      // a note's {{ value }} kept whole (a parameter, not braces to space out)
      return format(body, { language: opts.sqlDialect ?? 'postgresql', keywordCase: 'upper', dataTypeCase: 'upper', functionCase: 'upper', tabWidth: 2, linesBetweenQueries: 1, paramTypes: { custom: [{ regex: String.raw`\{\{[^{}]*\}\}` }] } })
    },
  ],
  [
    'json',
    async (body) => {
      try {
        return JSON.stringify(JSON.parse(body), null, 2)
      } catch {
        return prettier(body, 'json5')
      }
    },
  ],
  ['bash', (body) => formatShell(body)],
])
/** A language's prettier parser (JavaScript and the unknown — babel). */
const PRETTIER_PARSER_OF = new Map<string, PrettierParser>([
  ['html', 'html'],
  ['css', 'css'],
  ['typescript', 'typescript'],
  ['yaml', 'yaml'],
])

/** Formats a block's code; throws with a short message when the code does not parse. */
export async function formatCode(lang: string, code: string, opts: FormatOptions = {}): Promise<string> {
  const { body, pad } = dedent(code)
  const format: Formatter = FORMATTERS.get(lang) ?? ((b) => prettier(b, PRETTIER_PARSER_OF.get(lang) ?? 'babel'))
  const out = (await format(body, opts)).replace(/\s+$/, '')
  return out
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n')
}

async function prettier(code: string, parser: PrettierParser): Promise<string> {
  const p = await import('prettier/standalone')
  const plugins = await PRETTIER_PLUGINS[parser]()
  return p.format(code, { parser, plugins: plugins as never, printWidth: 100, tabWidth: 2, semi: true, singleQuote: true })
}

/**
 * Shell: no real formatter in the browser — a tidy pass: trailing spaces off, blank runs to one, long
 * pipelines / && chains split onto continuation lines, if/for/while/case bodies indented.
 */
export function formatShell(code: string): string {
  const out: string[] = []
  let depth = 0
  let blank = false
  for (const raw of code.split('\n')) {
    const line = raw.trim()
    if (!line) {
      if (!blank && out.length) out.push('')
      blank = true
      continue
    }
    blank = false
    if (/^(fi|done|esac|\}|;;)\b/.test(line) || /^(else|elif)\b/.test(line)) depth = Math.max(0, depth - 1)
    const ind = '  '.repeat(depth)
    if (line.length > 100 && /\s(&&|\|\||\|)\s/.test(line) && !line.startsWith('#')) {
      const parts = line.split(/\s+(?=(?:&&|\|\||\|)\s)/)
      out.push(ind + parts[0] + ' \\')
      parts.slice(1).forEach((p, i) => out.push(ind + '  ' + p + (i < parts.length - 2 ? ' \\' : '')))
    } else out.push(ind + line)
    if (/(\bthen|\bdo|\{|\bin)$/.test(line) && !/^#/.test(line)) depth++
    if (/^(else|elif)\b/.test(line)) depth++
  }
  return out.join('\n')
}

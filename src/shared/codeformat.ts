/** Formatting the code of a notebook code block: SQL (sql-formatter), JS / TS / HTML / CSS (prettier), JSON, shell. */
/** The common indent of the lines (a block inside a list item is indented) — taken off and put back. */
function dedent(code: string): { body: string; pad: string } {
  const lines = code.split('\n')
  const pads = lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0])
  let pad = pads[0] ?? ''
  for (const p of pads) while (!p.startsWith(pad)) pad = pad.slice(0, -1)
  return { body: lines.map((l) => l.slice(Math.min(pad.length, /^\s*/.exec(l)![0].length))).join('\n'), pad }
}

/** Formats a block's code; throws with a short message when the code does not parse. */
export async function formatCode(lang: string, code: string): Promise<string> {
  const { body, pad } = dedent(code)
  let out: string
  if (lang === 'sql') {
    const { format } = await import('sql-formatter')
    out = format(body, { language: 'postgresql', keywordCase: 'upper', dataTypeCase: 'upper', functionCase: 'upper', tabWidth: 2, linesBetweenQueries: 1 })
  } else if (lang === 'json') {
    try {
      out = JSON.stringify(JSON.parse(body), null, 2)
    } catch {
      out = await prettier(body, 'json5')
    }
  } else if (lang === 'bash') out = formatShell(body)
  else out = await prettier(body, lang === 'html' ? 'html' : lang === 'css' ? 'css' : lang === 'typescript' ? 'typescript' : 'babel')
  out = out.replace(/\s+$/, '')
  return out
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n')
}

async function prettier(code: string, parser: string): Promise<string> {
  const p = await import('prettier/standalone')
  const plugins =
    parser === 'html'
      ? [await import('prettier/plugins/html'), await import('prettier/plugins/babel'), await import('prettier/plugins/estree'), await import('prettier/plugins/postcss')]
      : parser === 'css'
        ? [await import('prettier/plugins/postcss')]
        : parser === 'typescript'
          ? [await import('prettier/plugins/typescript'), await import('prettier/plugins/estree')]
          : [await import('prettier/plugins/babel'), await import('prettier/plugins/estree')]
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

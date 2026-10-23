/**
 * A regular expression run on a text away from the window (a Worker): a pattern with catastrophic
 * backtracking ((a+)+$ on a long line) would freeze the app — the worker is stopped after a time limit.
 * The engine is the browser's own (JavaScript / ECMAScript, the same as in Node and the front end).
 */
export interface RxGroup {
  /** 1-based number. */
  n: number
  name?: string
  value?: string
  start?: number
  end?: number
}
export interface RxMatch {
  index: number
  end: number
  text: string
  groups: RxGroup[]
}
export interface RxResult {
  matches: RxMatch[]
  /** More matches than were kept. */
  truncated: boolean
  replaced?: string
  ms: number
}

const WORKER = `
self.onmessage = (e) => {
  const { id, source, flags, text, replace, max, names } = e.data
  const t0 = performance.now()
  try {
    const re = new RegExp(source, flags.includes('d') ? flags : flags + 'd')
    const out = []
    let truncated = false
    const take = (m) => {
      const groups = []
      for (let i = 1; i < m.length; i++) {
        const at = m.indices && m.indices[i]
        groups.push({ n: i, name: names[i - 1] || undefined, value: m[i], start: at ? at[0] : undefined, end: at ? at[1] : undefined })
      }
      out.push({ index: m.index, end: m.index + m[0].length, text: m[0], groups })
    }
    if (re.global || re.sticky) {
      let m
      while ((m = re.exec(text))) {
        if (out.length >= max) { truncated = true; break }
        take(m)
        if (m[0] === '') re.lastIndex += (re.unicode || re.unicodeSets) && text.codePointAt(re.lastIndex) > 0xffff ? 2 : 1
        if (!re.global) break
      }
    } else {
      const m = re.exec(text)
      if (m) take(m)
    }
    let replaced
    if (typeof replace === 'string') replaced = text.replace(new RegExp(source, flags.replace('d', '')), replace)
    self.postMessage({ id, ok: { matches: out, truncated, replaced, ms: performance.now() - t0 } })
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) })
  }
}
`
let worker: Worker | undefined
let url: string | undefined
let seq = 0
/** The rejection message of a run dropped because a newer one started. */
export const REGEX_SUPERSEDED = 'superseded'
const waiting = new Map<number, { res: (r: RxResult) => void; rej: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
function start(): Worker {
  url ??= URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }))
  const w = new Worker(url)
  w.onmessage = (e: MessageEvent<{ id: number; ok?: RxResult; error?: string }>) => {
    const p = waiting.get(e.data.id)
    if (!p) return
    waiting.delete(e.data.id)
    clearTimeout(p.timer)
    if (e.data.ok) p.res(e.data.ok)
    else p.rej(new Error(e.data.error ?? 'ошибка'))
  }
  return w
}
/** Runs the pattern; rejects with the engine's message, or after `limitMs` (the worker is replaced). */
export function runRegex(source: string, flags: string, text: string, opts: { replace?: string; max?: number; limitMs?: number } = {}): Promise<RxResult> {
  worker ??= start()
  const id = ++seq
  // only the newest run matters: an older one still waiting is dropped
  for (const [k, p] of waiting) {
    clearTimeout(p.timer)
    p.rej(new Error(REGEX_SUPERSEDED))
    waiting.delete(k)
  }
  return new Promise((res, rej) => {
    const timer = setTimeout(() => {
      waiting.delete(id)
      worker?.terminate()
      worker = undefined
      rej(new Error(`TIMEOUT:${opts.limitMs ?? 1500}`))
    }, opts.limitMs ?? 1500)
    waiting.set(id, { res, rej, timer })
    worker!.postMessage({ id, source, flags, text, replace: opts.replace, max: opts.max ?? 5000, names: groupNames(source) })
  })
}

/** The capturing groups of a pattern in order: their names ('' — a numbered one). */
export function groupNames(source: string): string[] {
  const out: string[] = []
  let cls = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (c === '\\') {
      i++
      continue
    }
    if (cls) {
      if (c === ']') cls = false
      continue
    }
    if (c === '[') cls = true
    else if (c === '(') {
      if (source[i + 1] !== '?') out.push('')
      else {
        const m = /^\?<([A-Za-z_$][\w$]*)>/.exec(source.slice(i + 1))
        if (m) out.push(m[1])
      }
    }
  }
  return out
}
export const REGEX_LANGS = ['js', 'java', 'python', 'csharp'] as const
export type RegexLang = (typeof REGEX_LANGS)[number]

/** A language's option names for the JS flags it has (the flags it lacks are left out). */
const optionList = (flags: string, options: Record<string, string>): string =>
  Object.entries(options)
    .filter(([flag]) => flags.includes(flag))
    .map(([, option]) => option)
    .join(' | ')

/** Each language: its title and how the pattern is written in it (escaped for its string literals). */
export const REGEX_LANG_INFO: Record<RegexLang, { title: string; code: (source: string, flags: string) => string }> = {
  js: {
    title: 'JavaScript',
    code: (source, flags) => `const re = /${source.replace(/\//g, '\\/')}/${flags}\nconst all = [...text.matchAll(${flags.includes('g') ? 're' : `new RegExp(re.source, re.flags + 'g')`})]`,
  },
  java: {
    title: 'Java',
    code: (source, flags) => {
      const javaStr = source.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const f = optionList(flags, { i: 'Pattern.CASE_INSENSITIVE', m: 'Pattern.MULTILINE', s: 'Pattern.DOTALL', u: 'Pattern.UNICODE_CASE' })
      return `Pattern p = Pattern.compile("${javaStr}"${f ? `, ${f}` : ''});\nMatcher m = p.matcher(text);\nwhile (m.find()) {\n    String found = m.group();\n}`
    },
  },
  python: {
    title: 'Python',
    code: (source, flags) => {
      const f = optionList(flags, { i: 're.IGNORECASE', m: 're.MULTILINE', s: 're.DOTALL' })
      const py = source.replace(/\(\?<(?![=!])/g, '(?P<').replace(/\\k<(\w+)>/g, '(?P=$1)')
      return `import re\n\npattern = re.compile(r"${py.replace(/"/g, '\\"')}"${f ? `, ${f}` : ''})\nfor m in pattern.finditer(text):\n    found = m.group(0)`
    },
  },
  csharp: {
    title: 'C#',
    code: (source, flags) => {
      const f = optionList(flags, { i: 'RegexOptions.IgnoreCase', m: 'RegexOptions.Multiline', s: 'RegexOptions.Singleline' })
      return `var re = new Regex(@"${source.replace(/"/g, '""')}"${f ? `, ${f}` : ''});\nforeach (Match m in re.Matches(text))\n{\n    var found = m.Value;\n}`
    },
  },
}

/** The pattern written as code in a language (escaped for its string literals). */
export function regexCode(source: string, flags: string, lang: RegexLang): string {
  return REGEX_LANG_INFO[lang].code(source, flags)
}

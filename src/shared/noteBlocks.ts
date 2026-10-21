/**
 * The notebook's components (as in Notion / Confluence): blocks that always show as themselves — a table, a
 * chart, a diagram, a callout, a fold, a table of contents — while the file keeps plain, readable Markdown:
 * a GFM table, ```chart / ```mermaid / ```toc fences, `> [!info]` callouts (as in Obsidian), <details>.
 */
import { AUDIO_EMBED, IMAGE_EMBED } from './vault'
import { parseInfo, runKindOf } from './runbook'

export type BlockKind = 'table' | 'chart' | 'mermaid' | 'toc' | 'callout' | 'toggle' | 'work' | 'audio' | 'image' | 'board' | 'http' | 'code' | 'data' | 'ref' | 'pw' | 'browser'
export interface NoteBlock {
  kind: BlockKind
  /** The first and the last line (1-based, inclusive). */
  line0: number
  line1: number
  /** The block's own text (all its lines). */
  src: string
}

const FENCE_KINDS = new Set(['chart', 'mermaid', 'toc', 'work', 'board'])
/**
 * A table's own settings, kept in a comment over it (invisible in other Markdown viewers): column widths, the
 * columns summed up, the merged cells — `<!-- qa:table widths=120,0 sums=1 merge=0.1.2.1;3.0.1.2 -->`.
 */
const WIDTHS = /^<!--\s*qa:table\s+([^>]*?)\s*-->\s*$/
const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
const isSepRow = (l: string) => /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(l) && l.includes('-')

/** The components of a note's text (lines inside other code fences are not looked at). */
export function findBlocks(lines: string[]): NoteBlock[] {
  const out: NoteBlock[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    const fence = /^(`{3,}|~{3,})\s*([\w-]*)([^`]*)$/.exec(l)
    if (fence) {
      // find the closing fence
      let j = i + 1
      while (j < lines.length && !new RegExp(`^${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[j])) j++
      // a component by its language (chart, board…), or a runnable block by its info line (http, js run, json name=…)
      const lang = fence[2].toLowerCase()
      const kind: BlockKind | undefined = lang === 'browser' ? 'browser' : FENCE_KINDS.has(lang) && !fence[3].trim() ? (lang as BlockKind) : runKindOf(parseInfo(`${fence[2]} ${fence[3]}`))
      if (j < lines.length && kind) out.push({ kind, line0: i + 1, line1: j + 1, src: lines.slice(i, j + 1).join('\n') })
      i = j < lines.length ? j + 1 : lines.length
      continue
    }
    // a recording / a picture: its own line
    if (AUDIO_EMBED.test(l) || IMAGE_EMBED.test(l)) {
      out.push({ kind: AUDIO_EMBED.test(l) ? 'audio' : 'image', line0: i + 1, line1: i + 1, src: l })
      i++
      continue
    }
    const w = WIDTHS.test(l) ? 1 : 0
    if (isTableRow(lines[i + w] ?? '') && i + w + 1 < lines.length && isSepRow(lines[i + w + 1])) {
      let j = i + w + 2
      while (j < lines.length && isTableRow(lines[j])) j++
      out.push({ kind: 'table', line0: i + 1, line1: j, src: lines.slice(i, j).join('\n') })
      i = j
      continue
    }
    if (/^>\s*\[!\w+\][+-]?/.test(l)) {
      let j = i + 1
      while (j < lines.length && /^>/.test(lines[j])) j++
      out.push({ kind: 'callout', line0: i + 1, line1: j, src: lines.slice(i, j).join('\n') })
      i = j
      continue
    }
    if (/^<details(\s+open)?\s*>\s*$/i.test(l)) {
      let j = i + 1
      while (j < lines.length && !/^<\/details>\s*$/i.test(lines[j])) j++
      if (j < lines.length) {
        out.push({ kind: 'toggle', line0: i + 1, line1: j + 1, src: lines.slice(i, j + 1).join('\n') })
        i = j + 1
        continue
      }
    }
    i++
  }
  return out
}

// ---------- table ----------
export type Align = 'left' | 'center' | 'right' | undefined
export interface TableModel {
  head: string[]
  rows: string[][]
  align: Align[]
  /** Column widths, px (0 — by the content); none — all by the content. */
  widths?: number[]
  /** The columns with a sum under them. */
  sums?: number[]
  /** Merged cells of the body: from row r, column c — rs rows, cs columns (the text is the first cell's). */
  merges?: Merge[]
}
export interface Merge {
  r: number
  c: number
  rs: number
  cs: number
}
function splitRow(l: string): string[] {
  let s = l.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|'
      i++
    } else if (s[i] === '|') {
      cells.push(cur)
      cur = ''
    } else cur += s[i]
  }
  cells.push(cur)
  return cells.map((c) => c.trim().replace(/<br\s*\/?>/gi, '\n'))
}
export function parseTable(src: string): TableModel {
  let lines = src.split('\n')
  const wm = WIDTHS.exec(lines[0])
  if (wm) lines = lines.slice(1)
  const head = splitRow(lines[0])
  const align = splitRow(lines[1] ?? '').map((c): Align => (/^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : /^:-+$/.test(c) ? 'left' : undefined))
  const n = head.length
  const rows = lines.slice(2).map((l) => {
    const r = splitRow(l)
    return [...r, ...Array(Math.max(0, n - r.length)).fill('')].slice(0, n)
  })
  const t: TableModel = { head, rows, align: [...align, ...Array(Math.max(0, n - align.length)).fill(undefined)].slice(0, n) }
  if (wm) {
    const kv = Object.fromEntries([...wm[1].matchAll(/(\w+)=([^\s]*)/g)].map((m) => [m[1], m[2]]))
    if (kv.widths) {
      const ws = kv.widths.split(',').map((x) => Math.max(0, Math.round(Number(x.trim()) || 0)))
      if (ws.some((x) => x > 0)) t.widths = [...ws, ...Array(Math.max(0, n - ws.length)).fill(0)].slice(0, n)
    }
    if (kv.sums) {
      const ss = [...new Set(kv.sums.split(',').map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x < n))]
      if (ss.length) t.sums = ss.sort((a, b) => a - b)
    }
    if (kv.merge) {
      const ms = kv.merge
        .split(';')
        .map((x) => x.split('.').map(Number))
        .filter((m) => m.length === 4 && m.every((v) => Number.isInteger(v) && v >= 0))
        .map(([r, c, rs, cs]) => ({ r, c, rs: Math.max(1, rs), cs: Math.max(1, cs) }))
        .filter((m) => m.r + m.rs <= rows.length && m.c + m.cs <= n && m.rs * m.cs > 1)
      // overlapping ones (an edited file): the first one wins
      const ok: Merge[] = []
      for (const m of ms) if (!ok.some((o) => overlaps(o, m))) ok.push(m)
      if (ok.length) t.merges = ok
    }
  }
  return t
}
const overlaps = (a: Merge, b: Merge) => a.r < b.r + b.rs && b.r < a.r + a.rs && a.c < b.c + b.cs && b.c < a.c + a.cs

// ---------- a table's numbers ----------
/**
 * A cell as a number, or undefined when it is not one (letters, two numbers…) — such a cell is skipped, never
 * an error. «1 234,5», «1234.5», «-12», «1,234.50» (both marks: the last one is the fraction's).
 */
export function cellNumber(s: string): number | undefined {
  const tr = s.trim()
  // spaces inside — only between thousands («1 234 567,5»); «10 5» is two numbers, not 105
  if (/\d[\s  ]+\d/.test(tr) && !/^[+-]?\d{1,3}([\s  ]\d{3})+([.,]\d+)?$/.test(tr)) return undefined
  let x = tr.replace(/[\s  ]/g, '')
  if (!x) return undefined
  const dot = x.lastIndexOf('.')
  const comma = x.lastIndexOf(',')
  if (dot >= 0 && comma >= 0) x = dot > comma ? x.replace(/,/g, '') : x.replace(/\./g, '').replace(',', '.')
  else if (comma >= 0) x = (x.match(/,/g)!.length > 1 ? x.replace(/,/g, '') : x.replace(',', '.'))
  else if ((x.match(/\./g)?.length ?? 0) > 1) x = x.replace(/\./g, '')
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(x)) return undefined
  const v = Number(x)
  return Number.isFinite(v) ? v : undefined
}
/** The cell at (r, c) is hidden under another one's merge. */
export function coveredBy(t: TableModel, r: number, c: number): Merge | undefined {
  return t.merges?.find((m) => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs && !(r === m.r && c === m.c))
}
export const mergeAt = (t: TableModel, r: number, c: number) => t.merges?.find((m) => m.r === r && m.c === c)
/**
 * A column's sum: the numbers of its cells — a merged cell counts in every column it spans, once in each (not
 * once per row it spans). `skipped` — the cells with something else than a number.
 */
export function columnSum(t: TableModel, c: number): { sum: number; count: number; skipped: number } {
  let sum = 0
  let count = 0
  let skipped = 0
  let digits = 0
  t.rows.forEach((row, r) => {
    const m = coveredBy(t, r, c)
    // under a merge: its value, at its first row only
    if (m && r !== m.r) return
    const s = (m ? t.rows[m.r][m.c] : row[c]) ?? ''
    if (!s.trim()) return
    const v = cellNumber(s)
    if (v === undefined) return void skipped++
    sum += v
    count++
    digits = Math.max(digits, (String(v).split('.')[1] ?? '').length)
  })
  // 0.1 + 0.2 — not 0.30000000000000004
  return { sum: Number(sum.toFixed(Math.min(10, digits))), count, skipped }
}
/** A sum as people write it: «1 234,5». */
export const fmtSum = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 10 })

// ---------- merging ----------
/** Merges the rectangle (the cells inside other merges join it); as in Excel, only the first value stays (the first non-empty one, row by row). */
export function mergeCells(t: TableModel, r0: number, c0: number, r1: number, c1: number): void {
  let m: Merge = { r: Math.min(r0, r1), c: Math.min(c0, c1), rs: Math.abs(r1 - r0) + 1, cs: Math.abs(c1 - c0) + 1 }
  // grow over the merges it touches (a rectangle never cuts one)
  for (let grown = true; grown; ) {
    grown = false
    for (const o of t.merges ?? [])
      if (overlaps(o, m)) {
        const r = Math.min(m.r, o.r)
        const c = Math.min(m.c, o.c)
        const n: Merge = { r, c, rs: Math.max(m.r + m.rs, o.r + o.rs) - r, cs: Math.max(m.c + m.cs, o.c + o.cs) - c }
        if (n.r !== m.r || n.c !== m.c || n.rs !== m.rs || n.cs !== m.cs) ((m = n), (grown = true))
      }
  }
  if (m.rs * m.cs < 2) return
  const texts: string[] = []
  for (let r = m.r; r < m.r + m.rs; r++)
    for (let c = m.c; c < m.c + m.cs; c++) {
      const v = t.rows[r][c]?.trim()
      if (v) texts.push(v)
      t.rows[r][c] = ''
    }
  t.rows[m.r][m.c] = texts[0] ?? ''
  t.merges = [...(t.merges ?? []).filter((o) => !overlaps(o, m)), m]
}
export function unmergeCell(t: TableModel, r: number, c: number): void {
  t.merges = t.merges?.filter((m) => !(m.r === r && m.c === c))
  if (!t.merges?.length) t.merges = undefined
}
/** A row put at `at` (0 — the first of the body): the merges below move, the ones across grow. */
export function insertRowAt(t: TableModel, at: number): void {
  t.rows.splice(at, 0, Array(t.head.length).fill(''))
  t.merges = t.merges?.map((m) => (m.r >= at ? { ...m, r: m.r + 1 } : m.r + m.rs > at ? { ...m, rs: m.rs + 1 } : m))
}
/** The row `at` deleted: the merges across shrink (a merge's first row deleted — its text goes to the next one). */
export function deleteRowAt(t: TableModel, at: number): void {
  const out: Merge[] = []
  for (const m of t.merges ?? []) {
    if (m.r > at) out.push({ ...m, r: m.r - 1 })
    else if (m.r + m.rs <= at) out.push(m)
    else {
      if (m.r === at && m.rs > 1) t.rows[at + 1][m.c] = t.rows[at][m.c]
      const n = { ...m, rs: m.rs - 1 }
      if (n.rs * n.cs > 1) out.push(n)
    }
  }
  t.rows.splice(at, 1)
  t.merges = out.length ? out : undefined
}
export function insertColAt(t: TableModel, at: number): void {
  for (const r of t.rows) r.splice(at, 0, '')
  t.merges = t.merges?.map((m) => (m.c >= at ? { ...m, c: m.c + 1 } : m.c + m.cs > at ? { ...m, cs: m.cs + 1 } : m))
  t.sums = t.sums?.map((s) => (s >= at ? s + 1 : s))
}
export function deleteColAt(t: TableModel, at: number): void {
  const out: Merge[] = []
  for (const m of t.merges ?? []) {
    if (m.c > at) out.push({ ...m, c: m.c - 1 })
    else if (m.c + m.cs <= at) out.push(m)
    else {
      if (m.c === at && m.cs > 1) t.rows[m.r][at + 1] = t.rows[m.r][at]
      const n = { ...m, cs: m.cs - 1 }
      if (n.rs * n.cs > 1) out.push(n)
    }
  }
  for (const r of t.rows) r.splice(at, 1)
  t.merges = out.length ? out : undefined
  t.sums = t.sums?.filter((s) => s !== at).map((s) => (s > at ? s - 1 : s))
  if (!t.sums?.length) t.sums = undefined
}
const cellText = (c: string) => c.replace(/\|/g, '\\|').replace(/\n/g, '<br>').trim()
/** A table as Markdown, its columns lined up (it reads as a table in any editor). */
export function tableMd(t: TableModel): string {
  const n = t.head.length
  const all = [t.head, ...t.rows].map((r) => r.map(cellText))
  const w = Array.from({ length: n }, (_, i) => Math.max(3, ...all.map((r) => [...(r[i] ?? '')].length)))
  const pad = (s: string, i: number) => {
    const sp = w[i] - [...s].length
    const a = t.align[i]
    return a === 'right' ? ' '.repeat(sp) + s : a === 'center' ? ' '.repeat(Math.floor(sp / 2)) + s + ' '.repeat(Math.ceil(sp / 2)) : s + ' '.repeat(sp)
  }
  const row = (r: string[]) => `| ${r.map((c, i) => pad(c ?? '', i)).join(' | ')} |`
  const sep = `| ${w.map((x, i) => { const a = t.align[i]; return a === 'center' ? `:${'-'.repeat(x - 2)}:` : a === 'right' ? `${'-'.repeat(x - 1)}:` : a === 'left' ? `:${'-'.repeat(x - 1)}` : '-'.repeat(x) }).join(' | ')} |`
  const meta = [
    ...(t.widths?.some((x) => x > 0) ? [`widths=${t.widths.slice(0, n).map((x) => Math.round(x)).join(',')}`] : []),
    ...(t.sums?.length ? [`sums=${t.sums.filter((s) => s < n).join(',')}`] : []),
    ...(t.merges?.length ? [`merge=${t.merges.map((m) => `${m.r}.${m.c}.${m.rs}.${m.cs}`).join(';')}`] : []),
  ]
  const head = meta.length ? [`<!-- qa:table ${meta.join(' ')} -->`] : []
  return [...head, row(all[0]), sep, ...all.slice(1).map(row)].join('\n')
}
export const newTable = (cols: number, rows: number): TableModel => ({
  head: Array.from({ length: cols }, (_, i) => `Столбец ${i + 1}`),
  rows: Array.from({ length: Math.max(1, rows - 1) }, () => Array(cols).fill('')),
  align: Array(cols).fill(undefined),
})

// ---------- chart ----------
export type ChartType = 'bar' | 'hbar' | 'line' | 'area' | 'pie'
export const CHART_TYPES: Array<{ id: ChartType; title: string }> = [
  { id: 'bar', title: 'Столбцы' },
  { id: 'hbar', title: 'Полосы' },
  { id: 'line', title: 'Линии' },
  { id: 'area', title: 'Области' },
  { id: 'pie', title: 'Круговая' },
]
export interface ChartModel {
  type: ChartType
  title: string
  stacked: boolean
  /** The first column — the labels; the others — the series. */
  head: string[]
  rows: string[][]
}
const fenceBody = (src: string) => src.split('\n').slice(1, -1)
export function parseChart(src: string): ChartModel {
  const m: ChartModel = { type: 'bar', title: '', stacked: false, head: [], rows: [] }
  const data: string[] = []
  for (const l of fenceBody(src)) {
    const kv = /^\s*(type|title|stacked)\s*:\s*(.*)$/i.exec(l)
    if (kv && !data.length) {
      const k = kv[1].toLowerCase()
      if (k === 'type' && CHART_TYPES.some((t) => t.id === kv[2].trim())) m.type = kv[2].trim() as ChartType
      else if (k === 'title') m.title = kv[2].trim()
      else if (k === 'stacked') m.stacked = /^(true|yes|да|1)$/i.test(kv[2].trim())
    } else if (l.trim()) data.push(l)
  }
  const sep = data.some((l) => l.includes('|')) ? '|' : data.some((l) => l.includes(';')) ? ';' : data.some((l) => l.includes('\t')) ? '\t' : ','
  const cells = data.map((l) => l.split(sep).map((c) => c.trim()))
  m.head = cells[0] ?? ['Подпись', 'Значение']
  const n = m.head.length
  m.rows = cells.slice(1).map((r) => [...r, ...Array(Math.max(0, n - r.length)).fill('')].slice(0, n))
  return m
}
export function chartMd(m: ChartModel): string {
  const lines = ['```chart', `type: ${m.type}`]
  if (m.title) lines.push(`title: ${m.title}`)
  if (m.stacked) lines.push('stacked: true')
  for (const r of [m.head, ...m.rows]) lines.push(r.map((c) => c.replace(/\|/g, '/')).join(' | '))
  lines.push('```')
  return lines.join('\n')
}
/** A cell as a number («1 234,5» too); NaN when it is not one. */
export const num = (s: string) => Number(String(s).replace(/\s/g, '').replace(',', '.'))
export const NEW_CHART: ChartModel = { type: 'bar', title: 'Новый график', stacked: false, head: ['Месяц', 'План', 'Факт'], rows: [['Янв', '10', '12'], ['Фев', '14', '11'], ['Мар', '18', '20'], ['Апр', '20', '23']] }

// ---------- mermaid, toc ----------
export const mermaidBody = (src: string) => fenceBody(src).join('\n')
export const mermaidMd = (body: string) => `\`\`\`mermaid\n${body.replace(/\n+$/, '')}\n\`\`\``
export const NEW_MERMAID = 'flowchart LR\n  A[Заявка] --> B{Проверка}\n  B -- да --> C[В работу]\n  B -- нет --> D[Отказ]'
export const TOC_MD = '```toc\n```'

// ---------- callout ----------
export type CalloutType = 'note' | 'info' | 'tip' | 'success' | 'warning' | 'danger'
export const CALLOUTS: Array<{ id: CalloutType; title: string; icon: string; color: string }> = [
  { id: 'note', title: 'Заметка', icon: 'pencil', color: '#94a3b8' },
  { id: 'info', title: 'Информация', icon: 'bell', color: '#38bdf8' },
  { id: 'tip', title: 'Совет', icon: 'sparkles', color: '#a78bfa' },
  { id: 'success', title: 'Готово', icon: 'check', color: '#4ade80' },
  { id: 'warning', title: 'Внимание', icon: 'zap', color: '#fbbf24' },
  { id: 'danger', title: 'Опасно', icon: 'x', color: '#f87171' },
]
const CALLOUT_ALIAS: Record<string, CalloutType> = { abstract: 'info', summary: 'info', todo: 'info', hint: 'tip', important: 'tip', check: 'success', done: 'success', question: 'info', caution: 'warning', attention: 'warning', failure: 'danger', fail: 'danger', error: 'danger', bug: 'danger', example: 'note', quote: 'note' }
export interface CalloutModel {
  type: CalloutType
  title: string
  body: string
}
export function parseCallout(src: string): CalloutModel {
  const lines = src.split('\n').map((l) => l.replace(/^>\s?/, ''))
  const m = /^\[!(\w+)\][+-]?\s*(.*)$/.exec(lines[0] ?? '')
  const raw = (m?.[1] ?? 'note').toLowerCase()
  const type = (CALLOUTS.some((c) => c.id === raw) ? raw : (CALLOUT_ALIAS[raw] ?? 'note')) as CalloutType
  return { type, title: m?.[2] ?? '', body: lines.slice(1).join('\n') }
}
export const calloutMd = (c: CalloutModel) => [`> [!${c.type}]${c.title ? ` ${c.title}` : ''}`, ...(c.body ? c.body.split('\n') : ['']).map((l) => (l ? `> ${l}` : '>'))].join('\n')

// ---------- toggle (a fold) ----------
export interface ToggleModel {
  title: string
  body: string
  open: boolean
}
export function parseToggle(src: string): ToggleModel {
  const lines = src.split('\n')
  const open = /open/i.test(lines[0])
  const inner = lines.slice(1, -1).join('\n')
  const m = /^\s*<summary>([\s\S]*?)<\/summary>\s*\n?([\s\S]*)$/i.exec(inner)
  return { open, title: (m?.[1] ?? '').trim(), body: (m ? m[2] : inner).replace(/^\n+|\n+$/g, '') }
}
export const toggleMd = (t: ToggleModel) => `<details${t.open ? ' open' : ''}>\n<summary>${t.title.replace(/<\/?summary>/gi, '')}</summary>\n\n${t.body}\n\n</details>`

// ---------- work over a period ----------
export type WorkPeriod = 'today' | 'yesterday' | 'this-week' | 'last-week' | 'this-month' | 'last-month' | 'custom'
export const WORK_PERIODS: Array<{ id: WorkPeriod; title: string }> = [
  { id: 'today', title: 'Сегодня' },
  { id: 'yesterday', title: 'Вчера' },
  { id: 'this-week', title: 'Эта неделя' },
  { id: 'last-week', title: 'Прошлая неделя' },
  { id: 'this-month', title: 'Этот месяц' },
  { id: 'last-month', title: 'Прошлый месяц' },
  { id: 'custom', title: 'Свои даты' },
]
export interface WorkModel {
  period: WorkPeriod
  /** YYYY-MM-DD, for «custom». */
  from?: string
  to?: string
  view: 'table' | 'list'
  /** Kinds not shown (calls, meetings…). */
  hide?: string[]
}
export function parseWork(src: string): WorkModel {
  const m: WorkModel = { period: 'today', view: 'table' }
  for (const l of fenceBody(src)) {
    const kv = /^\s*(period|from|to|view|hide)\s*:\s*(.*?)\s*$/i.exec(l)
    if (!kv) continue
    const k = kv[1].toLowerCase()
    if (k === 'period' && WORK_PERIODS.some((p) => p.id === kv[2])) m.period = kv[2] as WorkPeriod
    else if ((k === 'from' || k === 'to') && /^\d{4}-\d{2}-\d{2}$/.test(kv[2])) m[k] = kv[2]
    else if (k === 'view' && (kv[2] === 'list' || kv[2] === 'table')) m.view = kv[2]
    else if (k === 'hide') m.hide = kv[2].split(/[,\s]+/).filter(Boolean)
  }
  if (m.from && m.to && m.period !== 'custom') m.period = 'custom'
  return m
}
export const workMd = (m: WorkModel) =>
  ['```work', `period: ${m.period}`, ...(m.period === 'custom' ? [`from: ${m.from ?? ''}`, `to: ${m.to ?? m.from ?? ''}`] : []), `view: ${m.view}`, ...(m.hide?.length ? [`hide: ${m.hide.join(', ')}`] : []), '```'].join('\n')
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** The days of a period (local), from — to inclusive. */
export function workRange(m: WorkModel, now = new Date()): { from: string; to: string } {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const add = (x: Date, n: number) => new Date(x.getFullYear(), x.getMonth(), x.getDate() + n)
  const monday = add(d, -((d.getDay() + 6) % 7))
  switch (m.period) {
    case 'yesterday':
      return { from: key(add(d, -1)), to: key(add(d, -1)) }
    case 'this-week':
      return { from: key(monday), to: key(add(monday, 6)) }
    case 'last-week':
      return { from: key(add(monday, -7)), to: key(add(monday, -1)) }
    case 'this-month':
      return { from: key(new Date(d.getFullYear(), d.getMonth(), 1)), to: key(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }
    case 'last-month':
      return { from: key(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: key(new Date(d.getFullYear(), d.getMonth(), 0)) }
    case 'custom': {
      const a = m.from ?? key(d)
      const b = m.to ?? a
      return a <= b ? { from: a, to: b } : { from: b, to: a }
    }
    default:
      return { from: key(d), to: key(d) }
  }
}
export interface WorkItem {
  id: string
  kind: string
  label: string
  task?: string
  start: number
  end: number
}
export interface WorkReport {
  days: Array<{ day: string; items: WorkItem[]; total: number }>
  /** Per kind: the sum of its events (parallel ones of one kind counted once). */
  byKind: Array<{ kind: string; ms: number; count: number }>
  /** All the work, parallel events counted once. */
  total: number
}
const unionOf = (list: Array<{ start: number; end: number }>) => {
  const s = [...list].sort((a, b) => a.start - b.start)
  let total = 0
  let cs = -Infinity
  let ce = -Infinity
  for (const x of s) {
    if (x.start > ce) {
      if (ce > cs) total += ce - cs
      cs = x.start
      ce = x.end
    } else ce = Math.max(ce, x.end)
  }
  if (ce > cs) total += ce - cs
  return total
}
/** The productive events of the days, by day, and the totals (now cuts an event still going on). */
export function workReport(days: Array<{ day: string; entries: Array<WorkItem & { source?: string }> }>, productive: (kind: string) => boolean, now = Date.now()): WorkReport {
  const out: WorkReport = { days: [], byKind: [], total: 0 }
  const kinds = new Map<string, WorkItem[]>()
  const all: WorkItem[] = []
  for (const d of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
    const items = d.entries
      .filter((e) => productive(e.kind) && e.start < now)
      .map((e) => ({ id: e.id, kind: e.kind, label: e.label, task: e.task, start: e.start, end: Math.min(e.end, Math.max(e.start, now)) }))
      .sort((a, b) => a.start - b.start)
    if (!items.length) continue
    out.days.push({ day: d.day, items, total: unionOf(items) })
    for (const it of items) {
      kinds.set(it.kind, [...(kinds.get(it.kind) ?? []), it])
      all.push(it)
    }
  }
  out.byKind = [...kinds].map(([kind, l]) => ({ kind, ms: unionOf(l), count: l.length })).sort((a, b) => b.ms - a.ms)
  out.total = unionOf(all)
  return out
}

// ---------- a board shown in a note ----------
/** ```board / path: <the board's vault path> ``` */
export const boardMd = (path: string) => `\`\`\`board\npath: ${path}\n\`\`\``
export function boardPathOf(src: string): string {
  for (const l of fenceBody(src)) {
    const m = /^\s*path\s*:\s*(.+?)\s*$/i.exec(l)
    if (m) return m[1]
  }
  return ''
}

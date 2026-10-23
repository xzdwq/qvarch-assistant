import type { SpanCell } from './cellGrid'

/** The named characters a spreadsheet's HTML uses (the rest come as &#N; / &#xN;). */
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** An HTML text's character references decoded. */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, ref: string) => {
    if (ref[0] !== '#') return ENTITIES[ref.toLowerCase()] ?? all
    const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
    return Number.isFinite(code) ? String.fromCodePoint(code) : all
  })
}

/** A cell's inner HTML as its text: white space as HTML shows it (runs — one space), <br> — a line break, tags gone. */
function cellText(inner: string): string {
  return decodeEntities(
    inner
      .replace(/\s+/g, ' ')
      .replace(/<br\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim()
}

/** A span attribute of a cell's tag (rowspan=2, colspan="3"); none — undefined. */
function spanAttr(attrs: string, name: 'rowspan' | 'colspan'): number | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+)`, 'i').exec(attrs)
  return m ? Number(m[1]) : undefined
}

/**
 * The first table of an HTML text (what Excel, Google Sheets, LibreOffice put on the clipboard) as rows of cells with
 * their spans; no table — undefined. Comments (Office's conditional ones) are dropped; a cell ends at its closing tag,
 * at the next cell or at the next row.
 */
export function htmlTableCells(html: string): SpanCell[][] | undefined {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '')
  const start = clean.search(/<table\b/i)
  if (start < 0) return undefined
  const endMatch = /<\/table\s*>/i.exec(clean.slice(start))
  const table = clean.slice(start, endMatch ? start + endMatch.index : undefined)
  const rows: SpanCell[][] = []
  let row: SpanCell[] | undefined
  let cell: { attrs: string; from: number } | undefined
  const closeCell = (at: number) => {
    if (!cell || !row) return
    row.push({ text: cellText(table.slice(cell.from, at)), rowSpan: spanAttr(cell.attrs, 'rowspan'), colSpan: spanAttr(cell.attrs, 'colspan') })
    cell = undefined
  }
  for (const m of table.matchAll(/<(\/?)(tr|td|th)\b([^>]*)>/gi)) {
    const [tag, close, nameRaw, attrs] = m
    const name = nameRaw.toLowerCase()
    const at = m.index
    if (name === 'tr') {
      closeCell(at)
      if (!close) rows.push((row = []))
      continue
    }
    closeCell(at)
    if (!close) {
      if (!row) rows.push((row = []))
      cell = { attrs, from: at + tag.length }
    }
  }
  closeCell(table.length)
  return rows.some((r) => r.length) ? rows : undefined
}

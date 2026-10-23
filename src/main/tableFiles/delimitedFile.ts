import { IMPORT_LIMITS, parseDelimited, rectangular, trimGrid, type ImportedSheet } from '../../shared/tableData'

/**
 * A text file's bytes as text: a BOM tells its encoding (UTF-8, UTF-16); without one — UTF-8 if it is valid, else
 * Windows-1251 (what Excel saves a «CSV» in on a Russian Windows).
 */
export function decodeText(data: Uint8Array): string {
  const bom = (...b: number[]) => b.every((x, i) => data[i] === x)
  if (bom(0xef, 0xbb, 0xbf)) return new TextDecoder('utf-8').decode(data.subarray(3))
  if (bom(0xff, 0xfe)) return new TextDecoder('utf-16le').decode(data.subarray(2))
  if (bom(0xfe, 0xff)) return new TextDecoder('utf-16be').decode(data.subarray(2))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return new TextDecoder('windows-1251').decode(data)
  }
}

/** A CSV / TSV file as one sheet (its separator found by its lines; cut at the limits). */
export function readDelimited(data: Uint8Array, name: string): ImportedSheet[] {
  const grid = trimGrid(parseDelimited(decodeText(data)))
  const truncated = grid.rows.length > IMPORT_LIMITS.rows || (grid.rows[0]?.length ?? 0) > IMPORT_LIMITS.cols
  const cut = rectangular({ rows: grid.rows.slice(0, IMPORT_LIMITS.rows).map((r) => r.slice(0, IMPORT_LIMITS.cols)), merges: [] })
  return [{ name, grid: cut, truncated: truncated || undefined }]
}

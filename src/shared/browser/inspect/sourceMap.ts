/**
 * A built script's place back in its source (Source Map v3): the mappings decoded up to the line asked, its
 * original file, line and the code around it (from sourcesContent). An index map (sections) is not read.
 */

export interface RawSourceMap {
  version?: number
  sources?: string[]
  sourcesContent?: Array<string | null>
  sourceRoot?: string
  names?: string[]
  mappings?: string
  sections?: unknown[]
}
export interface OriginalPlace {
  source: string
  /** 1-based. */
  line: number
  column: number
  name?: string
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const DIGIT = new Map([...B64].map((c, i) => [c, i]))

/** A segment's numbers (base64 VLQ). */
export function decodeVlq(seg: string): number[] {
  const out: number[] = []
  let value = 0
  let shift = 0
  for (const c of seg) {
    const d = DIGIT.get(c)
    if (d === undefined) return out
    value += (d & 31) << shift
    if (d & 32) shift += 5
    else {
      out.push(value & 1 ? -(value >>> 1) : value >>> 1)
      value = 0
      shift = 0
    }
  }
  return out
}

/** Where a built script's place (0-based line and column) comes from; none — not mapped. */
export function originalPlace(map: RawSourceMap, line: number, column: number): OriginalPlace | undefined {
  if (map.sections || !map.mappings || !map.sources) return undefined
  const lines = map.mappings.split(';')
  if (line >= lines.length) return undefined
  // (the source, its line and column, the name — relative across all the lines before)
  let src = 0
  let oLine = 0
  let oCol = 0
  let name = 0
  let best: OriginalPlace | undefined
  for (let l = 0; l <= line; l++) {
    let gCol = 0
    for (const seg of lines[l].split(',')) {
      if (!seg) continue
      const v = decodeVlq(seg)
      gCol += v[0]
      if (v.length < 4) continue
      src += v[1]
      oLine += v[2]
      oCol += v[3]
      if (v.length >= 5) name += v[4]
      if (l === line && gCol <= column) best = { source: sourceName(map, src), line: oLine + 1, column: oCol, ...(v.length >= 5 && map.names?.[name] ? { name: map.names[name] } : {}) }
    }
  }
  return best
}
const sourceName = (map: RawSourceMap, i: number) => `${map.sourceRoot ? map.sourceRoot.replace(/\/?$/, '/') : ''}${map.sources?.[i] ?? '?'}`

/** The code around an original place (its lines numbered), when the map carries the sources. */
export function sourceAround(map: RawSourceMap, place: OriginalPlace, before = 3, after = 25): string | undefined {
  const i = map.sources?.findIndex((s) => place.source.endsWith(s)) ?? -1
  const text = i >= 0 ? map.sourcesContent?.[i] : undefined
  if (!text) return undefined
  const lines = text.split('\n')
  const from = Math.max(0, place.line - 1 - before)
  const to = Math.min(lines.length, place.line + after)
  return lines
    .slice(from, to)
    .map((l, k) => `${String(from + k + 1).padStart(5)}  ${l}`)
    .join('\n')
}

/** A script's source map address: its `//# sourceMappingURL=`, its SourceMap header; resolved against the script. */
export function sourceMapUrl(scriptUrl: string, declared: string | undefined): string | undefined {
  if (!declared) return undefined
  if (declared.startsWith('data:')) return declared
  try {
    return new URL(declared, scriptUrl).href
  } catch {
    return undefined
  }
}

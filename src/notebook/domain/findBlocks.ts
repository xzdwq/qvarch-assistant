import { ALL_BLOCK_SPECS } from '../blocks/specs'
import { parseInfo } from './blockInfo'
import { FENCE_SCAN_ORDER, type BlockKind, type BlockSpec, type FenceHeader, type NoteBlock } from './blockSpec'
import { FENCE_OPEN, findFenceClose } from './fence'

/**
 * Finds the components of a note's text. Each line is offered to the line detectors (a loop's start, a picture, a
 * table, a callout…) in their order; a fence is taken whole — the fence specs decide what it is, an unknown fence
 * is plain code (the lines inside it are never looked at).
 */
type LineSpec = BlockSpec & { detect: { by: 'lines'; order: number; match(lines: readonly string[], i: number): number | undefined } }
type FenceSpec = BlockSpec & { detect: { by: 'fence'; matches(h: FenceHeader): boolean } }

const LINE_SPECS: LineSpec[] = ALL_BLOCK_SPECS.filter((s): s is LineSpec => s.detect.by === 'lines').sort((a, b) => a.detect.order - b.detect.order)
const FENCE_SPECS: FenceSpec[] = ALL_BLOCK_SPECS.filter((s): s is FenceSpec => s.detect.by === 'fence')
const BEFORE_FENCE = LINE_SPECS.filter((s) => s.detect.order < FENCE_SCAN_ORDER)
const AFTER_FENCE = LINE_SPECS.filter((s) => s.detect.order >= FENCE_SCAN_ORDER)

/** The kind of a fence by its opening line (undefined — plain code). */
export function fenceKindOf(header: FenceHeader): BlockKind | undefined {
  return FENCE_SPECS.find((s) => s.detect.matches(header))?.kind
}
/** A fence's opening line split into what the fence specs look at. */
export function fenceHeaderOf(lang: string, attrs: string): FenceHeader {
  return { lang: lang.toLowerCase(), attrs, info: parseInfo(`${lang} ${attrs}`) }
}

/** The kind of a fence by its info line as typed after the marker («ts run name=x»; undefined — plain code). */
export function fenceKindOfInfoLine(infoLine: string): BlockKind | undefined {
  const [lang = '', ...rest] = infoLine.trim().split(/\s+/)
  return fenceKindOf(fenceHeaderOf(lang, rest.join(' ')))
}

/** The components of a note's text, in order. */
export function findBlocks(lines: readonly string[]): NoteBlock[] {
  const out: NoteBlock[] = []
  const block = (kind: BlockKind, i: number, last: number) => out.push({ kind, line0: i + 1, line1: last + 1, src: lines.slice(i, last + 1).join('\n') })
  /** Tries the line detectors at line i; the index after the block found, or undefined. */
  const tryLines = (specs: LineSpec[], i: number): number | undefined => {
    for (const s of specs) {
      const last = s.detect.match(lines, i)
      if (last === undefined) continue
      block(s.kind, i, last)
      return last + 1
    }
    return undefined
  }
  let i = 0
  while (i < lines.length) {
    const before = tryLines(BEFORE_FENCE, i)
    if (before !== undefined) {
      i = before
      continue
    }
    const fence = FENCE_OPEN.exec(lines[i])
    if (fence) {
      const close = findFenceClose(lines, i + 1, fence[1])
      const kind = fenceKindOf(fenceHeaderOf(fence[2], fence[3]))
      if (close < lines.length && kind) block(kind, i, close)
      i = close < lines.length ? close + 1 : lines.length
      continue
    }
    i = tryLines(AFTER_FENCE, i) ?? i + 1
  }
  return out
}

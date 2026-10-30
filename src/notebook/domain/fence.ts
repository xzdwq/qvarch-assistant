import { infoMd, parseInfo, type BlockInfo } from './blockInfo'

/**
 * Fenced blocks (``` or ~~~, three and more): their opening line, their closing line, their parts.
 * The one place that knows the fence syntax — every scanner of the note goes through here.
 */

/** An opening fence line: [1] the marker, [2] the language, [3] the rest of the info line. */
export const FENCE_OPEN = /^(`{3,}|~{3,})\s*([\w-]*)([^`]*)$/

/** The index of the line closing a fence opened with `marker` (searched from `from`); `lines.length` — never closed. */
export function findFenceClose(lines: readonly string[], from: number, marker: string): number {
  const close = new RegExp(`^${marker[0]}{${marker.length},}\\s*$`)
  let j = from
  while (j < lines.length && !close.test(lines[j])) j++
  return j
}

/** A fenced block's text taken apart: its marker, its info line, its body. */
export interface FenceParts {
  fence: string
  info: BlockInfo
  body: string
}
export function splitFence(src: string): FenceParts {
  const lines = src.split('\n')
  const m = /^(`{3,}|~{3,})(.*)$/.exec(lines[0]) ?? ['', '```', '']
  return { fence: m[1], info: parseInfo(m[2]), body: lines.slice(1, -1).join('\n') }
}
/** A fenced block's text put back together. */
export const joinFence = (fence: string, info: BlockInfo, body: string) => `${fence}${infoMd(info)}\n${body}\n${fence}`

/** The lines between a block's fences. */
export const fenceBodyLines = (src: string) => src.split('\n').slice(1, -1)

/** A field of a block's body lines (`key: value` on a line of its own; '' — none). */
export function fieldOfLines(lines: readonly string[], key: string): string {
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(.*?)\\s*$`, 'i')
  for (const l of lines) {
    const m = re.exec(l)
    if (m) return m[1]
  }
  return ''
}
/** A field of a block's body (its whole text, fences too) — a block's settings a path may be in. */
export const bodyField = (src: string, key: string): string => fieldOfLines(fenceBodyLines(src), key)
/** A block's text with a field set (its line replaced, or added at the end of the body; '' — the line taken away). */
export function withBodyField(src: string, key: string, value: string): string {
  const lines = src.split('\n')
  const re = new RegExp(`^(\\s*${key}\\s*:\\s*).*$`, 'i')
  const at = lines.findIndex((l, i) => i > 0 && i < lines.length - 1 && re.test(l))
  if (!value) return at >= 0 ? lines.filter((_, i) => i !== at).join('\n') : src
  if (at >= 0) lines[at] = lines[at].replace(re, `$1${value}`)
  else lines.splice(Math.max(1, lines.length - 1), 0, `${key}: ${value}`)
  return lines.join('\n')
}

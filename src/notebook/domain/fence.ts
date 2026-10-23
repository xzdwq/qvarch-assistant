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

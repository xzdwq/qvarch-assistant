import type { BlockDetector } from '../domain/blockSpec'

/**
 * The common ways a kind is recognized, so a spec says what it is in one line: a fence of its own language with
 * nothing after it (```chart), or a single line of its own (a picture embed).
 */

/** A fence of this language with no attributes (```chart; ```chart x is plain code). */
export const fenceOfLang = (lang: string): BlockDetector => ({ by: 'fence', matches: (h) => h.lang === lang && !h.attrs.trim() })

/** A single line matching the pattern. */
export const singleLine = (order: number, re: RegExp): BlockDetector => ({ by: 'lines', order, match: (lines, i) => (re.test(lines[i]) ? i : undefined) })

/** Height estimates: a fixed one, or a base plus so much per line of the block's text. */
export const fixedHeight = (px: number) => () => px
export const heightPerLine = (base: number, perLine: number) => (src: string) => base + src.split('\n').length * perLine

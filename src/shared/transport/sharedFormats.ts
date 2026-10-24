import { BOARD_EXT, parseBoard, serializeBoard } from '../whiteboard'
import { SharedBoard } from './sharedBoard'
import { SharedModel, SharedText } from './sharedText'
import { mediaRefs, sharedDocOf, sharedMark, withSharedMark } from './space'

/**
 * The kinds of files a shared space holds — each with its mark (which document of the server it is), its model
 * (how its changes merge), its media. A note marks itself on its first line, a board — in its JSON.
 */
export interface SharedFormat {
  /** The notebook's kind of the file (a new one is made as it). */
  kind: 'note' | 'board'
  ext: string
  /** The document a file's text is of ('' — not a shared file). */
  docOf(text: string): string
  /** How a file of this document starts (found by its first bytes, without reading it whole). */
  head(doc: string): string
  /** The text marked as this document's / the mark taken away (a plain local file again). */
  mark(text: string, doc: string): string
  unmark(text: string): string
  model(): SharedModel
  /** The media files the text shows (`.images/…`, `.audio/…`). */
  media(text: string): string[]
}

/** A board's mark: right after `{"v":1,` — read without parsing the whole board. */
const BOARD_MARK = /^\{"v":1,"shared":"([0-9a-f-]{36})"/

export const SHARED_FORMATS: Record<string, SharedFormat> = {
  '.md': {
    kind: 'note',
    ext: '.md',
    docOf: sharedDocOf,
    head: sharedMark,
    mark: withSharedMark,
    unmark: (text) => {
      const doc = sharedDocOf(text)
      return doc ? text.replace(`${sharedMark(doc)}\n`, '') : text
    },
    model: () => new SharedText(),
    media: mediaRefs,
  },
  [BOARD_EXT]: {
    kind: 'board',
    ext: BOARD_EXT,
    docOf: (text) => BOARD_MARK.exec(text)?.[1] ?? '',
    head: (doc) => `{"v":1,"shared":"${doc}"`,
    mark: (text, doc) => serializeBoard({ ...parseBoard(text), shared: doc }),
    unmark: (text) => serializeBoard({ ...parseBoard(text), shared: undefined }),
    model: () => new SharedBoard(),
    media: (text) => [...new Set(parseBoard(text).items.flatMap((i) => (i.type === 'image' ? [i.src] : [])))],
  },
}
/** The format of a file by its name (none — it is never shared). */
export function formatOf(path: string): SharedFormat | undefined {
  const ext = /\.[^./]+$/.exec(path)?.[0].toLowerCase() ?? ''
  return Object.hasOwn(SHARED_FORMATS, ext) ? SHARED_FORMATS[ext] : undefined
}
/** The shared document of a file's text ('' — not shared, or not a kind that is). */
export const sharedDocOfFile = (path: string, text: string): string => formatOf(path)?.docOf(text) ?? ''

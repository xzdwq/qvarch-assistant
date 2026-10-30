import { filesKeptOf, PARTIAL_MODES, SAVE_FORMATS, type PartialMode, type SaveFormat } from '../../../shared/valueFiles'
import { fieldOfLines, withBodyField } from '../../domain/fence'

/**
 * «Сохранить в файл» (```save): a variable of the note kept as a file each run. Its settings are lines of its body —
 * a folder's path may have spaces:
 *
 *   ```save
 *   ref: rows
 *   format: auto            auto (by the value) | xlsx | csv | json | txt
 *   dir: D:\exports         a folder (none — Documents\Qvarch\exports)
 *   files: 30               keep the last 30 files (none — all)
 *   partial: skip           a run's partial value: mark (saved, «(частично)» in its name) | skip
 *   ```
 */
export interface SaveSettings {
  ref: string
  format: SaveFormat
  dir: string
  files?: number
  partial: PartialMode
}
/** The settings' keys (as the body's lines name them). */
export const SAVE_KEYS = ['ref', 'format', 'dir', 'files', 'partial'] as const satisfies ReadonlyArray<keyof SaveSettings>
export type SaveKey = (typeof SAVE_KEYS)[number]

const oneOf = <T extends string>(all: readonly T[], v: string, def: T): T => ((all as readonly string[]).includes(v) ? (v as T) : def)
/** A block's settings from its body (a missing or wrong one — its default). */
export function saveOf(body: string): SaveSettings {
  const lines = body.split('\n')
  const f = (k: SaveKey) => fieldOfLines(lines, k)
  const files = filesKeptOf(f('files'))
  return {
    ref: f('ref').replace(/^\{\{\s*|\s*\}\}$/g, ''),
    format: oneOf(SAVE_FORMATS, f('format').toLowerCase(), 'auto'),
    dir: f('dir'),
    ...(files ? { files } : {}),
    partial: oneOf(PARTIAL_MODES, f('partial').toLowerCase(), 'mark'),
  }
}
/** The defaults left out of the text (a block says only what differs). */
const DEFAULTS: Partial<Record<SaveKey, string>> = { format: 'auto', partial: 'mark' }
/** A block's body with a setting changed (a default or an empty one — its line taken away). */
export function withSave(body: string, key: SaveKey, value: string): string {
  // (the body as a block's text for a moment: the fields' one way of being written)
  const src = withBodyField(`\n${body}\n`, key, value === DEFAULTS[key] ? '' : value.trim())
  return src.split('\n').slice(1, -1).join('\n')
}
/** A new block saving a variable. */
export const saveMd = (ref = ''): string => `\`\`\`save\nref: ${ref}\n\`\`\``
/** The variable's root name (what is saved and checked for being partial: `login` of `login.body`). */
export const refRoot = (ref: string): string => /^[A-Za-z_$][\w$]*/.exec(ref)?.[0] ?? ''

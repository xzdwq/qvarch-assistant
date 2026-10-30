import { isTabular } from './valueGrid'

/**
 * A value of a note kept as a file each run (the «Сохранить в файл» block): the format chosen by what the value is
 * (rows — Excel, a text — .txt, the rest — JSON) or given; a file of its own each run, named «документ - переменная -
 * дд.мм.гг чч-мм-сс»; written only when the value changed since the last file (its hash); a value of a run that did not
 * end well — with «(частично)» in its name, or not at all; the last N files of the block kept, if asked.
 */

/** The formats a value is written in. */
export const VALUE_FILE_FORMATS = ['xlsx', 'csv', 'json', 'txt'] as const
export type ValueFileFormat = (typeof VALUE_FILE_FORMATS)[number]
/** What a block asks for: one of them, or chosen by the value. */
export const SAVE_FORMATS = ['auto', ...VALUE_FILE_FORMATS] as const
export type SaveFormat = (typeof SAVE_FORMATS)[number]
/** A partial value (its run stopped or failed): saved with a mark in its name, or skipped. */
export const PARTIAL_MODES = ['mark', 'skip'] as const
export type PartialMode = (typeof PARTIAL_MODES)[number]
/** At most this many files kept by `files=` (none — all). */
export const VALUE_FILES_MAX = 100_000

/** A value written: where it is, its hash (what the next run compares with), or unchanged — not written. */
export interface ValueFileSaved {
  file?: string
  hash: string
  unchanged?: boolean
  /** Older files of the block taken away (files=N). */
  removed?: number
}
export interface ValueFileJob {
  /** The document's and the variable's names (the file's name starts with them). */
  note: string
  name: string
  value: unknown
  format: ValueFileFormat
  /** Its folder (none — the default one). */
  dir?: string
  /** Keep the last N files of this document and variable (none — all). */
  files?: number
  partial: boolean
  /** The last file's hash (the same now — nothing written). */
  lastHash?: string
}
/** Values' files as the page calls them (window.qa.valueFile(method, …)). */
export interface ValueFileApi {
  save(job: ValueFileJob): Promise<ValueFileSaved>
  /** The folder files go to when a block names none. */
  defaultDir(): Promise<string>
  /** A file opened by its program; a folder (or a file's) shown in Explorer. */
  open(file: string): Promise<void>
  reveal(path: string): Promise<void>
  /** A folder chosen in a dialog (cancelled — none). */
  pickDir(): Promise<string | undefined>
}
export const VALUE_FILE_METHODS = ['save', 'defaultDir', 'open', 'reveal', 'pickDir'] as const satisfies ReadonlyArray<keyof ValueFileApi>

/** The format a value is written in: the one asked for, or by what it is (rows — Excel, a text — .txt, else JSON). */
export function formatFor(value: unknown, wanted: SaveFormat): ValueFileFormat {
  if (wanted !== 'auto') return wanted
  return isTabular(value) ? 'xlsx' : typeof value === 'string' ? 'txt' : 'json'
}
/** Nothing to keep: none, an empty text / list / object. */
export const isEmptyValue = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length)

/** A part of a file's name: what Windows does not take — `_`; not too long. */
export const filePart = (s: string): string => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || '_'
/** What every file of one document's variable starts with (its older files found by it). */
export const valueFileStem = (note: string, name: string): string => `${filePart(note)} - ${filePart(name)} - `
const two = (n: number) => String(n).padStart(2, '0')
/** «документ - переменная - 30.10.26 17-05-03.xlsx» (a colon is not taken by Windows — the time by dashes). */
export function valueFileName(note: string, name: string, at: Date, ext: ValueFileFormat, partial = false): string {
  const when = `${two(at.getDate())}.${two(at.getMonth() + 1)}.${two(at.getFullYear() % 100)} ${two(at.getHours())}-${two(at.getMinutes())}-${two(at.getSeconds())}`
  return `${valueFileStem(note, name)}${when}${partial ? ' (частично)' : ''}.${ext}`
}
/** files=N read: a positive whole number, capped; anything else — none (all kept). */
export const filesKeptOf = (v: string): number | undefined => {
  const n = Math.floor(Number(v))
  return n >= 1 ? Math.min(VALUE_FILES_MAX, n) : undefined
}

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

/**
 * The app's own files on disk, written so a crash or a power cut never leaves half of one: a temporary file first,
 * then renamed over the old one. A file that can no longer be read is set aside (never overwritten by defaults).
 */

/** Written whole or not at all. */
export function writeAtomic(file: string, data: string | Buffer): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, data, typeof data === 'string' ? 'utf8' : undefined)
  renameSync(tmp, file)
}

/** A value written as JSON, whole or not at all. */
export const writeJsonAtomic = (file: string, value: unknown, indent?: number): void => writeAtomic(file, JSON.stringify(value, null, indent))

/**
 * The same from a timer or on the way out, where a throw would be an uncaught error of main: a refusal (the file
 * locked by an antivirus, the disk full) is logged; the next save tries again. False — not written.
 */
export function writeJsonQuietly(file: string, value: unknown, indent?: number): boolean {
  try {
    writeJsonAtomic(file, value, indent)
    return true
  } catch (e) {
    console.error(`[fs] could not write ${file}`, e)
    return false
  }
}

/**
 * A JSON file read (none yet — undefined). One that is broken is renamed to `<file>.bad-<time>` before the caller
 * falls back to its defaults: the next save cannot destroy what may still be recovered by hand.
 */
export function readJsonFile<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (e) {
    // locked for a moment (an antivirus, a sync client) — not broken: nothing is moved
    console.error(`[fs] could not read ${file}`, e)
    return undefined
  }
  try {
    return JSON.parse(text) as T
  } catch (e) {
    const bad = `${file}.bad-${new Date().toISOString().replace(/[:.]/g, '-')}`
    try {
      renameSync(file, bad)
    } catch {
      // could not be set aside — still read as empty; the caller's next save replaces it
    }
    console.error(`[fs] broken JSON set aside: ${bad}`, e)
    return undefined
  }
}

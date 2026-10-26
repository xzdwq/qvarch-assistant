import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The tests' temporary folders: all under one folder of the system's temp — a run takes away what it made
 * (`tests/globalSetup.ts`), and what Windows still held then (a database's files a moment after its stop) is taken by a
 * later run. A test never makes its own folder straight in the temp.
 */
export const TEST_TEMP = join(tmpdir(), 'qvarch-tests')

/** A new empty folder of a test (`prefix` — what it is for: `pg-`, `vault-`…). */
export function testDir(prefix: string): string {
  mkdirSync(TEST_TEMP, { recursive: true })
  return mkdtempSync(join(TEST_TEMP, prefix))
}

/** The tests' folders made since `since` (ms) or before `before` taken away; one still held — left for a later run. */
export function sweepTestDirs(o: { since?: number; before?: number }): void {
  let names: string[]
  try {
    names = readdirSync(TEST_TEMP)
  } catch {
    return
  }
  for (const n of names) {
    const p = join(TEST_TEMP, n)
    try {
      const t = statSync(p).birthtimeMs
      if ((o.since !== undefined && t >= o.since) || (o.before !== undefined && t < o.before)) rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
    } catch {
      // still held (Windows) — a later run takes it
    }
  }
}

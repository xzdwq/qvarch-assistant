import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The temporary folders of the run processes (a note's code, a loop, a Playwright scenario, a query): each process its
 * own, as its TEMP — what it and its tools leave there (Playwright's `playwright-artifacts-…` of a browser killed with
 * the run) goes with the process. A folder still held a moment after (a browser closing) is tried again a little
 * later; what is left anyway (the app killed) is taken at the next start.
 */
const ROOT = join(tmpdir(), 'qvarch-runs')
const RETRIES_MS = [500, 3000, 15000]

/** A new folder for a process (`name` — what it runs; `root` — the folders' place, the tests' own in tests). */
export function runTempDir(name: string, root = ROOT): string {
  mkdirSync(root, { recursive: true })
  return mkdtempSync(join(root, `${name.replace(/[^\w-]+/g, '-')}-`))
}

/** A process's folder taken away (held — tried again a few times). */
export function dropRunTemp(dir: string, attempt = 0): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    if (attempt < RETRIES_MS.length) setTimeout(() => dropRunTemp(dir, attempt + 1), RETRIES_MS[attempt]).unref()
  }
}

/** At the start (no run goes on yet): what earlier runs of the app left. */
export function sweepRunTemp(root = ROOT): void {
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return
  }
  for (const n of names) dropRunTemp(join(root, n))
}

/** A process's environment with its own temp folder. */
export const envWithTemp = (dir: string): NodeJS.ProcessEnv => ({ ...process.env, TEMP: dir, TMP: dir, TMPDIR: dir })

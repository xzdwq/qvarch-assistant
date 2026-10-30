import { readdir, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Playwright's own temp folders a run left behind: a browser's profile (`playwright_chromiumdev_profile-…`), its
 * artifacts (`playwright-artifacts-…`) — Playwright takes them away when its browser closes, but a run killed before
 * that (stopped, timed out, the app closed) leaves them, hundreds of MB each time. Only these names, only ones older
 * than `olderMs`; one still in use (a browser has it open — ours or another program's) cannot be renamed on Windows
 * and is passed over: it is renamed first, taken away only then.
 */
const LEFTOVER = /^(playwright_[a-z]+dev_profile-|playwright-artifacts-)/i
export const PW_LEFTOVER_AGE = 60 * 60_000

/** The folders taken away (their count); nothing to do or no temp folder — 0. Never throws. */
export async function sweepPwLeftovers(dir = tmpdir(), olderMs = PW_LEFTOVER_AGE, now = Date.now()): Promise<number> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return 0
  }
  let removed = 0
  for (const name of names) {
    if (!LEFTOVER.test(name)) continue
    const path = join(dir, name)
    try {
      const st = await stat(path)
      if (!st.isDirectory() || now - st.mtimeMs < olderMs) continue
      // (in use — the rename fails and the folder stays whole; a half-deleted profile would break the browser using it)
      const gone = `${path}.qvarch-gone`
      await rename(path, gone)
      await rm(gone, { recursive: true, force: true })
      removed++
    } catch {
      // in use, or taken away meanwhile — the next sweep looks again
    }
  }
  return removed
}

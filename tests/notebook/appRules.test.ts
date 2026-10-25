import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The app's own rules, kept by the code itself (a new component breaking one fails here, not in someone's hands):
 * the window's code is read and each rule's one place checked.
 */
const ROOT = join(__dirname, '../../src')
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]))
const windowCode = [...files(join(ROOT, 'renderer')), ...files(join(ROOT, 'notebook'))].filter((f) => /\.(ts|vue)$/.test(f))
const rel = (f: string) => relative(ROOT, f).split(sep).join('/')
/** The files of the window that use a call (by its text). */
const usersOf = (call: RegExp) => windowCode.filter((f) => call.test(readFileSync(f, 'utf8'))).map(rel).sort()

describe('the app\'s rules', () => {
  it('a picture / a recording is shown only by following it (mediaFollow): never read once and given up on', () => {
    // (noteMedia — a file's life: its bytes kept when its line goes; transcription — the bytes to transcribe)
    expect(usersOf(/vaultRead(Image|Audio)\(/)).toEqual(['notebook/workspace/mediaFollow.ts', 'notebook/workspace/noteMedia.ts', 'notebook/workspace/transcription.ts'])
  })
  it('the server\'s events reach the window through one registry (each context its own handlers)', () => {
    expect(usersOf(/qa\.onServer\(/)).toEqual(['renderer/src/lib/serverEvents.ts'])
  })
})

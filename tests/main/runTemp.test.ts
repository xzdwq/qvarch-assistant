import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dropRunTemp, envWithTemp, runTempDir, sweepRunTemp } from '../../src/main/process/runTemp'
import { testDir } from '../testTemp'

// (a place of the test's own: the app's real folder may hold a running app's runs)
const root = testDir('runs-')

describe('run processes’ temp folders', () => {
  it('a process gets its own folder as TEMP; it goes with it', () => {
    const dir = runTempDir('Qvarch Code', root)
    writeFileSync(join(dir, 'left.txt'), 'x')
    const env = envWithTemp(dir)
    expect([env.TEMP, env.TMP, env.TMPDIR]).toEqual([dir, dir, dir])
    dropRunTemp(dir)
    expect(existsSync(dir)).toBe(false)
  })
  it('the start takes what earlier runs left', () => {
    runTempDir('pw', root)
    runTempDir('sql', root)
    sweepRunTemp(root)
    expect(readdirSync(root)).toEqual([])
  })
})

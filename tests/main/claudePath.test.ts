import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { commandOf, findClaude, viaShell } from '../../src/main/agent/claudePath'
import { testDir } from '../testTemp'

const saved = { ...process.env }
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
  Object.assign(process.env, saved)
})

describe.runIf(process.platform === 'win32')('Claude Code found where the app can see it', () => {
  it('not on the PATH (started from the desktop): the newest Node of fnm that has it; run through the shell, its folder first on the PATH', async () => {
    const root = testDir('claude-')
    for (const v of ['v20.3.0', 'v22.20.0', 'v22.3.0']) mkdirSync(join(root, 'node-versions', v, 'installation'), { recursive: true })
    writeFileSync(join(root, 'node-versions', 'v20.3.0', 'installation', 'claude.cmd'), '')
    writeFileSync(join(root, 'node-versions', 'v22.20.0', 'installation', 'claude.cmd'), '')
    const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
    // (no PATH: «where» is not found either — the usual places only)
    process.env[pathKey] = ''
    process.env.FNM_DIR = root
    process.env.USERPROFILE = root
    process.env.APPDATA = root
    process.env.LOCALAPPDATA = root
    delete process.env.NVM_HOME
    delete process.env.NVM_SYMLINK
    delete process.env.ProgramFiles
    const bin = await findClaude(true)
    const dir = join(root, 'node-versions', 'v22.20.0', 'installation')
    expect(bin?.file).toBe(join(dir, 'claude.cmd'))
    expect(viaShell(bin!)).toBe(true)
    expect(commandOf(bin!)).toBe(`"${join(dir, 'claude.cmd')}"`)
    expect(String(bin!.env[pathKey]).startsWith(dir)).toBe(true)
  })
})

import { afterAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultFiles } from '../../src/main/vault/vaultFiles'
import { VaultMeta } from '../../src/main/vault/vaultMeta'
import type { DocTurn } from '../../src/shared/agent/docAi'

const dirs: string[] = []
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))
const vault = () => {
  const d = mkdtempSync(join(tmpdir(), 'qa-ai-'))
  dirs.push(d)
  return d
}
const turn = (id: string): DocTurn => ({ id, at: 1, ms: 1, agent: 'ИИ', owner: 'Я', asker: 'Я', question: 'q', tools: {}, wrote: 0, outcome: 'ok' })

describe('what the AI keeps of the notes', () => {
  it('moves the journal out of the marks file into a row per note, once', () => {
    const d = vault()
    writeFileSync(join(d, '.meta.json'), JSON.stringify({ colors: { 'a.md': '#ff0000' }, pairs: {}, emojis: {}, docAi: { 'a.md': { memory: { text: 'цель', by: 'ИИ', at: 1 }, turns: [turn('t1')] } }, agentLines: { 'a.md': { '3': 'ИИ' } } }))
    const meta = new VaultMeta(new VaultFiles(d))
    expect(meta.docAiOf('a.md').memory?.text).toBe('цель')
    expect(meta.docAiOf('a.md').turns.map((t) => t.id)).toEqual(['t1'])
    expect(meta.agentLinesOf('a.md')).toEqual({ '3': 'ИИ' })
    expect(meta.colorOf('a.md')).toBe('#ff0000')
    const file = JSON.parse(readFileSync(join(d, '.meta.json'), 'utf8')) as Record<string, unknown>
    expect(file.docAi).toBeUndefined()
    expect(file.agentLines).toBeUndefined()
    expect(existsSync(join(d, '.ai.db'))).toBe(true)
  })
  it('follows a rename and a move of a folder; a deleted note takes its rows away', () => {
    const d = vault()
    const meta = new VaultMeta(new VaultFiles(d))
    meta.setDocAi('dir/a.md', { turns: [turn('t1')] })
    meta.setDocAi('other.md', { turns: [turn('t2')] })
    meta.remap('dir', 'moved')
    expect(meta.docAiOf('moved/a.md').turns).toHaveLength(1)
    expect(meta.docAiOf('dir/a.md').turns).toHaveLength(0)
    expect([...meta.allDocAi().keys()].sort()).toEqual(['moved/a.md', 'other.md'])
    meta.remap('other.md')
    expect(meta.docAiOf('other.md').turns).toHaveLength(0)
    meta.setDocAi('moved/a.md', { turns: [] })
    expect(meta.allDocAi().size).toBe(0)
  })
})

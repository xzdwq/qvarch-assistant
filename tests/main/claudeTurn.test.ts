import { describe, expect, it } from 'vitest'
import { claudeArgs, shellArg } from '../../src/main/agent/claudeCode'
import { CLAUDE_FLAGS, flagsIn, type ClaudeFlag } from '../../src/main/agent/claudeFlags'
import { runTools, RESULTS_UNCHANGED } from '../../src/main/tools/runTools'
import type { ToolCtx } from '../../src/main/mcpTools'

const files = { mcpFile: 'm.json', systemFile: 's.md' }
const all = new Set<ClaudeFlag>(CLAUDE_FLAGS)
/** The values given to an option (up to the next option). */
const valuesOf = (args: string[], flag: string) => {
  const i = args.indexOf(flag)
  if (i < 0) return undefined
  const rest = args.slice(i + 1)
  const end = rest.findIndex((a) => a.startsWith('--'))
  return end < 0 ? rest : rest.slice(0, end)
}

describe('a Claude Code turn: its command line', () => {
  it('no project: none of its own tools sent, only ours allowed; the dynamic sections out of the system prompt', () => {
    const args = claudeArgs(files, all)
    expect(valuesOf(args, '--tools')).toEqual([''])
    expect(valuesOf(args, '--allowedTools')).toEqual(['mcp__qvarch'])
    expect(args).toContain('--exclude-dynamic-system-prompt-sections')
    expect(args).not.toContain('--add-dir')
  })
  it('a project: its folder read by Read / Grep / Glob — sent and allowed', () => {
    const args = claudeArgs({ ...files, project: 'C:\\p', model: 'opus' }, all)
    expect(valuesOf(args, '--tools')).toEqual(['Read,Grep,Glob'])
    expect(valuesOf(args, '--allowedTools')).toEqual(['mcp__qvarch', 'Read', 'Grep', 'Glob'])
    expect(valuesOf(args, '--add-dir')).toEqual(['C:\\p'])
    expect(valuesOf(args, '--model')).toEqual(['opus'])
  })
  it('an older Claude Code without the options — run as before (never «unknown option»)', () => {
    const args = claudeArgs(files, new Set())
    expect(args).not.toContain('--tools')
    expect(args).not.toContain('--exclude-dynamic-system-prompt-sections')
    expect(valuesOf(args, '--allowedTools')).toEqual(['mcp__qvarch'])
  })
  it('through cmd: an empty argument kept as "", one with spaces quoted', () => {
    expect(shellArg('')).toBe('""')
    expect(shellArg('C:\\My Folder')).toBe('"C:\\My Folder"')
    expect(shellArg('Read,Grep,Glob')).toBe('Read,Grep,Glob')
  })
  it('the options read from its help: as options, not as parts of others', () => {
    const help = '  --allowedTools, --allowed-tools <tools...>\n  --disallowedTools, --disallowed-tools <tools...>\n  --exclude-dynamic-system-prompt-sections\n  --tools <tools...>   Specify the list'
    expect([...flagsIn(help)].sort()).toEqual([...CLAUDE_FLAGS].sort())
    expect(flagsIn('  --allowedTools, --allowed-tools <tools...>\n  --disallowed-tools <tools...>').size).toBe(0)
  })
})

describe('note_results within a turn', () => {
  const toolOf = (reports: string[]) => {
    const ctx = { ui: async () => reports.shift() } as unknown as ToolCtx
    return runTools(ctx).find((t) => t.name === 'note_results')!
  }
  it('the same results again — said so (no run since), the report still given', async () => {
    const t = toolOf(['R1', 'R1', 'R2'])
    expect(await t.run({ path: 'a' })).toBe('R1')
    const again = await t.run({ path: 'a' })
    expect(again.startsWith(RESULTS_UNCHANGED)).toBe(true)
    expect(again).toContain('R1')
    expect(await t.run({ path: 'a' })).toBe('R2')
  })
  it('each note on its own; a new tool set (another turn, an outside client) — knows nothing before', async () => {
    const t = toolOf(['R', 'R'])
    expect(await t.run({ path: 'a' })).toBe('R')
    expect(await t.run({ path: 'b' })).toBe('R')
    expect(await toolOf(['R']).run({ path: 'a' })).toBe('R')
  })
})

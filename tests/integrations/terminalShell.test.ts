import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { commandFailure, lastPromptMark, openMarkTail, parsePromptMark, shellArgs, shellEnv } from '../../src/main/terminal/shellIntegration'
import { fillInserts, insertText, variableValues } from '../../src/main/terminal/presetVariables'

const mark = (fields: string) => `\x1b]633;QV;${fields}\x07`

describe('terminal: the prompt mark', () => {
  it('reads the folder, the tools, the history entry and how the command ended', () => {
    expect(parsePromptMark('C:\\work|C:\\node.exe||C:\\pnpm.cmd|12|0|2')).toEqual({ cwd: 'C:\\work', tools: ['C:\\node.exe', '', 'C:\\pnpm.cmd'], historyId: '12', ok: '0', code: '2' })
  })
  it('takes the last mark of a chunk; none — undefined', () => {
    expect(lastPromptMark(`out${mark('C:\\a||||1|1|0')}PS> ${mark('C:\\b||||2|1|0')}PS> `)?.cwd).toBe('C:\\b')
    expect(lastPromptMark('plain output')).toBeUndefined()
  })
  it('keeps a mark split between chunks for the next one', () => {
    const tail = '\x1b]633;QV;C:\\wo'
    expect(openMarkTail(`output${tail}`)).toBe(tail)
    expect(openMarkTail(`output${mark('C:\\x||||1|1|0')}`)).toBe('')
  })
  it('a failure is its exit code; Ctrl+C (pressed or its code) is none', () => {
    expect(commandFailure(parsePromptMark('C:\\|||||0|2'), false)).toBe(2)
    expect(commandFailure(parsePromptMark('C:\\|||||0|'), false)).toBe(1)
    expect(commandFailure(parsePromptMark('C:\\|||||0|2'), true)).toBeUndefined()
    expect(commandFailure(parsePromptMark('C:\\|||||0|-1073741510'), false)).toBeUndefined()
    expect(commandFailure(parsePromptMark('C:\\|||||1|0'), false)).toBeUndefined()
  })
})

describe('terminal: the shell start', () => {
  it('the profile is skipped only when asked; the wrapper goes encoded', () => {
    expect(shellArgs(true)).not.toContain('-NoProfile')
    expect(shellArgs(false)).toContain('-NoProfile')
    const script = Buffer.from(shellArgs(true).at(-1)!, 'base64').toString('utf16le')
    expect(script).toContain('function global:prompt')
  })
  it('drops what spoils the colours and marks the terminal', () => {
    const env = shellEnv({ PATH: 'C:\\bin', NO_COLOR: '1', electron_run_as_node: '1', EMPTY: undefined })
    expect(env).toEqual({ PATH: 'C:\\bin', TERM_PROGRAM: 'qvarch', COLORTERM: 'truecolor' })
  })
})

describe('terminal: preset inserts', () => {
  it('a value as it goes into a command', () => {
    expect(insertText('feature/ABC-1'.match(/([A-Z]+-\d+)/))).toBe('ABC-1')
    expect(insertText(['whole'])).toBe('whole')
    expect(insertText(false)).toBe('')
    expect(insertText(null)).toBe('')
    expect(insertText({ a: 1 })).toBe('{"a":1}')
    expect(insertText(3)).toBe('3')
  })
  it('works out {{ js }} and collects the empty ones (not the questions)', () => {
    const ctx = vm.createContext({ task: '', branch: 'main', ask: () => '' })
    const empty: string[] = []
    expect(fillInserts('git commit -m "[{{ task }}] {{ branch.toUpperCase() }} {{ ask(\'Text\') }}"', ctx, empty)).toBe('git commit -m "[] MAIN "')
    expect(empty).toEqual(['task'])
  })
  it('a broken insert names itself', () => {
    expect(() => fillInserts('{{ nope.x }}', vm.createContext({}))).toThrow(/^\{\{nope\.x\}\}: /)
  })
  it('the values of one\'s own variables: a formula sees those above it; a failed one has its error', () => {
    const src = { cwd: process.cwd(), info: { cwd: process.cwd(), branch: 'feature/ABC-42-form' }, shell: 'powershell.exe' }
    const ok = variableValues({ ...src, vars: [{ id: '1', name: 'short', value: "currentBranch.split('/').pop()", js: true }, { id: '2', name: 'title', value: '[{{ short }}]', js: false }] })
    expect(ok.short.value).toBe('ABC-42-form')
    expect(ok.title.value).toBe('[ABC-42-form]')
    expect(ok.task.value).toBe('ABC-42')
    const bad = variableValues({ ...src, vars: [{ id: '1', name: 'a', value: '1', js: true }, { id: '2', name: 'b', value: 'missing.x', js: true }] })
    expect(bad.a.value).toBe('…')
    expect(bad.b.error).toMatch(/missing/)
  })
})

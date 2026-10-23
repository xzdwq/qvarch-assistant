import { describe, expect, it } from 'vitest'
import { BUILTIN_VARS, builtinValues, type BuiltinVarFacts } from '../../src/shared/terminal'

const facts: BuiltinVarFacts = {
  cwd: 'C:\\work\\app',
  dir: 'app',
  info: { cwd: 'C:\\work\\app', branch: 'feature/ABC-7-x', node: '22.1.0', npm: '10.0.0', dirty: 3 },
  now: new Date(2026, 0, 5, 9, 7),
  user: 'me',
  pkg: { name: 'app', version: '1.0.0' },
  lockfile: 'npm',
  env: { HOME: 'x' },
}

describe('terminal built-in variables', () => {
  it('each has a unique name and a description', () => {
    const names = BUILTIN_VARS.map((b) => b.name)
    expect(new Set(names).size).toBe(names.length)
    for (const b of BUILTIN_VARS) expect(b.desc).toBeTruthy()
  })

  it('are worked out from the facts', () => {
    const v = builtinValues(facts)
    expect(v).toMatchObject({
      currentBranch: 'feature/ABC-7-x',
      branch: 'feature/ABC-7-x',
      task: 'ABC-7',
      cwd: 'C:\\work\\app',
      dir: 'app',
      date: '2026-01-05',
      time: '09:07',
      user: 'me',
      node: '22.1.0',
      npm: '10.0.0',
      pnpm: '',
      dirty: 3,
      lockfile: 'npm',
    })
    expect(v.env).toEqual({ HOME: 'x' })
    expect(v.env).not.toBe(facts.env)
  })

  it('without a git line: empty values, no task', () => {
    const v = builtinValues({ ...facts, info: undefined })
    expect([v.branch, v.task, v.node, v.dirty]).toEqual(['', '', '', 0])
  })

  it('some are shown short', () => {
    const shown = (name: string, value: unknown) => BUILTIN_VARS.find((b) => b.name === name)?.show?.(value)
    expect(shown('pkg', { name: 'app' })).toBe('package.json «app»')
    expect(shown('pkg', undefined)).toBe('')
    expect(shown('env', { A: '1', B: '2' })).toBe('2 переменных окружения')
    expect(shown('cwd', 'x')).toBeUndefined()
  })
})

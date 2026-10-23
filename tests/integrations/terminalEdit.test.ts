import { describe, expect, it } from 'vitest'
import type { TermAlert, TermSession, TermWatch } from '../../src/shared/terminal'
import { insertOf, moveItem, shellLight, upsertById, varNameError, watchEditError, watchPatternsShort, watchTestMatch } from '../../src/shared/terminalEdit'

const watch = (p: Partial<TermWatch>): TermWatch => ({ id: 'w', name: '', patterns: '', ignoreCase: true, word: false, color: '#f00', on: true, ...p })

describe('terminal: editing the settings', () => {
  it('a variable needs a JS name of its own', () => {
    const vars = [{ id: '1', name: 'main', value: '', js: false }]
    expect(varNameError({ id: '2', name: '1x', value: '', js: false }, vars)).toMatch(/^Имя/)
    expect(varNameError({ id: '2', name: 'main', value: '', js: false }, vars)).toBe('Такая переменная уже есть')
    expect(varNameError({ id: '1', name: 'main', value: 'x', js: false }, vars)).toBe('')
  })
  it('a reaction needs a pattern; a broken regex says why', () => {
    expect(watchEditError(watch({ patterns: '  ' }))).toBe('Нужно хотя бы одно слово или регулярка')
    expect(watchEditError(watch({ patterns: '/([a/' }))).not.toBe('')
    expect(watchEditError(watch({ patterns: 'error' }))).toBe('')
  })
  it('a reaction tried on a test line', () => {
    expect(watchTestMatch(watch({ patterns: 'error' }), 'npm ERROR! code 1')).toBe('ERROR')
    expect(watchTestMatch(watch({ patterns: 'error', ignoreCase: false }), 'npm ERROR!')).toBeNull()
    expect(watchTestMatch(watch({ patterns: 'error', word: true }), 'errors only')).toBeNull()
    expect(watchPatternsShort(watch({ patterns: ' error \n\n/E\\d+/ ' }))).toBe('error · /E\\d+/')
  })
  it('lists: an edited item back in its place or at the end; moving one', () => {
    const list = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }]
    upsertById(list, { id: 'a', n: 9 })
    upsertById(list, { id: 'c', n: 3 })
    expect(list).toEqual([{ id: 'a', n: 9 }, { id: 'b', n: 2 }, { id: 'c', n: 3 }])
    expect(moveItem(['x', 'y', 'z'], 0, 2)).toEqual(['y', 'z', 'x'])
    expect(insertOf('task')).toBe('{{ task }}')
  })
  it('a tab\'s light: its notice first, then running, then a failure', () => {
    const s = { id: 's1', title: 'pwsh 1', busy: true, info: { cwd: 'C:\\' } } as TermSession
    const alert = { sid: 's1', color: '#0f0' } as TermAlert
    expect(shellLight([alert], 's1', s)).toEqual({ cls: 'alert', style: { background: '#0f0', boxShadow: '0 0 6px #0f0' } })
    expect(shellLight([], 's1', s).cls).toBe('run')
    expect(shellLight([], 's1', { ...s, busy: false, failed: 1 }).cls).toBe('err')
    expect(shellLight([], 's1', undefined).cls).toBe('')
  })
})

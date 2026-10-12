import { describe, expect, it } from 'vitest'
import { formatOffset, parseOffset, stepOffset } from '../src/shared/offset'
import { filesOf, remapPath, resolveWiki, splitAudio } from '../src/shared/vault'

describe('± minutes', () => {
  it('formats both ways', () => {
    expect(formatOffset(30)).toBe('+30м')
    expect(formatOffset(-90)).toBe('−1ч 30м')
    expect(formatOffset(120)).toBe('+2ч')
  })
  it('parses what is typed', () => {
    expect(parseOffset('30')).toBe(30)
    expect(parseOffset('-30')).toBe(-30)
    expect(parseOffset('−1:30')).toBe(-90)
    expect(parseOffset('1ч30')).toBe(90)
    expect(parseOffset('-1ч 30м')).toBe(-90)
    expect(parseOffset('1,5ч')).toBe(90)
    expect(parseOffset('2h')).toBe(120)
    expect(parseOffset('+45м')).toBe(45)
    expect(parseOffset('0')).toBeUndefined()
    expect(parseOffset('abc')).toBeUndefined()
  })
  it('steps by 10 through zero to the other side', () => {
    expect(stepOffset(10, -1)).toBe(-10)
    expect(stepOffset(-10, 1)).toBe(10)
    expect(stepOffset(15, -1)).toBe(10)
    expect(stepOffset(15, 1)).toBe(20)
    expect(stepOffset(-25, -1)).toBe(-30)
    expect(stepOffset(240, 1, 10, 240)).toBe(240)
  })
})

describe('notebook helpers', () => {
  const tree = [
    { path: 'Проект', name: 'Проект', dir: true, mtime: 0, ctime: 0, children: [{ path: 'Проект/План.md', name: 'План', dir: false, mtime: 0, ctime: 0 }] },
    { path: 'Начало.md', name: 'Начало', dir: false, mtime: 0, ctime: 0 },
  ]
  it('lists the notes and resolves [[links]] by path or name', () => {
    const files = filesOf(tree)
    expect(files).toEqual(['Проект/План.md', 'Начало.md'])
    expect(resolveWiki('план', files)).toBe('Проект/План.md')
    expect(resolveWiki('Проект/План|текст', files)).toBe('Проект/План.md')
    expect(resolveWiki('Нет такой', files)).toBeUndefined()
  })
  it('cuts recordings out of the text', () => {
    const parts = splitAudio('# A\ntext\n![[.audio/2026-10-11-abc.webm]]\nafter')
    expect(parts).toEqual([{ md: '# A\ntext' }, { audio: '.audio/2026-10-11-abc.webm', line: 2 }, { md: 'after' }])
  })
  it('follows a rename of a folder', () => {
    expect(remapPath('Проект/План.md', 'Проект', 'Работа')).toBe('Работа/План.md')
    expect(remapPath('Проекты/План.md', 'Проект', 'Работа')).toBe('Проекты/План.md')
  })
})

import { remindAt, shiftBy } from '../src/shared/repeat'
describe('repeats & reminders', () => {
  const t0 = new Date(2026, 9, 12, 10, 30).getTime()
  it('steps by hour / day / week / year', () => {
    expect(shiftBy(t0, 'hour', 2) - t0).toBe(2 * 3_600_000)
    expect(new Date(shiftBy(t0, 'day', 1)).getDate()).toBe(13)
    expect(new Date(shiftBy(t0, 'week', 1)).getDate()).toBe(19)
    expect(new Date(shiftBy(t0, 'year', 1)).getFullYear()).toBe(2027)
    // the same local time across days
    expect(new Date(shiftBy(t0, 'day', 30)).getHours()).toBe(10)
  })
  it('a reminder follows the start or stays at its moment', () => {
    expect(remindAt({ before: 10 }, t0)).toBe(t0 - 10 * 60_000)
    expect(remindAt({ at: 123 }, t0)).toBe(123)
    expect(remindAt(undefined, t0)).toBeUndefined()
  })
})

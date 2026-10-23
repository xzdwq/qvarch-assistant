import { describe, expect, it } from 'vitest'
import { isRunnableText, longDate, notesCount, shortDate, textStats } from '../../src/notebook/domain/noteFacts'
import { dirOf, noteName } from '../../src/notebook/domain/notePaths'

describe('the notes screen in words', () => {
  it('counts notes in Russian', () => {
    expect([1, 2, 5, 11, 12, 21, 22, 25, 101, 111].map(notesCount)).toEqual(['1 заметка', '2 заметки', '5 заметок', '11 заметок', '12 заметок', '21 заметка', '22 заметки', '25 заметок', '101 заметка', '111 заметок'])
  })
  it('words and characters of a text', () => {
    expect(textStats('Привет, мир 42!')).toBe('Слов: 3 · Символов: 15')
    expect(textStats('')).toBe('Слов: 0 · Символов: 0')
  })
  it('no date — no words', () => {
    expect(shortDate(0)).toBe('')
    expect(longDate(undefined)).toBe('')
    expect(shortDate(Date.UTC(2026, 9, 15, 12))).toMatch(/2026, \d\d:\d\d$/)
    expect(shortDate(Date.UTC(2026, 9, 15, 12))).not.toContain('г.')
  })
  it('a note runs when it has blocks «Выполнить всё» runs', () => {
    expect(isRunnableText('# t\n```http\nGET /\n```')).toBe(true)
    expect(isRunnableText('```ts run\n1\n```')).toBe(true)
    expect(isRunnableText('```ts\n1\n```')).toBe(false)
    expect(isRunnableText('```json name=a\n{}\n```')).toBe(true)
    expect(isRunnableText('```sql db=main\nselect 1\n```')).toBe(true)
    expect(isRunnableText('```sql\nselect 1\n```')).toBe(false)
  })
  it('a vault path: its name and folder', () => {
    expect(noteName('a/b/Note.md')).toBe('Note')
    expect(noteName('Board.QBOARD')).toBe('Board')
    expect(dirOf('a/b/Note.md')).toBe('a/b')
    expect(dirOf('Note.md')).toBe('')
  })
})

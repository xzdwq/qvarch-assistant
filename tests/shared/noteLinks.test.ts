import { describe, expect, it } from 'vitest'
import { relinked } from '../../src/shared/notebook/links'
import { resolveWiki, type VaultNode } from '../../src/shared/vault'
import { backlinks } from '../../src/main/vault/vaultSearch'

const FILES = ['Работа/План.md', 'Работа/Итоги.md', 'Архив/План.md', 'Заметки.md']

describe('links follow a renamed note', () => {
  it('by name — the new name, by path — the new path; section and label kept; code blocks untouched', () => {
    const text = 'См. [[Итоги]], [[Итоги#Цифры|цифры]] и [[Работа/Итоги]].\n```md\n[[Итоги]]\n```\n![[.images/x.png]]'
    const out = relinked(text, new Map([['Работа/Итоги.md', 'Работа/Сводка.md']]), FILES, resolveWiki)
    expect(out).toBe('См. [[Сводка]], [[Сводка#Цифры|цифры]] и [[Работа/Сводка]].\n```md\n[[Итоги]]\n```\n![[.images/x.png]]')
  })
  it('a link to another note of the same name is left; nothing to change — none', () => {
    expect(relinked('[[Архив/План]]', new Map([['Работа/План.md', 'Работа/План2.md']]), FILES, resolveWiki)).toBeUndefined()
    expect(relinked('нет ссылок', new Map([['Заметки.md', 'Новое.md']]), FILES, resolveWiki)).toBeUndefined()
  })
})

describe('backlinks', () => {
  it('the notes whose links lead to a note; itself and boards not counted', () => {
    const tree: VaultNode[] = [
      { name: 'Работа', path: 'Работа', dir: true, children: [{ name: 'План', path: 'Работа/План.md', dir: false }, { name: 'Итоги', path: 'Работа/Итоги.md', dir: false }] },
      { name: 'Заметки', path: 'Заметки.md', dir: false },
    ] as VaultNode[]
    const texts: Record<string, string> = { 'Работа/План.md': 'см. [[Итоги]] и [[План]]', 'Работа/Итоги.md': '[[Итоги#x]]', 'Заметки.md': '[[Работа/Итоги|итоги]]' }
    expect(backlinks(tree, (p) => texts[p], 'Работа/Итоги.md')).toEqual(['Работа/План.md', 'Заметки.md'])
  })
})

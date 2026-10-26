import { describe, expect, it } from 'vitest'
import { checkBlockIn } from '../../src/notebook/blocks/pw/model'
import { pageLookText } from '../../src/shared/browser/pageLook'

const note = [
  '# Тест формы',
  '',
  '```ts playwright name=form session',
  "await page.goto('https://app-dev.example/items')",
  "await page.getByRole('button', { name: 'Добавить' }).click()",
  "await page.getByLabel('Название').fill('Новый')",
  "await page.getByRole('button', { name: 'Сохранить' }).click()",
  '```',
  '',
  'Итог.',
].join('\n')

describe('a check put on a note’s scenario (the agent’s pw_check, the block’s menu)', () => {
  it('wrapped as the menu does; the time limit raised to what the check needs; the rest of the note kept', () => {
    const r = checkBlockIn(note, 'form', 'load')
    if ('error' in r) throw new Error(r.error)
    expect(r.text).toContain('qa.manyRows(')
    expect(r.text).toMatch(/```ts playwright name=form session timeout=900/)
    expect(r.text.startsWith('# Тест формы\n\n```ts playwright')).toBe(true)
    expect(r.text.endsWith('```\n\nИтог.')).toBe(true)
  })
  it('no such block, or a scenario without actions — said why', () => {
    expect(checkBlockIn(note, 'нет', 'leave')).toEqual({ error: 'В заметке нет блока Playwright «нет» (name=…)' })
    expect('error' in checkBlockIn('```ts playwright name=e\n```', 'e', 'repeat')).toBe(true)
  })
})

describe('a page as the agent looks at it', () => {
  it('a line per element with its locator; the ones past the limit counted', () => {
    const t = pageLookText({ url: 'https://x', title: 'Товары', headings: ['Товары'], items: [{ role: 'button', name: 'Сохранить', loc: "page.getByRole('button', { name: 'Сохранить' })", disabled: true }], more: 3 })
    expect(t).toContain("- button «Сохранить» (недоступна) → page.getByRole('button', { name: 'Сохранить' })")
    expect(t).toContain('ещё 3')
  })
})

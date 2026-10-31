import { describe, expect, it } from 'vitest'
import { checkValuesIn } from '../../src/notebook/blocks/pw/modelCheckValues'
import { readMatrix, unwrapCheck } from '../../src/shared/qaChecks'
import { withMatrixMode } from '../../src/shared/qaMatrixQuery'
import { readFuzz } from '../../src/shared/fuzz/spec'
import { findBlocks } from '../../src/notebook/domain/findBlocks'
import { parseCallout } from '../../src/notebook/blocks/callout/model'
import { pageLookText } from '../../src/shared/browser/pageLook'

const note = (code: string) => ['# Тест', '', '```ts playwright name=search', code, '```', ''].join('\n')
const bodyOf = (text: string) => text.split('```ts playwright name=search\n')[1].split('\n```')[0]
const matrixCode = [
  'await qa.fieldMatrix({',
  "  f1: { name: 'Поиск', value: 'болт', field: () => page.getByPlaceholder('Найти') },",
  '}, async (v) => {',
  "  await page.getByPlaceholder('Найти').fill(v.f1)",
  '}) // шаг: Матрица значений полей — каждое поле по очереди',
].join('\n')
const fuzzCode = ["await page.goto('https://site/x')", 'await qa.fuzz(', '{', '  "request": "",', '  "params": []', '}', ') // шаг: Перебор параметров запроса'].join('\n')

describe('the values of a scenario check given by the agent', () => {
  it('writes the field matrix values where «Значения матрицы» keeps them', () => {
    const r = checkValuesIn(note(matrixCode), 'search', { kind: 'matrix', fields: { Поиск: [{ label: 'длинная', expr: 'gen.text(1000)', bad: true }, { label: 'пробелы', value: '  болт  ' }] } })
    if ('error' in r) throw new Error(r.error)
    const m = readMatrix(bodyOf(r.text))!
    expect(m.fields[0].cases).toEqual([
      { label: 'длинная', expr: 'gen.text(1000)', bad: true },
      { label: 'пробелы', expr: '"  болт  "', bad: false },
    ])
  })
  it('says the mode in the matrix\'s closing line; taking the check off still gives the scenario back', () => {
    const r = checkValuesIn(note(matrixCode), 'search', { kind: 'matrix', fields: { f1: [{ label: 'a', value: 'a' }] }, mode: 'query' })
    if ('error' in r) throw new Error(r.error)
    const body = bodyOf(r.text)
    expect(body).toContain("}, { mode: 'query' }) // шаг: Матрица значений полей")
    expect(withMatrixMode(body)).toContain('}) // шаг: Матрица значений полей')
    expect(unwrapCheck(body, 'matrix')).toBe("await page.getByPlaceholder('Найти').fill('болт')")
  })
  it('says what is wrong: no matrix, an unknown field', () => {
    expect(checkValuesIn(note("await page.goto('x')"), 'search', { kind: 'matrix', fields: {} })).toMatchObject({ error: expect.stringMatching(/pw_check kind=matrix/) })
    expect(checkValuesIn(note(matrixCode), 'search', { kind: 'matrix', fields: { f9: [] } })).toMatchObject({ error: expect.stringMatching(/f1 «Поиск»/) })
    expect(checkValuesIn(note(matrixCode), 'other', { kind: 'matrix', fields: {} })).toMatchObject({ error: expect.stringMatching(/нет блока/) })
  })
  it('writes the request and its parameters to try; refuses parameters not of their shape', () => {
    const r = checkValuesIn(note(fuzzCode), 'search', { kind: 'fuzz', request: 'GET /api/items', params: [{ path: 'query.limit', cases: [{ label: 'минус', value: '"-1"' }, { label: 'нет', value: 'drop' }] }] })
    if ('error' in r) throw new Error(r.error)
    expect(readFuzz(bodyOf(r.text))!.spec).toMatchObject({ request: 'GET /api/items', params: [{ path: 'query.limit', cases: [{ label: 'минус', value: '"-1"' }, { label: 'нет', value: 'drop' }] }] })
    expect(checkValuesIn(note(fuzzCode), 'search', { kind: 'fuzz', request: 'GET /api/items', params: ['limit' as never] })).toHaveProperty('error')
    expect(checkValuesIn(note(fuzzCode), 'search', { kind: 'fuzz', request: 'https://site/api', params: [] })).toMatchObject({ error: expect.stringMatching(/метод и путь/) })
  })
})

describe('a callout written as a fence', () => {
  it('is a callout component, not code', () => {
    const lines = ['Текст', '```callout danger Дефекты', '**Опасно**', '1. Падает', '```', 'Дальше']
    const blocks = findBlocks(lines)
    expect(blocks.map((b) => [b.kind, b.line0, b.line1])).toEqual([['callout', 2, 5]])
    expect(parseCallout(blocks[0].src)).toEqual({ type: 'danger', title: 'Дефекты', body: '**Опасно**\n1. Падает' })
    expect(parseCallout('```callout\nтекст\n```').type).toBe('note')
    expect(parseCallout('> [!warning] Внимание\n> текст')).toEqual({ type: 'warning', title: 'Внимание', body: 'текст' })
  })
})

describe('a page looked at that went elsewhere', () => {
  it('says so — a sign-in is looked at again, not asked of the person at once', () => {
    const look = { url: 'https://site/login', title: 'Вход', headings: [], items: [], more: 0 }
    expect(pageLookText(look, 'https://site/list')).toMatch(/переадресация/)
    expect(pageLookText({ ...look, url: 'https://site/list' }, 'https://site/list')).not.toMatch(/переадресация/)
  })
})

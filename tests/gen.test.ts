import { describe, expect, it } from 'vitest'
import { exprToGen, gen, genLabel, genToExpr, sampleOf } from '../src/shared/gen'
import { readMatrix, wrapCheck, writeMatrix, unwrapCheck } from '../src/shared/qaChecks'

describe('gen: values made', () => {
  it('lengths, alphabets, patterns, ranges', () => {
    expect(gen.text(300)).toHaveLength(300)
    expect(gen.text(20, 'digits')).toMatch(/^\d{20}$/)
    expect(gen.text(5, 'xy')).toMatch(/^[xy]{5}$/)
    expect(gen.digits(8)).toMatch(/^[1-9]\d{7}$/)
    expect(gen.uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(gen.email('test.org')).toMatch(/^test\.[0-9a-f]{6}@test\.org$/)
    expect(gen.pattern('AA-####')).toMatch(/^[A-Z]{2}-\d{4}$/)
    for (let i = 0; i < 50; i++) expect(Number(gen.int(3, 5))).toBeGreaterThanOrEqual(3)
    expect(gen.number(1, 2, 3, true)).toMatch(/^1,\d{3}$/)
    // (today by the local clock — not UTC's, a day apart around midnight)
    const now = new Date()
    expect(gen.date(0, 'yyyy-MM-dd')).toBe(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`)
    expect(gen.repeat('ab', 5)).toBe('ababa')
    expect(gen.json({ a: [1] })).toBe('{"a":[1]}')
    expect(gen.unique('x')).not.toBe(gen.unique('x'))
  })
})

describe('gen: the editor ↔ the code', () => {
  it('a generator picked → its expression → picked back', () => {
    expect(genToExpr('text', ['300', 'en'])).toBe("gen.text(300, 'en')")
    expect(genToExpr('text', ['300', 'ru'])).toBe('gen.text(300)')
    expect(genToExpr('uuid', [])).toBe('gen.uuid()')
    expect(genToExpr('value', ["it's"])).toBe("'it\\'s'")
    expect(genToExpr('json', ['{ "id": 1 }'])).toBe('gen.json({ "id": 1 })')
    expect(exprToGen("gen.text(300, 'en')")).toEqual({ id: 'text', args: ['300', 'en'] })
    expect(exprToGen('gen.text(300)')).toEqual({ id: 'text', args: ['300', 'ru'] })
    expect(exprToGen("'it\\'s'")).toEqual({ id: 'value', args: ["it's"] })
    expect(exprToGen("''")).toEqual({ id: 'empty', args: [] })
    expect(exprToGen('gen.json({ "a": [1, 2] })')).toEqual({ id: 'json', args: ['{ "a": [1, 2] }'] })
    expect(exprToGen("gen.text(5) + '!'")).toEqual({ id: 'code', args: ["gen.text(5) + '!'"] })
  })
  it('labels and examples', () => {
    expect(genLabel('text', ['300', 'en'])).toBe('Строка 300 (латиница)')
    expect(genLabel('date', ['-1'])).toBe('Дата −1 дн.')
    expect(sampleOf('gen.text(7)')).toHaveLength(7)
    expect(sampleOf("gen.text(5) + '!'")).toBeUndefined()
  })
})

describe('the matrix\'s values of one\'s own in the code', () => {
  const form = ["await page.goto('https://app.example.com/form')", "await page.getByLabel('Название').fill('Болт')", "await page.getByRole('button', { name: 'Сохранить' }).click()"].join('\n')
  const wrapped = (wrapCheck(form, 'matrix') as { code: string }).code
  it('read: the fields, no values until one puts them', () => {
    expect(readMatrix(wrapped)?.fields).toEqual([{ id: 'f1', name: 'Название', value: "'Болт'", field: "page.getByLabel('Название')", cases: [] }])
  })
  it('a scenario of before («auto: …») read — the word left out when written', () => {
    const old = wrapped.replace("field: () => page.getByLabel('Название') },", "field: () => page.getByLabel('Название'), auto: false },")
    const f = readMatrix(old)!.fields[0]
    expect(f).toEqual({ id: 'f1', name: 'Название', value: "'Болт'", field: "page.getByLabel('Название')", cases: [] })
    expect(writeMatrix(old, [f])).not.toContain('auto')
  })
  it('a test id names the field (its stem — a v-for\'s number dropped)', () => {
    const code = (wrapCheck(form.replace("page.getByLabel('Название')", 'page.locator(\'div.rec\').getByTestId(/^item-uom[-_]\\d+$/)'), 'matrix') as { code: string }).code
    expect(readMatrix(code)?.fields[0].name).toBe('item-uom')
  })
  it('written and read back; out — as recorded', () => {
    const m = readMatrix(wrapped)!
    const f = { ...m.fields[0], cases: [{ label: 'UUID', expr: 'gen.uuid()', bad: true }, { label: 'JSON', expr: 'gen.json({ "a": { "b": [1, 2] } })', bad: false }] }
    const code = writeMatrix(wrapped, [f])
    expect(code).toContain("  f1: { name: 'Название', value: 'Болт', field: () => page.getByLabel('Название'), cases: [")
    expect(code).toContain("    { label: 'UUID', value: gen.uuid(), bad: true },")
    expect(readMatrix(code)?.fields).toEqual([f])
    expect(unwrapCheck(code, 'matrix')).toBe(form)
  })
})

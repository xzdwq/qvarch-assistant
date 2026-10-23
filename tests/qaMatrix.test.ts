import { describe, expect, it } from 'vitest'
import { casesFor, findPath, getAt, judge, kindOf, pathText, type MatrixCase } from '../src/shared/qaMatrix'

describe('Матрица: the field and its values', () => {
  it('the kind: type, label words, the value recorded', () => {
    expect(kindOf({ type: 'text' }, '123123', 'Полное наименование ENG')).toBe('text')
    expect(kindOf({ type: 'text' }, '123123', 'Поле 2')).toBe('number')
    expect(kindOf({ type: 'text' }, 'Болт', 'Наименование')).toBe('text')
    expect(kindOf({ type: 'text', label: 'Дата поставки' }, '')).toBe('date')
    expect(kindOf({ type: 'text' }, '01.02.2024')).toBe('date')
    expect(kindOf({ type: 'email' }, '')).toBe('email')
    expect(kindOf({ type: 'text' }, '', 'Цена, руб')).toBe('number')
  })
  it('the limits of the field first: maxlength, min / max', () => {
    const t = casesFor('text', { maxlength: 50 }, 'Болт')
    expect(t.find((c) => c.label === 'На 1 больше максимума (51)')?.value.length).toBe(51)
    expect(t.find((c) => c.label === 'Ровно максимум (50)')?.bad).toBe(false)
    const n = casesFor('number', { min: 1, max: 10 }, '5')
    expect(n.slice(2, 4).map((c) => c.value)).toEqual(['0', '11'])
    expect(n.filter((c) => c.value === '0').length).toBe(1)
    expect(casesFor('date', {}, '2024-05-01').find((c) => c.label.startsWith('Несуществующая'))?.value).toBe('2024-02-31')
    for (const k of ['text', 'number', 'date', 'email', 'phone'] as const) expect(casesFor(k, {}, 'x').length).toBeLessThanOrEqual(12)
  })
  it('what went in the request: the recorded value\'s place', () => {
    const body = { data: { items: [{ name: 'Болт', qty: 5 }] } }
    const p = findPath(body, '5')!
    expect(pathText(p)).toBe('data.items[0].qty')
    expect(getAt({ data: { items: [{ qty: null }] } }, p)).toEqual({ has: true, value: null })
    expect(getAt({ data: {} }, p)).toEqual({ has: false })
  })
})

describe('Матрица: the verdict of a try', () => {
  const empty: MatrixCase = { label: 'Пусто', value: '', bad: false, empty: true }
  const letters: MatrixCase = { label: 'Буквы', value: 'abc', bad: true }
  const ok = { line: 'PUT /x → 200', status: 200 }
  it('a server error — failed', () => {
    expect(judge(letters, false, { muts: [{ line: 'PUT /x → 500', status: 500, res: '{"message":"NumberFormatException"}' }], hints: [] })).toEqual({ state: 'fail', result: 'Ошибка сервера 500', detail: 'NumberFormatException' })
  })
  it('taken: a wrong value or an empty required one — a warning; what went is said', () => {
    expect(judge(letters, false, { muts: [ok], hints: [], sent: { has: true, value: null } }).detail).toBe('форма молча заменила неверное значение на пустое и сохранила')
    expect(judge(letters, false, { muts: [ok], hints: [], sent: { has: true, value: 'abc' } }).detail).toBe('неверное значение принято')
    // a number stored not as typed — a warning; as typed (a comma, spaces) — fine
    const big: MatrixCase = { label: 'Очень большое', value: '99999999999999', bad: false }
    expect(judge(big, false, { muts: [ok], hints: [], stored: '100000000000000' })).toMatchObject({ state: 'warn', detail: 'число сохранилось иначе: 99999999999999 → 100000000000000' })
    expect(judge({ label: 'Дробь', value: '1,5', bad: false }, false, { muts: [ok], hints: [], stored: '1.5' }).state).toBe('ok')
    expect(judge({ label: 'Пробелы', value: ' 22 ', bad: false }, false, { muts: [ok], hints: [], stored: '22' }).state).toBe('ok')
    expect(judge(empty, true, { muts: [ok], hints: [] }).state).toBe('warn')
    expect(judge(empty, false, { muts: [ok], hints: [] }).state).toBe('ok')
  })
  it('refused: by the form (fine), by the server without a word on the form (a warning), silently (a warning)', () => {
    expect(judge(letters, false, { muts: [], hints: ['Введите число'] })).toMatchObject({ state: 'ok', result: 'Форма не пустила' })
    expect(judge(letters, false, { muts: [{ line: 'PUT /x → 400', status: 400, res: '{"message":"qty must be a number"}' }], hints: [] })).toMatchObject({ state: 'warn', result: 'Сервер отказал (400)' })
    expect(judge(letters, false, { muts: [], hints: [], error: 'locator.click: Timeout 5000ms exceeded.' })).toMatchObject({ state: 'fail', result: 'Сценарий не прошёл' })
    expect(judge(letters, false, { muts: [], hints: [], error: 'locator.fill: Error: Cannot type text into input[type=number]' })).toMatchObject({ state: 'ok', result: 'Поле не принимает' })
  })
})

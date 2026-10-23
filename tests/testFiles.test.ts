import { describe, expect, it } from 'vitest'
import { judgeFile } from '../src/shared/testFiles'

const ok = { line: 'POST /api/import → 200', status: 200, res: '{"created":10}' }
const r400 = { line: 'POST /api/import → 400', status: 400, res: '{"message":"Колонка «Цена» пустая в строке 3"}' }
describe('a file run: its verdict against what it should lead to', () => {
  it('a server error — failed, whatever was expected', () => {
    expect(judgeFile('bad', { muts: [{ line: 'x', status: 500, res: '{"error":"NPE"}' }], hints: [] })).toEqual({ state: 'fail', result: 'Ошибка сервера 500', detail: 'NPE' })
  })
  it('taken: fine — unless it should have been refused; a «done» notification is no refusal', () => {
    expect(judgeFile('ok', { muts: [ok], hints: ['Загружено 10 строк'] })).toMatchObject({ state: 'ok', result: 'Принят' })
    expect(judgeFile('bad', { muts: [ok], hints: [] })).toMatchObject({ state: 'warn', result: 'Принят' })
  })
  it('refused: fine when expected and said; a warning when not expected or nothing said on the page', () => {
    expect(judgeFile('bad', { muts: [r400], hints: ['Ошибка: колонка «Цена» пустая'] })).toMatchObject({ state: 'ok', result: 'Отклонён (400)' })
    expect(judgeFile('bad', { muts: [r400], hints: [] })).toMatchObject({ state: 'warn', detail: 'страница ничего не сказала; сервер: Колонка «Цена» пустая в строке 3' })
    expect(judgeFile('ok', { muts: [r400], hints: [] })).toMatchObject({ state: 'warn', result: 'Отклонён (400)' })
    expect(judgeFile(undefined, { muts: [], hints: ['Неверный формат файла'] })).toMatchObject({ state: 'ok', result: 'Отклонён' })
  })
  it('nothing came of it — said', () => {
    expect(judgeFile(undefined, { muts: [], hints: [] })).toMatchObject({ state: 'warn', result: 'Файл не отправлен' })
  })
})

describe('a file run that stopped short', () => {
  it('not «taken» because some request answered 200: the step that failed and the page\'s JS error said', () => {
    expect(judgeFile(undefined, { muts: [ok], hints: [], error: 'не найден или недоступен за 10 с: locator(\'.copy\')', pageErrors: ["TypeError: Cannot read properties of null (reading 'files')"] })).toEqual({
      state: 'fail',
      result: 'Сценарий не прошёл',
      detail: "запрос ушёл (POST /api/import → 200), шаг не выполнился: не найден или недоступен за 10 с: locator('.copy'); ошибка на странице: TypeError: Cannot read properties of null (reading 'files')",
    })
  })
  it('a refused file may stop the steps after it — that is its refusal', () => {
    expect(judgeFile('bad', { muts: [r400], hints: ['Ошибка: неверный формат'], error: 'timeout' })).toMatchObject({ state: 'ok', result: 'Отклонён (400)' })
  })
  it('taken, but the page fell over it — a warning', () => {
    expect(judgeFile('ok', { muts: [ok], hints: [], pageErrors: ['TypeError: x is undefined'] })).toMatchObject({ state: 'warn', detail: 'ошибка на странице: TypeError: x is undefined' })
  })
})

import { describe, expect, it } from 'vitest'
import { checksFor, checksIn, fileSetOf, layoutModeOf, setFileSet, setLayoutMode, unwrapCheck, wrapCheck } from '../src/shared/qaChecks'

const rec = [
  'await page.setViewportSize({ width: 1228, height: 918 }) // шаг: Окно браузера',
  "await page.goto('https://app.example.com/kpa')",
  "await page.getByPlaceholder('Введите значение').fill('123') // шаг: Ввести «123»",
  "await page.getByRole('button', { name: 'Сохранить' }).click() // шаг: Нажать «Сохранить»",
  "await expect(page.locator('.x')).toContainText('кг') // шаг: -",
].join('\n')
const code = (r: ReturnType<typeof wrapCheck>) => ('code' in r ? r.code : r.error)

describe('«Проверить ▾»: the recorded actions wrapped', () => {
  it('save and leave: the last action (not a check) is the save', () => {
    const out = code(wrapCheck(rec, 'leave')).split('\n')
    expect(out[3]).toBe('await qa.saveAndLeave(async () => {')
    expect(out[4]).toBe("  await page.getByRole('button', { name: 'Сохранить' }).click() // шаг: Нажать «Сохранить»")
    expect(out[5]).toMatch(/^\}\) \/\/ шаг: Сохранить и уйти/)
    expect(out[6]).toMatch(/^await expect/)
  })
  it('a double click: the last click', () => {
    expect(code(wrapCheck(rec, 'double'))).toContain("await qa.doubleSubmit(page.getByRole('button', { name: 'Сохранить' })) // шаг: Нажать дважды")
    expect(code(wrapCheck("await page.goto('x')\nawait page.getByLabel('a').fill('1')", 'double'))).toMatch(/не клик/)
  })
  it('repeat: everything after the opening, twice', () => {
    const out = code(wrapCheck(rec, 'repeat')).split('\n')
    expect(out.slice(0, 3)).toEqual([rec.split('\n')[0], rec.split('\n')[1], 'await qa.repeat(async () => {'])
    expect(out.at(-1)).toMatch(/^\}\) \/\/ шаг: Повторить/)
  })
  it('layout: added at the end, any time', () => {
    expect(code(wrapCheck(rec, 'layout')).split('\n').at(-1)).toMatch(/^await qa\.layout\(\)/)
  })
  it('load: the last action repeated up to 300 times', () => {
    const out = code(wrapCheck(rec, 'load')).split('\n')
    expect(out[3]).toBe('await qa.manyRows(async () => {')
    expect(out[5]).toMatch(/^\}, \{ upTo: 300 \}\)/)
  })
  it('context: remember first, compare only after', () => {
    expect(code(wrapCheck(rec, 'compare'))).toMatch(/Сначала/)
    expect(checksFor(rec).some((c) => c.id === 'compare')).toBe(false)
    const with1 = code(wrapCheck(rec, 'context'))
    expect(with1).toContain("await qa.snapshot('до смены')")
    expect(checksFor(with1).some((c) => c.id === 'compare')).toBe(true)
    expect(code(wrapCheck(with1, 'compare')).split('\n').at(-1)).toMatch(/^await qa\.compareWith\('до смены'\)/)
  })
  it('reload: added at the end; nothing to wrap — said so', () => {
    expect(code(wrapCheck(rec, 'reload')).split('\n').at(-1)).toMatch(/^await qa\.sameAfterReload\(\)/)
    expect(code(wrapCheck("await page.goto('x')", 'leave'))).toMatch(/нет действий/)
  })
})

describe('«Проверить ▾»: the checks in the scenario, taken out', () => {
  it('lists them in the order they run', () => {
    let c = code(wrapCheck(rec, 'leave'))
    c = code(wrapCheck(c, 'layout'))
    c = code(wrapCheck(c, 'reload'))
    expect(checksIn(c)).toEqual(['leave', 'layout', 'reload'])
  })
  it('a wrapper out — the recorded actions back as they were', () => {
    for (const k of ['leave', 'load', 'repeat'] as const) expect(unwrapCheck(code(wrapCheck(rec, k)), k)).toBe(rec)
    expect(unwrapCheck(code(wrapCheck(rec, 'layout')), 'layout')).toBe(rec)
  })
  it('a double click out — the click back', () => {
    expect(unwrapCheck(code(wrapCheck(rec, 'double')), 'double')).toContain("await page.getByRole('button', { name: 'Сохранить' }).click()")
  })
  it('«до смены» out — its hint and its comparison too', () => {
    const c = code(wrapCheck(code(wrapCheck(rec, 'context')), 'compare'))
    expect(unwrapCheck(c, 'context')).toBe(rec)
  })
})

describe('«Проверить ▾»: the field matrix', () => {
  const form = [
    "await qa.window({ width: 1280, height: 900, dpr: 1 }) // шаг: Окно браузера",
    "await page.goto('https://app.example.com/kpa')",
    "await page.locator('div.row').filter({ has: page.getByText('Наименование:', { exact: true }) }).locator('.q-field').fill('Болт') // шаг: Ввести «Болт» в поле «Наименование»",
    "await page.getByLabel('Количество').fill('5')",
    "await page.getByRole('button', { name: 'Сохранить' }).click() // шаг: Нажать «Сохранить»",
  ].join('\n')
  it('every typed field a v.fN; the fields listed with their names, values, locators', () => {
    const out = code(wrapCheck(form, 'matrix'))
    expect(out).toContain("  f1: { name: 'Наименование', value: 'Болт', field: () => page.locator('div.row').filter({ has: page.getByText('Наименование:', { exact: true }) }).locator('.q-field') },")
    expect(out).toContain("  f2: { name: 'Количество', value: '5', field: () => page.getByLabel('Количество') },")
    expect(out).toContain("\n  await page.getByLabel('Количество').fill(v.f2)")
    expect(out.split('\n')[0]).toMatch(/^await qa\.window/)
    expect(checksIn(out)).toEqual(['matrix'])
  })
  it('out — the scenario as recorded', () => {
    expect(unwrapCheck(code(wrapCheck(form, 'matrix')), 'matrix')).toBe(form)
  })
  it('no typing / ends with typing — said why', () => {
    expect(code(wrapCheck("await page.goto('x')\nawait page.getByText('a').click()", 'matrix'))).toMatch(/нет ввода/)
    expect(code(wrapCheck("await page.goto('x')\nawait page.getByLabel('a').fill('1')", 'matrix'))).toMatch(/кончается вводом/)
  })
})

describe('«Проверить ▾»: the layout\'s way', () => {
  const rec = ["await qa.window({ width: 1280, height: 900, dpr: 1 }) // шаг: Окно браузера", "await page.goto('https://app.example.com/list')", "await page.getByRole('button', { name: 'Создать' }).click()"].join('\n')
  const here = (wrapCheck(rec, 'layout') as { code: string }).code
  it('here → each: the actions wrapped (the layout line gone); back — the line again', () => {
    expect(layoutModeOf(here)).toBe('here')
    const each = (setLayoutMode(here, 'each') as { code: string }).code
    expect(layoutModeOf(each)).toBe('each')
    expect(each.split('\n')[1]).toMatch(/^await qa\.layoutEach\(\{ widths: \[375, 768, 1280, 1920\], zooms: \[100\] \}, async \(\) => \{$/)
    expect(each).toContain("\n  await page.goto('https://app.example.com/list')")
    expect(each).not.toMatch(/qa\.layout\(\)/)
    expect(checksIn(each)).toEqual(['layout'])
    expect((setLayoutMode(each, 'here') as { code: string }).code).toBe(here)
    expect(unwrapCheck(each, 'layout')).toBe(rec)
  })
  it('not with the field matrix', () => {
    const mx = (wrapCheck("await page.goto('x')\nawait page.getByLabel('a').fill('1')\nawait page.getByText('ok').click()", 'matrix') as { code: string }).code
    expect(setLayoutMode(`${mx}\nawait qa.layout()`, 'each')).toHaveProperty('error')
  })
})

describe('«Проверить ▾»: with each file of a set', () => {
  const rec = [
    "await page.goto('https://app.example.com/import')",
    "await page.locator('input[type=\"file\"]').setInputFiles(qa.file('Записанные/товары.xlsx')) // шаг: Загрузить файл «товары.xlsx»",
    "await page.getByRole('button', { name: 'Импорт' }).click()",
  ].join('\n')
  it('offered only with an upload; the upload takes `file`, the set — the recorded file\'s', () => {
    expect(checksFor("await page.goto('x')").some((c) => c.id === 'files')).toBe(false)
    expect(checksFor(rec).some((c) => c.id === 'files')).toBe(true)
    const out = (wrapCheck(rec, 'files') as { code: string }).code
    expect(out.split('\n')[0]).toBe("await qa.eachFile({ set: 'Записанные', recorded: 'Записанные/товары.xlsx' }, async (file) => {")
    expect(out).toContain(".setInputFiles(file) // шаг: Загрузить")
    expect(checksIn(out)).toEqual(['files'])
    expect(fileSetOf(out)).toBe('Записанные')
    expect(fileSetOf(setFileSet(out, 'Импорт: ошибки'))).toBe('Импорт: ошибки')
    expect(unwrapCheck(out, 'files')).toBe(rec)
  })
  it('a drop too; no upload — said why', () => {
    const drop = "await page.goto('x')\nawait qa.dropFiles(page.locator('.drop'), qa.file('Набор/a.csv')) // шаг: Перетащить"
    expect((wrapCheck(drop, 'files') as { code: string }).code).toContain('await qa.dropFiles(page.locator(\'.drop\'), file)')
    expect(wrapCheck("await page.goto('x')", 'files')).toHaveProperty('error')
  })
})

describe('«Проверить ▾»: the upload seen while recording', () => {
  it('its request goes into the run\'s options; out — the line as it was', () => {
    const rec = [
      "await page.goto('https://app.example.com/import')",
      "await page.locator('#file').setInputFiles(qa.file('Записанные/a.xlsx')) // шаг: Загрузить файл «a.xlsx»",
      '// загрузка → POST /api/files/upload',
      "await page.getByRole('button', { name: 'Импорт' }).click()",
    ].join('\n')
    const out = (wrapCheck(rec, 'files') as { code: string }).code
    expect(out.split('\n')[0]).toBe("await qa.eachFile({ set: 'Записанные', recorded: 'Записанные/a.xlsx', upload: 'POST /api/files/upload' }, async (file) => {")
    expect(fileSetOf(setFileSet(out, 'Импорт'))).toBe('Импорт')
    expect(unwrapCheck(out, 'files')).toBe(rec)
  })
})

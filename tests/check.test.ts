import { describe, expect, it } from 'vitest'
import { badBodyIds, badUrlId, CHECK_KINDS, emptyFields, keepBody, kindMeta, normUrl, sameSite, UNSAVED_TEXT, type CheckProblem } from '../src/shared/check'
import { checkPageScript } from '../src/shared/checkPage'
import { bugNote, mergeFound, stepsFromPw, whereOf } from '../src/shared/checkBug'
import { findBlocks } from '../src/notebook/domain/findBlocks'
import { parseHttpText } from '../src/notebook/blocks/http/httpText'

describe('«Проверка»: kinds', () => {
  it('each kind found by its id; the page script tells unsaved dialogs by the same words', () => {
    for (const k of CHECK_KINDS) expect(kindMeta(k.id)).toBe(k)
    expect(kindMeta('http5xx').sev).toBe('high')
    expect(checkPageScript({ loadingMs: 1, kinds: { toast: true, dialog: true, loading: true, overflow: true, hscroll: true } })).toContain(`const UNSAVED = ${UNSAVED_TEXT}`)
  })
})

describe('«Проверка»: requests', () => {
  it('one endpoint whatever its ids', () => {
    expect(normUrl('https://app.example.com/api/nest/compounds/add/8b0607ce-ae81-418a-99f5-6653a1d3ea65?b=2&a=1')).toBe('app.example.com/api/nest/compounds/add/:id?a&b')
    expect(normUrl('https://app.example.com/api/item/12345/edit')).toBe('app.example.com/api/item/:id/edit')
  })
  it('the same site: its subdomains too, not others', () => {
    expect(sameSite('https://app.example.com/x', 'https://api.example.com/y')).toBe(true)
    expect(sameSite('https://app.example.com/x', 'https://mc.yandex.ru/watch')).toBe(false)
  })
  it('an id that is none — in the address', () => {
    expect(badUrlId('https://a.ru/api/items/undefined')).toContain('undefined')
    expect(badUrlId('https://a.ru/api/items?productId=')).toContain('productId')
    expect(badUrlId('https://a.ru/api/items?id=null')).toContain('id=null')
    expect(badUrlId('https://a.ru/api//items')).toContain('//')
    expect(badUrlId('https://a.ru/api/items/5?q=')).toBeUndefined()
  })
  it('…and in the body (an empty id sent)', () => {
    expect(badBodyIds('{"itemIds":[""],"contractorId":"","name":"","item":{"folderId":"undefined"}}')).toEqual(['itemIds[0] = ""', 'contractorId = ""', 'item.folderId = "undefined"'])
  })
  it('the empty fields of a sent form, the ids apart (a shown value sent as null)', () => {
    expect(emptyFields('{"groupId":null,"name":"x","contractorId":"","desc":""}')).toEqual(['groupId', 'desc'])
    expect(emptyFields('not json')).toEqual([])
  })
  it('the «unsaved changes» dialogs', () => {
    expect(UNSAVED_TEXT.test('Есть несохранённые изменения. Покинуть страницу?')).toBe(true)
    expect(UNSAVED_TEXT.test('Удалить запись?')).toBe(false)
  })
})

describe('the found things in a bug', () => {
  const base = { id: 'x', sev: 'mid' as const, page: 'https://a.ru/p', tabId: 't', at: 1, last: 1, count: 1, key: 'k' }
  it('a spinner names the request it waits for; the same one picked twice — one row', () => {
    const spin = (n: number) => ({ ...base, id: `s${n}`, kind: 'loading' as const, title: 'Загрузка дольше 11 с', at: n, last: n, req: { method: 'POST', url: 'https://a.ru/api/items/save' } })
    const m = mergeFound([spin(1), spin(2), spin(3), { ...base, kind: 'loading', title: 'Загрузка дольше 40 с без запросов в сети' }])
    expect(m.map((p) => [whereOf(p), p.count])).toEqual([
      ['ждём POST /api/items/save', 3],
      ['без запросов в сети', 1],
    ])
  })
})

describe('a request in the journal', () => {
  it('its body whole, however long (it runs again from the note)', () => {
    const big = JSON.stringify({ items: Array.from({ length: 800 }, (_, i) => ({ id: String(i), dateUpdated: '2026-05-08T06:50:48.536Z', uomTo: { id: '4', name: 'шт' } })) })
    expect(big.length).toBeGreaterThan(50000)
    const p: CheckProblem = { id: '1', kind: 'nulls', sev: 'low', title: 't', page: 'https://a.ru', tabId: 't', at: 1, last: 1, count: 1, key: 'k', req: { method: 'POST', url: 'https://a.ru/api/items/save', reqBody: big } }
    const md = bugNote({ title: 'x', page: p.page, steps: '', expected: '', actual: '', problems: [p], when: 1 })
    const http = findBlocks(md.split('\n')).find((b) => b.kind === 'http')!
    const r = parseHttpText(http.src.split('\n').slice(1, -1).join('\n'))
    expect(JSON.parse(r.body)).toEqual(JSON.parse(big))
  })
  it('too big to keep — none, and said so (never a cut JSON)', () => {
    expect(keepBody('x'.repeat(10))).toEqual({ reqBody: 'x'.repeat(10) })
    expect(keepBody('x'.repeat(2_000_001))).toEqual({ reqBodyCut: 2_000_001 })
  })
})

describe('recorded steps in words', () => {
  it('the usual lines', () => {
    const lines = [
      "await page.goto('https://app.example.com/kpa')",
      "await page.locator('.q-field', { has: page.locator('.q-field__label', { hasText: /^Название/ }) }).fill('Болт')",
      "await page.getByRole('button', { name: 'Сохранить' }).click()",
      "await page.locator('tbody tr', { hasText: 'Артикул 1' }).getByRole('button', { name: 'Открыть' }).dblclick()",
      "await page.getByLabel('Пароль').fill('') // пароль не записывается — подставьте сами",
      "await page.keyboard.press('Enter')",
      "await page.waitForURL('https://app.example.com/kpa/5')",
      '// записано 21.10',
    ]
    expect(stepsFromPw(lines).split('\n')).toEqual([
      '1. Открыть https://app.example.com/kpa',
      '2. Ввести «Болт» в поле «Название»',
      '3. Нажать «Сохранить»',
      '4. Дважды нажать «Открыть» в строке «Артикул 1»',
      '5. Ввести пароль в поле «Пароль»',
      '6. Нажать клавишу Enter',
      '7. Дождаться перехода на https://app.example.com/kpa/5',
    ])
  })
})

describe('a bug note', () => {
  const p: CheckProblem = {
    id: '1',
    kind: 'http5xx',
    sev: 'high',
    title: 'POST /api/nest/compounds/add/:id → 500',
    page: 'https://app.example.com/kpa',
    tabId: 't',
    at: Date.UTC(2026, 9, 21, 9, 0),
    last: Date.UTC(2026, 9, 21, 9, 0),
    count: 2,
    key: 'k',
    req: { method: 'POST', url: 'https://app.example.com/api/nest/compounds/add/8b06', status: 500, ms: 120, reqBody: '{"contractorId":""}', resBody: '{"message":"contractorId must be a UUID"}' },
  }
  const md = bugNote({ title: 'Не создаются комплекты', page: p.page, steps: '', expected: 'Комплект создан', actual: 'Ошибка 500', problems: [p], shot: '.images/x.png', when: p.at })
  it('its parts in order, its request runnable from the note', () => {
    for (const h of ['## Шаги', '## Ожидаемый результат', '## Фактический результат', '## Найдено автоматически', '## Скриншот', '## История']) expect(md).toContain(h)
    const blocks = findBlocks(md.split('\n'))
    const http = blocks.find((b) => b.kind === 'http')!
    expect(http).toBeTruthy()
    const r = parseHttpText(http.src.split('\n').slice(1, -1).join('\n'))
    expect(r.method).toBe('POST')
    expect(JSON.parse(r.body)).toEqual({ contractorId: '' })
    expect(blocks.some((b) => b.kind === 'image')).toBe(true)
    expect(blocks.some((b) => b.kind === 'table')).toBe(true)
  })
})

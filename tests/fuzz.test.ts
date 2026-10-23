import { describe, expect, it } from 'vitest'
import { gen } from '../src/shared/gen'
import { checksIn, unwrapCheck, wrapCheck } from '../src/shared/qaChecks'
import { decodeRequest, DROP, encodeRequest, evalCase, foundIn, fuzzLines, judgeFuzz, paramsOf, parsePath, pathOf, readFuzz, setPath, sizeOfCase, writeFuzz, type FuzzResult } from '../src/shared/fuzz'

const apply = (r: { method: string; url: string; contentType?: string; body?: string }, path: string, expr: string) => {
  const d = decodeRequest(r)
  const segs = parsePath(path)
  const orig = segs.reduce<unknown>((v, s) => (v as Record<string | number, unknown>)?.[s], d.tree)
  return encodeRequest(r, d, setPath(d.tree, segs, evalCase(expr, orig, gen)))
}

describe('a request taken apart and written back', () => {
  it('a JSON body: an array of 21 made of the elements sent', () => {
    const r = { method: 'POST', url: 'https://app.test/api/search', contentType: 'application/json', body: '{"filter":{"ids":[7,8]},"page":1}' }
    const out = JSON.parse(apply(r, 'body.filter.ids', 'size(21)').body!)
    expect(out.filter.ids).toHaveLength(21)
    expect(out.filter.ids.slice(0, 3)).toEqual([7, 8, 7])
    expect(out.page).toBe(1)
  })
  it('left out, null, empty', () => {
    const r = { method: 'POST', url: 'https://app.test/api/search', contentType: 'application/json', body: '{"a":"x","b":2}' }
    expect(JSON.parse(apply(r, 'body.a', 'drop').body!)).toEqual({ b: 2 })
    expect(JSON.parse(apply(r, 'body.a', 'null').body!)).toEqual({ a: null, b: 2 })
    expect(JSON.parse(apply(r, 'body.b', "''").body!)).toEqual({ a: 'x', b: '' })
  })
  it('a query in brackets with indexes (as Express qs reads it) — written back the same way', () => {
    const r = { method: 'GET', url: 'https://app.test/api/items?filter[ids][0]=1&filter[ids][1]=2&limit=10' }
    const d = decodeRequest(r)
    expect(d.tree.query).toEqual({ filter: { ids: ['1', '2'] }, limit: '10' })
    const u = new URL(apply(r, 'query.filter.ids', 'size(3)').url)
    expect([...u.searchParams.entries()]).toEqual([['filter[ids][0]', '1'], ['filter[ids][1]', '2'], ['filter[ids][2]', '1'], ['limit', '10']])
  })
  it('repeated keys stay repeated; JSON in a parameter stays JSON', () => {
    const r = { method: 'GET', url: `https://app.test/items?id=1&id=2&filter=${encodeURIComponent('{"code":{"_in":["a"]}}')}` }
    const u = new URL(apply(r, 'query.filter.code._in', 'size(2)').url)
    expect(u.searchParams.getAll('id')).toEqual(['1', '2'])
    expect(JSON.parse(u.searchParams.get('filter')!)).toEqual({ code: { _in: ['a', 'a'] } })
  })
  it('a form body', () => {
    const r = { method: 'POST', url: 'https://app.test/f', contentType: 'application/x-www-form-urlencoded', body: 'name=a&tags[]=x' }
    expect(apply(r, 'body.tags', 'size(2)').body).toBe('name=a&tags[]=x&tags[]=x')
  })
  it('the parameters offered: leaves and arrays (an object — when nested)', () => {
    const d = decodeRequest({ method: 'POST', url: 'https://app.test/s?q=1', contentType: 'application/json', body: '{"period":{"from":"2024-01-01","to":null},"ids":[1,2]}' })
    expect(paramsOf(d).map((p) => `${p.path}:${p.kind}`)).toEqual(['query.q:number', 'body.period:object', 'body.period.from:string', 'body.period.to:null', 'body.ids:array'])
  })
  it('paths: odd keys quoted', () => {
    const segs = ['body', 'a.b', 0, 'c']
    expect(pathOf(segs)).toBe('body["a.b"][0].c')
    expect(parsePath(pathOf(segs))).toEqual(segs)
    expect(setPath({ a: [1, 2] }, ['a', 0], DROP)).toEqual({ a: [2] })
  })
  it('a case\'s size', () => {
    expect(sizeOfCase('size(21)')).toBe(21)
    expect(sizeOfCase('size(5, (i) => i)')).toBe(5)
    expect(sizeOfCase('null')).toBeUndefined()
  })
})

describe('how many found', () => {
  it('a total said, a list\'s length, a path given', () => {
    expect(foundIn({ data: [1, 2, 3], meta: { total_count: 154 } }).n).toBe(154)
    expect(foundIn({ items: [1, 2] }).n).toBe(2)
    expect(foundIn([1, 2, 3, 4]).n).toBe(4)
    expect(foundIn({ result: { rows: [1] } }, 'result.rows').n).toBe(1)
    expect(foundIn({ x: 1 }).n).toBeUndefined()
  })
})

describe('the verdict', () => {
  const r = (size: number, status: number, found?: number, ms = 50): FuzzResult => ({ param: 'body.ids', label: `${size}`, value: `size(${size})`, size, status, ms, found, bytes: 10 })
  const spec = { params: [{ path: 'body.ids', cases: [], monotonic: true }] }
  it('where it breaks: «ломается с 21»', () => {
    const v = judgeFuzz({ status: 200, ms: 50 }, [r(0, 200, 0), r(1, 200, 1), r(20, 200, 20), r(21, 500), r(22, 500)], spec)
    expect(v.state).toBe('fail')
    expect(v.summary).toContain('body.ids: ломается с 21 элемента')
    expect(v.rows[3][5]).toContain('← граница')
    expect(v.marks).toEqual(['ok', 'ok', 'ok', 'fail', 'fail'])
  })
  it('more values, fewer found (200 — the qs limit turned the list into an object)', () => {
    const v = judgeFuzz({ status: 200, ms: 50 }, [r(1, 200, 1), r(20, 200, 20), r(21, 200, 0)], spec)
    expect(v.state).toBe('warn')
    expect(v.summary).toContain('при 21 найдено меньше, чем при 20')
  })
  it('slow, empty', () => {
    const v = judgeFuzz({ status: 200, ms: 100 }, [{ ...r(1, 200, 1), ms: 9000 }, { ...r(2, 200), bytes: 0 }], { params: [{ path: 'body.ids', cases: [] }] })
    expect(v.rows[0][5]).toContain('медленно')
    expect(v.rows[1][5]).toContain('пустой ответ')
  })
})

describe('the check in the code', () => {
  it('put after the actions, taken out — the scenario as it was', () => {
    const code = ["await page.goto('https://app.test/')", "await page.getByRole('button', { name: 'Найти' }).click()"].join('\n')
    const w = wrapCheck(code, 'fuzz') as { code: string }
    expect(checksIn(w.code)).toEqual(['fuzz'])
    expect(readFuzz(w.code)?.spec).toEqual({ request: '', params: [] })
    expect(unwrapCheck(w.code, 'fuzz')).toBe(code)
    expect(wrapCheck(w.code, 'fuzz')).toHaveProperty('error')
  })
  it('read and written back', () => {
    const code = ["await page.goto('https://app.test/')", ...fuzzLines({ request: 'POST /api/search', params: [] })].join('\n')
    const at = readFuzz(code)!
    expect(at.spec.request).toBe('POST /api/search')
    const next = writeFuzz(code, { ...at.spec, params: [{ path: 'body.ids', cases: [{ label: '21', value: 'size(21)' }], monotonic: true }] })
    expect(readFuzz(next)!.spec.params[0].cases[0].value).toBe('size(21)')
    expect(next.split('\n')[0]).toBe("await page.goto('https://app.test/')")
    expect(next.trimEnd().endsWith(') // шаг: Перебор параметров запроса')).toBe(true)
  })
})

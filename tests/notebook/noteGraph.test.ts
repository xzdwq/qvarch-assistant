import { describe, expect, it } from 'vitest'
import { sqlTables } from '../../src/notebook/domain/graph/sqlTables'
import { endpointOf, httpEndpoints, pathKey, urlsIn } from '../../src/notebook/domain/graph/endpoints'
import { tagsIn } from '../../src/notebook/domain/graph/tags'
import { docGraph } from '../../src/notebook/domain/graph/docGraph'
import { ReindexQueue, pauseAfter, SLICE } from '../../src/notebook/domain/graph/reindexQueue'
import { relatedNotes } from '../../src/notebook/domain/graph/related'

const uses = (sql: string) => sqlTables(sql).map((t) => `${t.use}:${t.name}`)

describe('the tables of SQL', () => {
  it('read, written, described — each once', () => {
    expect(uses('SELECT * FROM orders o JOIN customers c ON c.id = o.cid')).toEqual(['reads:orders', 'reads:customers'])
    expect(uses('INSERT INTO audit(id) SELECT id FROM orders')).toEqual(['writes:audit', 'reads:orders'])
    expect(uses('UPDATE orders SET s = 1; DELETE FROM items WHERE x')).toEqual(['writes:orders', 'writes:items'])
    expect(uses('CREATE TABLE IF NOT EXISTS public.new_t (id int); DROP TABLE old_t')).toEqual(['defines:new_t', 'defines:old_t'])
  })
  it('a list after FROM, schemas and quotes, a function is not a table', () => {
    expect(uses('select * from a x, "Sales"."B" as y, [dbo].[c] where 1')).toEqual(['reads:a', 'reads:b', 'reads:c'])
    expect(uses('SELECT * FROM generate_series(1, 3) g JOIN t ON true')).toEqual(['reads:t'])
  })
  it('comments, strings, templates and a WITH’s names are not tables', () => {
    const sql = "-- from ghost\nWITH recent AS (SELECT * FROM orders) SELECT 'from fake' FROM recent JOIN {{schema}}.items i ON true /* join nope */"
    expect(uses(sql)).toEqual(['reads:orders', 'reads:items'])
  })
  it('the line of each (in the text)', () => {
    expect(sqlTables('SELECT 1\nFROM a\nJOIN b ON true').map((t) => t.line)).toEqual([1, 2])
  })
})

describe('addresses made comparable', () => {
  it('parameters, case, the query, a trailing slash', () => {
    expect(pathKey('/Orders/42/items/?a=1')).toBe('/orders/{}/items')
    expect(pathKey('/u/{{id}}/x/:key/0f8fad5b-d9cb-469f-a165-70867728950e')).toBe('/u/{}/x/{}/{}')
  })
  it('a template base — the path only; a full address — its host too', () => {
    expect(endpointOf('{{base}}/orders/{{id}}', 'GET')).toEqual({ path: '/orders/{}', method: 'GET' })
    expect(endpointOf('https://Api.Example.test/v1/orders?x=1')).toEqual({ path: '/v1/orders', host: 'api.example.test' })
    expect(endpointOf('https://{{host}}/v1/orders')).toEqual({ path: '/v1/orders' })
    expect(endpointOf('ftp://x.test/a')).toBeUndefined()
  })
  it('an .http block of several requests, each at its line', () => {
    const body = 'GET {{base}}/orders\n\n###\nPOST https://x.test/orders/7\nContent-Type: application/json\n\n{}'
    expect(httpEndpoints(body).map((e) => [e.method, e.path, e.line])).toEqual([
      ['GET', '/orders', 0],
      ['POST', '/orders/{}', 3],
    ])
  })
  it('the full addresses of code, once each', () => {
    expect(urlsIn("await page.goto('https://x.test/login')\nfetch(\"https://x.test/login\")").map((e) => `${e.host}${e.path}`)).toEqual(['x.test/login'])
  })
})

describe('tags', () => {
  it('in the text and the front matter, nested, each once', () => {
    const text = '---\ntags: [Релиз, work]\n---\n# Заголовок\nтекст #релиз и #проект/модуль-а.'
    expect(tagsIn(text).map((t) => t.name)).toEqual(['релиз', 'work', 'проект/модуль-а'])
  })
  it('not a tag: a heading, a place in a link, code, an address, a # after a word', () => {
    expect(tagsIn('## Раздел\n[[Заметка#раздел]] `#code` https://x.test/#frag [a](https://x.test#b) C# a#b').map((t) => t.name)).toEqual([])
  })
  it('a number is a tag too', () => {
    expect(tagsIn('#1\n\nтекст #2026').map((t) => t.name)).toEqual(['1', '2026'])
  })
})

describe('a note’s edges', () => {
  const text = [
    '# План',
    'Связано с [[Итоги]] и [KEY-1](qvarch://jira/KEY-1) #релиз',
    '```sql db=main',
    'SELECT * FROM orders',
    '```',
    '```http',
    'POST {{base}}/orders',
    '```',
    '```ts playwright',
    "await page.goto('https://shop.test/cart')",
    '```',
  ].join('\n')
  const edges = docGraph(text)
  const has = (type: string, kind: string, name: string) => edges.find((e) => e.type === type && e.kind === kind && e.name === name)
  it('prose: links, tags, headings', () => {
    expect(has('links', 'note', 'итоги')?.line).toBe(1)
    expect(has('mentions', 'jira', 'KEY-1')).toBeTruthy()
    expect(has('tagged', 'tag', 'релиз')).toBeTruthy()
    expect(has('has', 'heading', 'план')?.line).toBe(0)
  })
  it('components: what they work with, at their lines', () => {
    expect(has('reads', 'table', 'orders')?.line).toBe(3)
    expect(has('calls', 'endpoint', '/orders')?.label).toBe('POST /orders')
    expect(has('opens', 'endpoint', '/cart')).toBeTruthy()
    expect(has('opens', 'host', 'shop.test')).toBeTruthy()
  })
  it('a fence’s text is not prose: no tag, link or heading from it', () => {
    expect(docGraph('```md\n# x #tag [[A]]\n```').length).toBe(0)
  })
})

describe('the reindexing queue', () => {
  const T = { quietMs: 3000, maxWaitMs: 60_000 }
  it('a note is taken once it has settled — many saves, one indexing', () => {
    const q = new ReindexQueue(T)
    for (let t = 0; t <= 2000; t += 500) q.mark('a.md', t)
    expect(q.takeDue(4000)).toEqual([])
    expect(q.nextDue()).toBe(5000)
    expect(q.takeDue(5000)).toEqual(['a.md'])
    expect(q.size).toBe(0)
  })
  it('one written to all the time — still taken after the longest wait', () => {
    const q = new ReindexQueue(T)
    for (let t = 0; t <= 61_000; t += 1000) q.mark('ai.md', t)
    expect(q.takeDue(60_000)).toEqual(['ai.md'])
  })
  it('a rename (of a folder too) carries the marks; a drop forgets', () => {
    const q = new ReindexQueue(T)
    q.mark('Папка/a.md', 0)
    q.mark('b.md', 0)
    q.rename('Папка', 'Новая')
    q.drop('b.md')
    expect(q.takeAll()).toEqual(['Новая/a.md'])
  })
  it('the pause after a slice grows with its cost, within bounds', () => {
    expect(pauseAfter(1)).toBe(SLICE.minPauseMs)
    expect(pauseAfter(100)).toBe(200)
    expect(pauseAfter(10_000)).toBe(SLICE.maxPauseMs)
  })
})

describe('related notes', () => {
  it('a link weighs most; what many notes share weighs little', () => {
    const r = relatedNotes(
      [
        { path: 'b.md', type: 'reads', kind: 'table', label: 'orders', df: 2 },
        { path: 'c.md', type: 'has', kind: 'heading', label: 'Итоги', df: 50 },
      ],
      [{ path: 'd.md', label: 'D' }],
      [],
    )
    expect(r.map((x) => x.path)).toEqual(['d.md', 'b.md', 'c.md'])
    expect(r[1].reasons[0]).toMatchObject({ via: 'shared', kind: 'table', label: 'orders' })
  })
})

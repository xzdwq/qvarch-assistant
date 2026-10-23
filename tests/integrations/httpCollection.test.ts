import { describe, expect, it } from 'vitest'
import { newFolder, newRequest, type HttpFolder, type HttpKV, type HttpNode } from '../../src/shared/http'
import {
  cloneWithNewIds,
  HTTP_COPY_FORMATS,
  jsonBodyError,
  methodShort,
  moveNode,
  parentListOf,
  parseCopiedRequest,
  prettyJson,
  requestTabCount,
  sizeLabel,
  statusClass,
  takeRunVars,
  targetListFor,
  treeRows,
} from '../../src/shared/httpCollection'

/** A collection: folder A (open: a1, folder B (closed: b1)), then r2 at the top. */
function sample() {
  const a1 = newRequest('a1')
  const b1 = newRequest('b1')
  const b = { ...newFolder('B'), open: false, children: [b1] } as HttpFolder
  const a = { ...newFolder('A'), children: [a1, b] } as HttpFolder
  const r2 = newRequest('r2')
  const items: HttpNode[] = [a, r2]
  return { items, a, a1, b, b1, r2 }
}

describe('http: the tree', () => {
  it('rows: open folders show their children one level deeper', () => {
    const { items } = sample()
    expect(treeRows(items).map((r) => `${r.depth}:${r.node.name}`)).toEqual(['0:A', '1:a1', '1:B', '0:r2'])
  })
  it('a new thing goes into the selected folder, next to the selected request, or to the top', () => {
    const { items, a, b, b1 } = sample()
    expect(targetListFor(items, b.id)).toBe(b.children)
    expect(targetListFor(items, b1.id)).toBe(b.children)
    expect(targetListFor(items, undefined)).toBe(items)
    expect(parentListOf(items, a.id)).toBe(items)
  })
  it('moves: into a folder (it opens), before a request, to the top; never into itself', () => {
    const { items, a, b, b1, r2 } = sample()
    expect(moveNode(items, r2.id, b)).toBe(true)
    expect(b.children.map((n) => n.name)).toEqual(['b1', 'r2'])
    expect(b.open).toBe(true)
    expect(moveNode(items, r2.id, b1)).toBe(true)
    expect(b.children.map((n) => n.name)).toEqual(['r2', 'b1'])
    expect(moveNode(items, b1.id)).toBe(true)
    expect(items.at(-1)).toBe(b1)
    expect(moveNode(items, a.id, b)).toBe(false)
    expect(moveNode(items, a.id, a)).toBe(false)
  })
  it('a copy gets new ids everywhere inside', () => {
    const { a, a1, b, b1 } = sample()
    const c = cloneWithNewIds(a)
    const ids = (n: HttpNode): string[] => [n.id, ...(n.type === 'folder' ? n.children.flatMap(ids) : [])]
    expect(ids(c)).toHaveLength(4)
    for (const id of [a.id, a1.id, b.id, b1.id]) expect(ids(c)).not.toContain(id)
  })
})

describe('http: the request', () => {
  it('the tab counters', () => {
    const r = newRequest('x')
    r.params = [{ on: true, key: 'a', value: '1' }, { on: false, key: 'b', value: '' }, { on: true, key: '', value: '' }]
    r.pre = { requests: ['q'], script: ' x ' }
    expect(requestTabCount(r, 'params')).toBe(1)
    expect(requestTabCount(r, 'pre')).toBe(2)
    expect(requestTabCount(r, 'post')).toBe(0)
  })
  it('a JSON body: {{vars}} count as values; a broken one says why', () => {
    expect(jsonBodyError('{"id": {{id}}, "name": "{{name}}"}')).toBe('')
    expect(jsonBodyError('   ')).toBe('')
    expect(jsonBodyError('{"a": }')).not.toBe('')
    expect(prettyJson('{"a":1}')).toEqual({ text: '{\n  "a": 1\n}', json: true })
    expect(prettyJson('plain')).toEqual({ text: 'plain', json: false })
  })
  it('a run\'s variables: changed in place, new ones before the last (empty) row', () => {
    const rows: HttpKV[] = [{ on: true, key: 'token', value: 'old' }, { on: true, key: '', value: '' }]
    takeRunVars(rows, { token: 'new', id: '7' })
    expect(rows.map((r) => `${r.key}=${r.value}`)).toEqual(['token=new', 'id=7', '='])
  })
  it('copied as «Весь запрос» reads back; anything else does not', () => {
    const r = newRequest('x')
    const text = HTTP_COPY_FORMATS.find((f) => f.id === 'all')!.get(r, {})
    expect(parseCopiedRequest(text)?.name).toBe('x')
    expect(parseCopiedRequest('{"request": {"type": "folder"}}')).toBeUndefined()
    expect(parseCopiedRequest('null')).toBeUndefined()
    expect(parseCopiedRequest('not json')).toBeUndefined()
  })
  it('labels: method, status class, size', () => {
    expect((['DELETE', 'OPTIONS', 'QUERY', 'GET'] as const).map((m) => methodShort(m))).toEqual(['DEL', 'OPT', 'QRY', 'GET'])
    expect([204, 302, 404, 503].map(statusClass)).toEqual(['s2', 's3', 'e4', 'e5'])
    expect([512, 2048, 3 * 1024 * 1024].map(sizeLabel)).toEqual(['512 Б', '2.0 КБ', '3.00 МБ'])
  })
})

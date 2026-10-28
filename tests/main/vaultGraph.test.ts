import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { VaultGraph } from '../../src/main/vault/vaultGraph'
import { testDir } from '../testTemp'

/** A notebook on disk with its graph (the files listed from what was written). */
function notebook() {
  const data = testDir('graph-')
  const root = join(data, 'vault')
  const files = new Set<string>()
  const graph = new VaultGraph(data, { abs: (rel) => join(root, rel), files: () => [...files] })
  const write = (rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), text)
    files.add(rel)
    graph.touched(rel)
  }
  const move = (from: string, to: string) => {
    mkdirSync(dirname(join(root, to)), { recursive: true })
    renameSync(join(root, from), join(root, to))
    files.delete(from)
    files.add(to)
    graph.moved(from, to)
  }
  const remove = (rel: string) => {
    rmSync(join(root, rel))
    files.delete(rel)
    graph.removed(rel)
  }
  return { graph, write, move, remove }
}

describe('the notebook’s graph', () => {
  let close: (() => void) | undefined
  afterEach(() => close?.())

  it('links resolved when asked: by name, by path; a note made later is found then', () => {
    const n = notebook()
    close = () => n.graph.close()
    n.write('Работа/План.md', 'см. [[Итоги]] и [[План]]')
    n.write('Заметки.md', '[[Работа/Итоги|итоги]]')
    expect(n.graph.backlinks('Работа/Итоги.md')).toEqual([])
    n.write('Работа/Итоги.md', '[[Итоги#x]]')
    expect(n.graph.backlinks('Работа/Итоги.md').sort()).toEqual(['Заметки.md', 'Работа/План.md'])
  })

  it('related by what they work with and their tags, with why', () => {
    const n = notebook()
    close = () => n.graph.close()
    n.write('a.md', '#релиз\n```sql db=main\nSELECT * FROM orders\n```')
    n.write('b.md', '```sql db=main\nINSERT INTO orders VALUES (1)\n```')
    n.write('c.md', 'про #релиз')
    n.write('d.md', 'ничего общего')
    const { related } = n.graph.related('a.md')
    expect(related.map((r) => r.path).sort()).toEqual(['b.md', 'c.md'])
    expect(related.find((r) => r.path === 'b.md')?.reasons[0]).toMatchObject({ kind: 'table', label: 'orders', type: 'writes' })
  })

  it('a rename moves the rows (nothing read again); a delete drops them', () => {
    const n = notebook()
    close = () => n.graph.close()
    n.write('Папка/a.md', '#общий')
    n.write('b.md', '#общий')
    expect(n.graph.related('b.md').related.map((r) => r.path)).toEqual(['Папка/a.md'])
    n.move('Папка/a.md', 'Другая/a.md')
    expect(n.graph.related('b.md').related.map((r) => r.path)).toEqual(['Другая/a.md'])
    n.remove('Другая/a.md')
    expect(n.graph.related('b.md').related).toEqual([])
  })

  it('a search: #tag finds the nested ones; a table / a path by its name', () => {
    const n = notebook()
    close = () => n.graph.close()
    n.write('a.md', '#проект/модуль')
    n.write('b.md', '```http\nGET {{base}}/api/orders/1\n```')
    expect([...n.graph.search('#проект').keys()]).toEqual(['a.md'])
    expect(n.graph.search('/api/orders').get('b.md')?.[0]).toMatchObject({ kind: 'endpoint' })
    expect(n.graph.tags()).toEqual([{ name: 'проект/модуль', label: 'проект/модуль', count: 1 }])
  })
})

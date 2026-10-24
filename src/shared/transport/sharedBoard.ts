import { diffItems, parseBoard, serializeBoard, type Board, type BoardItem } from '../whiteboard'
import { SharedModel } from './sharedText'

/**
 * A board as a Yjs document: each item by its id (its JSON), their order (the z-order), the background and the
 * board's shared id. A change goes in item by item: two people drawing at once both keep their strokes; one moving
 * an item while the other draws — both happen; the same item changed by both — the later change wins.
 */
export class SharedBoard extends SharedModel {
  private readonly items = this.y.getMap<string>('items')
  private readonly order = this.y.getArray<string>('order')
  private readonly meta = this.y.getMap<string>('meta')

  /** The items' ids in order: each once, only existing ones; ones the order misses (a race) — on top, by id. */
  private ids(): string[] {
    const seen = new Set<string>()
    const out = this.order.toArray().filter((id) => this.items.has(id) && !seen.has(id) && seen.add(id))
    return [...out, ...[...this.items.keys()].filter((id) => !seen.has(id)).sort()]
  }
  private board(): Board {
    const b = parseBoard('')
    const bg = this.meta.get('bg')
    if (bg) b.bg = JSON.parse(bg) as Board['bg']
    const shared = this.meta.get('shared')
    if (shared) b.shared = shared
    b.items = this.ids().map((id) => JSON.parse(this.items.get(id)!) as BoardItem)
    return b
  }
  get value(): string {
    return serializeBoard(this.board())
  }
  setLocal(next: string): boolean {
    const b = parseBoard(next)
    const cur = this.board()
    if (serializeBoard(b) === serializeBoard(cur)) return false
    const d = diffItems(cur.items, b.items)
    const fresh = new Set(d.put.filter((p) => !cur.items.some((i) => i.id === p.item.id)).map((p) => p.item.id))
    this.local(() => {
      if (JSON.stringify(b.bg) !== JSON.stringify(cur.bg)) this.meta.set('bg', JSON.stringify(b.bg))
      if (b.shared && b.shared !== cur.shared) this.meta.set('shared', b.shared)
      for (const id of d.del) this.items.delete(id)
      for (const { item } of d.put) this.items.set(item.id, JSON.stringify(item))
      this.placeOrder(cur.items.map((i) => i.id), b.items.map((i) => i.id), new Set(d.del), fresh)
    })
    return true
  }
  /** The order brought to the new one: the removed out, the new ones after the item they follow; moved ones — all anew. */
  private placeOrder(was: string[], now: string[], del: Set<string>, fresh: Set<string>): void {
    const arr = this.order.toArray()
    for (let k = arr.length - 1; k >= 0; k--) if (del.has(arr[k])) this.order.delete(k, 1)
    const kept = was.filter((id) => !del.has(id))
    const keptNow = now.filter((id) => !fresh.has(id))
    if (kept.join() !== keptNow.join()) {
      // the existing items changed places (to the front / back): the whole order written anew
      this.order.delete(0, this.order.length)
      this.order.insert(0, now)
      return
    }
    now.forEach((id, k) => {
      if (!fresh.has(id)) return
      const at = k ? this.order.toArray().indexOf(now[k - 1]) + 1 : 0
      this.order.insert(at, [id])
    })
  }
}

import { LAYOUT_PROPS, PAINT_PROPS, type AnimCost } from './constants'
import type { AnimEvent, AnimStat } from './types'

/** The most animations summed per page (a page making new ones without end — the oldest go). */
const MAX_STATS = 300

/** What an animation costs by its properties: any that lays out — layout; any that paints — paint; else the compositor's. */
export function animCost(props: string[]): AnimCost {
  if (props.some((p) => LAYOUT_PROPS.test(p))) return 'layout'
  if (props.some((p) => PAINT_PROPS.test(p))) return 'paint'
  return 'composite'
}

/**
 * The page's animations summed by what and where (the element and the animation's name / the transition's
 * property): how many times, how many run now, their time all together and the longest, infinite ones.
 */
export class AnimStats {
  private stats = new Map<string, AnimStat>()
  private going = new Map<string, { key: string; at: number }>()
  changed = false

  start(a: AnimEvent): void {
    const key = `${a.target}|${a.kind}|${a.name}`
    let s = this.stats.get(key)
    if (!s) {
      s = { key, kind: a.kind, name: a.name, target: a.target, props: a.props, cost: a.cost, count: 0, running: 0, total: 0, max: 0, last: a.at, infinite: !!a.infinite }
      this.stats.set(key, s)
      if (this.stats.size > MAX_STATS) this.stats.delete(this.stats.keys().next().value!)
    }
    s.count++
    s.running++
    s.last = a.at
    s.infinite ||= !!a.infinite
    this.going.set(a.id, { key, at: a.at })
    this.changed = true
  }
  end(id: string, at: number): void {
    const g = this.going.get(id)
    if (!g) return
    this.going.delete(id)
    const s = this.stats.get(g.key)
    if (!s) return
    s.running = Math.max(0, s.running - 1)
    const ms = Math.max(0, at - g.at)
    s.total += ms
    s.max = Math.max(s.max, ms)
    this.changed = true
  }
  /** The heaviest first: layout before paint before the compositor, then the most time. */
  list(): AnimStat[] {
    const rank: Record<AnimCost, number> = { layout: 0, paint: 1, composite: 2 }
    return [...this.stats.values()].sort((a, b) => rank[a.cost] - rank[b.cost] || b.total + b.running * 1000 - (a.total + a.running * 1000))
  }
  reset(): void {
    this.stats.clear()
    this.going.clear()
    this.changed = true
  }
}

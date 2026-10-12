import { ref } from 'vue'

/**
 * Note pins that sit on top of each other spread apart on hover so each can be picked. A pin knows its
 * cluster (pins closer than `gap` px, chained) and its place in it; the hovered cluster fans out. Leaving
 * closes it only after a short delay — moving the pointer across the small gaps to a fanned pin keeps it open.
 */
export interface FanPlace {
  key: string
  i: number
  n: number
}

export function clusterize<T extends { id: string }>(items: T[], pos: (t: T) => number, gap = 14, group: (t: T) => string = () => ''): Map<string, FanPlace> {
  const out = new Map<string, FanPlace>()
  const sorted = [...items].sort((a, b) => group(a).localeCompare(group(b)) || pos(a) - pos(b))
  let cluster: T[] = []
  const flush = () => {
    cluster.forEach((t, i) => out.set(t.id, { key: cluster[0].id, i, n: cluster.length }))
    cluster = []
  }
  for (const t of sorted) {
    const prev = cluster[cluster.length - 1]
    if (prev && (group(prev) !== group(t) || pos(t) - pos(prev) >= gap)) flush()
    cluster.push(t)
  }
  flush()
  return out
}

export function useFan(closeMs = 320) {
  const open = ref<string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    open,
    enter(key: string): void {
      clearTimeout(timer)
      open.value = key
    },
    leave(): void {
      clearTimeout(timer)
      timer = setTimeout(() => (open.value = undefined), closeMs)
    },
    /** The pin's shift: fanned out (`step` px apart) when its cluster is open, slightly stacked otherwise. */
    shift(p: FanPlace | undefined, step = 19, dir: 1 | -1 = 1): string {
      if (!p || p.n < 2) return ''
      return `translateX(${dir * p.i * (open.value === p.key ? step : 3)}px)`
    },
  }
}

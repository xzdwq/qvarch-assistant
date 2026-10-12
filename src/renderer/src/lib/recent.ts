import type { Entry } from '@shared/types'
import type { Recent } from '../components/LabelInput.vue'

/** Unique labels, most recent first — fuel for the label autocomplete. */
export function recentLabels(...lists: Entry[][]): Recent[] {
  const all = lists.flat().sort((a, b) => b.end - a.end)
  const seen = new Set<string>()
  const out: Recent[] = []
  for (const e of all) {
    if (!e.label || seen.has(e.label)) continue
    seen.add(e.label)
    out.push({ label: e.label, kind: e.kind })
  }
  return out
}

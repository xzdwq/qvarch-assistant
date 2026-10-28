import { computed, shallowRef, watch } from 'vue'
import { keepNotes } from '@shared/vaultTree'
import { docs } from './noteDocs'
import { layout } from './paneLayout'
import { tree } from './vaultTreeStore'

/**
 * The tree's filter by a tag (`layout.tag`, kept with the layout): the notes of the tag (nested tags too), asked of
 * the notebook's graph again when the tag, the tree or a saved text changes (a tag typed or taken away) — a moment
 * after the last change, not on every key.
 */
export const tagged = shallowRef<ReadonlySet<string>>()
const REFRESH_MS = 1200
let timer: ReturnType<typeof setTimeout> | undefined

/** The tag's notes asked again (none chosen — no filter). */
export async function refreshTagged(): Promise<void> {
  const tag = layout.tag
  if (!tag) return void (tagged.value = undefined)
  const paths = await window.qa.vaultTagged(tag).catch(() => [])
  if (layout.tag === tag) tagged.value = new Set(paths)
}
const later = () => {
  clearTimeout(timer)
  timer = setTimeout(() => void refreshTagged(), REFRESH_MS)
}
watch(() => layout.tag, () => void refreshTagged(), { immediate: true })
watch(tree, later)
watch(() => [...docs.values()].map((d) => d.saved), later)

/** The tree as shown: the tag's notes only (their folders unfolded) — or all of it. */
export const shownTree = computed(() => (layout.tag && tagged.value ? keepNotes(tree.value, tagged.value) : undefined))

/** The tree filtered by a tag (the same one again — the filter off). */
export function filterByTag(tag: string | undefined): void {
  layout.tag = tag && tag !== layout.tag ? tag : undefined
  if (layout.tag) layout.sideTab = 'files'
}

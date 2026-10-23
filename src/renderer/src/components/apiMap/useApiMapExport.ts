import { ref, type ComputedRef, type Ref, type ShallowRef } from 'vue'
import { apiMapMd, type ApiEndpoint } from '@shared/apiMap'
import { httpRequestText, type HttpExample } from '@shared/httpBlock'
import type { ApiOp } from '@shared/openapi'
import { appendToNote, authFor, blocksOf } from '../../lib/apiCopy'
import { openNote } from '../../lib/mentions'
import { exampleOf } from './apiMapFormat'

/** The folder of the notes made from the map. */
const NOTES_DIR = 'Карты API'
const safe = (s: string) => s.replace(/[:/\\?*"<>|]/g, '_')

/**
 * «Карта API» carried out: a request to the clipboard (with the site's login), the picked ones as ```http blocks,
 * into a note there is, or a note of their own; the whole map — the site's note, written anew.
 */
export function useApiMapExport(o: {
  host: Ref<string>
  list: ShallowRef<ApiEndpoint[]>
  picked: Ref<Set<string>>
  /** The site's Swagger beside the map, and how they compare (none — not found). */
  spec: ComputedRef<{ title: string; ops: ApiOp[] } | undefined>
  cmp: ComputedRef<{ byKey: Record<string, ApiOp>; notCalled: ApiOp[] } | undefined>
}) {
  const { host, list, picked } = o
  /** What was just copied (its key) — its button says so for a moment. */
  const copied = ref('')
  async function copy(text: string, what: string): Promise<void> {
    await navigator.clipboard.writeText(text)
    copied.value = what
    setTimeout(() => copied.value === what && (copied.value = ''), 1500)
  }
  /** One endpoint's request — with the site's login — to the clipboard. */
  async function copyOne(e: ApiEndpoint): Promise<void> {
    const x = exampleOf(e)
    if (!x) return
    await copy(httpRequestText(x, (await authFor([x.url]))(x.url)), e.key)
  }
  const pickedExamples = () => list.value.filter((e) => picked.value.has(e.key)).map(exampleOf).filter((x): x is HttpExample => !!x)
  /** The picked requests as ready ```http blocks of the notebook — to paste into any note. */
  async function copyPicked(): Promise<void> {
    const xs = pickedExamples()
    if (!xs.length) return
    await copy(await blocksOf(xs), 'picked')
  }

  /** The note just made (a link to it), what went wrong. */
  const made = ref<{ path: string; name: string }>()
  const mdErr = ref('')
  const noteName = (path: string) => path.split('/').pop()!.replace(/\.md$/, '')
  /** The picked requests at the end of a note there is (only the requests; their names free in it). */
  async function toExisting(path: string): Promise<void> {
    mdErr.value = ''
    try {
      const xs = pickedExamples()
      if (!xs.length) return
      await appendToNote(path, xs)
      picked.value = new Set()
      made.value = { path, name: noteName(path) }
      void openNote(path)
    } catch (err) {
      mdErr.value = err instanceof Error ? err.message : String(err)
    }
  }
  /** A note: the whole map (the site's note written anew) or the picked ones (a new note each time). */
  async function toNote(onlyPicked = false): Promise<void> {
    mdErr.value = ''
    try {
      const some = onlyPicked ? list.value.filter((e) => picked.value.has(e.key)) : list.value
      if (!some.length) return
      const spec = o.spec.value
      const cmp = o.cmp.value
      // (the Swagger's «never called» — news of a whole map, not of a few picked ones)
      const sp = spec && cmp ? { title: spec.title, byKey: cmp.byKey, notCalled: onlyPicked ? [] : cmp.notCalled } : undefined
      const text = apiMapMd(host.value, some, sp, await authFor(some.map((e) => (e.sample ?? e.errSample)?.url ?? '').filter(Boolean)))
      const tree = await window.qa.vaultTree()
      if (!tree.some((n) => n.dir && n.path === NOTES_DIR)) await window.qa.vaultCreate('', 'folder', NOTES_DIR)
      const one = some.length === 1 ? `${some[0].method} ${some[0].path.split('/').filter((x) => x && x !== ':id').pop() ?? ''}`.trim() : `методов ${some.length}`
      const name = safe(onlyPicked ? `${host.value} — ${one}` : host.value)
      const want = `${NOTES_DIR}/${name}.md`
      const has =
        !onlyPicked &&
        (await window.qa.vaultRead(want).then(
          () => true,
          () => false,
        ))
      const path = has ? (await window.qa.vaultWrite(want, text), want) : await window.qa.vaultCreate(NOTES_DIR, 'note', name, text)
      if (onlyPicked) picked.value = new Set()
      made.value = { path, name: noteName(path) }
      void openNote(path)
    } catch (e) {
      mdErr.value = e instanceof Error ? e.message : String(e)
    }
  }
  /** The note picker's choice: a note there is, or a new one. */
  const onPickNote = (path: string | null) => void (path ? toExisting(path) : toNote(true))
  return { copied, copy, copyOne, copyPicked, made, mdErr, toNote, onPickNote }
}

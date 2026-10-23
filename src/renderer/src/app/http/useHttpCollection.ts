import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { allRequests, DEFAULT_HTTP_SETTINGS, findNode, newFolder, newRequest, type HttpDoc, type HttpNode } from '@shared/http'
import { cloneWithNewIds, moveNode, parentListOf, parseCopiedRequest, targetListFor, treeRows, varMapOf } from '@shared/httpCollection'
import { backTo } from '../../lib/httpRuns'

const SEL_KEY = 'qa.http.sel'

/**
 * The HTTP collection: loaded once and kept by itself (a moment after the last change, and when the section closes);
 * the tree of requests and folders, the selected node, adding / copying / removing / moving nodes.
 */
export function useHttpCollection() {
  const doc = reactive<HttpDoc>({ v: 1, items: [], vars: [], settings: { ...DEFAULT_HTTP_SETTINGS } })
  const loaded = ref(false)
  const sel = ref<string | undefined>(localStorage.getItem(SEL_KEY) ?? undefined)
  watch(sel, (v) => {
    try {
      if (v) localStorage.setItem(SEL_KEY, v)
    } catch {
      // fine
    }
  })
  void window.qa.httpLoad().then((d) => {
    doc.items = d.items
    doc.vars = d.vars
    doc.settings = { ...DEFAULT_HTTP_SETTINGS, ...d.settings }
    loaded.value = true
    if (!sel.value || !findNode(doc.items, sel.value)) sel.value = allRequests(doc.items)[0]?.req.id
  })
  // kept by itself (a moment after the last change)
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const saveNow = () => void window.qa.httpSave(JSON.parse(JSON.stringify(doc)) as HttpDoc)
  watch(
    doc,
    () => {
      if (!loaded.value) return
      clearTimeout(saveTimer)
      saveTimer = setTimeout(saveNow, 400)
    },
    { deep: true },
  )
  onBeforeUnmount(() => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveNow()
    }
  })

  const selectedNode = computed(() => (sel.value ? findNode(doc.items, sel.value) : undefined))
  /** The selected request, if a request is selected. */
  const req = computed(() => (selectedNode.value?.type === 'request' ? selectedNode.value : undefined))
  /** The selected folder, if a folder is selected. */
  const folder = computed(() => (selectedNode.value?.type === 'folder' ? selectedNode.value : undefined))
  const rows = computed(() => treeRows(doc.items))
  const varMap = computed(() => varMapOf(doc.vars))
  /** The node whose name is being typed. */
  const renaming = ref<string>()

  /** A new node where the selection is, selected and named at once. */
  function addNode(n: HttpNode): void {
    targetListFor(doc.items, sel.value).push(n)
    sel.value = n.id
    renaming.value = n.id
  }
  const addRequest = () => addNode(newRequest())
  const addFolder = () => addNode(newFolder())
  function remove(n: HttpNode): void {
    const what = n.type === 'folder' ? `папку «${n.name}» со всем, что в ней` : `запрос «${n.name}»`
    if (!confirm(`Удалить ${what}?`)) return
    const p = parentListOf(doc.items, n.id)
    if (!p) return
    p.splice(p.indexOf(n), 1)
    if (sel.value === n.id) sel.value = allRequests(doc.items)[0]?.req.id
  }
  /** A copy right below the node (a folder — with everything in it). */
  function duplicate(n: HttpNode): void {
    const p = parentListOf(doc.items, n.id)
    if (!p) return
    const c = cloneWithNewIds(n)
    c.name = `${n.name} (копия)`
    p.splice(p.indexOf(n) + 1, 0, c)
    sel.value = c.id
  }
  /** «Вставить»: a request copied with «Весь запрос» becomes a new one here. */
  async function paste(): Promise<void> {
    const copied = parseCopiedRequest(await navigator.clipboard.readText().catch(() => ''))
    if (!copied) {
      alert('В буфере нет запроса — скопируйте его кнопкой «Копировать → Весь запрос»')
      return
    }
    const r = cloneWithNewIds({ ...newRequest(), ...copied })
    targetListFor(doc.items, sel.value).push(r)
    sel.value = r.id
  }
  /** A row clicked: selected (a folder also opens / closes); the way back to a chain forgotten. */
  function onRowClick(n: HttpNode): void {
    backTo.value = undefined
    if (n.type === 'folder') n.open = !n.open
    sel.value = n.id
  }
  /** A node dropped onto another one (or onto the empty space — undefined). */
  const dropNode = (id: string, target?: HttpNode) => void moveNode(doc.items, id, target)

  return { doc, loaded, sel, req, folder, rows, varMap, renaming, addRequest, addFolder, remove, duplicate, paste, onRowClick, dropNode }
}
export type HttpCollection = ReturnType<typeof useHttpCollection>

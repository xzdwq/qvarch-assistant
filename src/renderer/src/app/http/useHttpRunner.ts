import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { allRequests, DEFAULT_STOP_ON, type HttpDoc, type HttpRequest } from '@shared/http'
import { takeRunVars } from '@shared/httpCollection'
import { chainRun, lastStep, results, startChain } from '../../lib/httpRuns'
import type { HttpCollection } from './useHttpCollection'

export type ResponseTab = 'result' | 'body' | 'headers' | 'log'

/**
 * Running from the HTTP section: the selected request (one at a time from here — its id stops it), or the selected
 * folder's requests as a chain in the main process (it goes on while you look around). The variables a run sets
 * come back into the collection. Ctrl+Enter runs what is selected.
 */
export function useHttpRunner({ doc, req, folder }: HttpCollection) {
  /** One request at a time from here (its id — to stop it). */
  const single = ref<string>()
  const running = computed(() => !!single.value)
  const result = computed(() => (req.value ? results.get(req.value.id) : undefined))
  const rtab = ref<ResponseTab>('body')

  async function run(): Promise<void> {
    const r = req.value
    if (!r || single.value) return
    const runId = Math.random().toString(36).slice(2)
    single.value = runId
    try {
      const out = await window.qa.httpRun(JSON.parse(JSON.stringify(r)) as HttpRequest, JSON.parse(JSON.stringify(doc)) as HttpDoc, runId)
      results.set(r.id, out)
      takeRunVars(doc.vars, out.vars)
      rtab.value = out.error && !out.response ? 'log' : out.hasResult ? 'result' : 'body'
    } finally {
      single.value = undefined
    }
  }
  function abortSingle(): void {
    if (single.value) void window.qa.httpAbort(single.value)
  }
  // a chain's step (it runs in the main process) — its variables into this collection too
  watch(lastStep, (s) => s && takeRunVars(doc.vars, s.out.vars))

  // ---------- a folder: its requests as a chain, run in order ----------
  const folderReqs = computed(() => (folder.value ? allRequests(folder.value.children) : []))
  /** This folder's chain (the latest run of it). */
  const myChain = computed(() => (folder.value && chainRun.value?.folderId === folder.value.id ? chainRun.value : undefined))
  const chainBusy = computed(() => !!chainRun.value?.running)
  function runFolder(): void {
    const f = folder.value
    if (!f || chainBusy.value || !folderReqs.value.length) return
    void startChain(
      f.id,
      folderReqs.value.map((x) => x.req.id),
      doc,
      f.stopOn ?? DEFAULT_STOP_ON,
    )
  }
  /** A chain step's outcome (its last result), if it ran. */
  const stepState = (id: string) => {
    const r = results.get(id)
    if (!r) return undefined
    return { status: r.response?.status, time: r.response?.time, error: r.error }
  }

  function onKey(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      // a folder picked — its chain
      void (folder.value ? runFolder() : run())
    }
  }
  onMounted(() => window.addEventListener('keydown', onKey))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

  return { running, result, rtab, run, abortSingle, folderReqs, myChain, chainBusy, runFolder, stepState }
}
export type HttpRunner = ReturnType<typeof useHttpRunner>

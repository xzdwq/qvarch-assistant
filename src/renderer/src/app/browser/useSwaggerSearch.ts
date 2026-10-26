import { computed, ref, shallowRef, watch, type ComputedRef } from 'vue'
import type { BrowserTab } from '@shared/browser'
import { readSpec, serverOf, specToHttp, type ApiSpec } from '@shared/openapi'
import { load as yamlLoad } from 'js-yaml'
import { firstRequestOf, importToHttp } from '../../lib/httpImport'

const API_OPTS = 'qa.browser.apiOpts'
const originOf = (url?: string) => {
  try {
    return new URL(url ?? '').origin
  } catch {
    return ''
  }
}

/**
 * The site's Swagger / OpenAPI (found from the tab's page): its operations for «Карта API», the picked ones carried
 * into the HTTP section (filled in from the description, as asked).
 */
export function useSwaggerSearch(deps: { curId: ComputedRef<string | undefined>; byId: (id?: string) => BrowserTab | undefined; openHttp: (requestId: string) => void }) {
  const api = shallowRef<{ url: string; spec: unknown; info: ApiSpec; origin: string }>()
  const apiBusy = ref(false)
  const apiError = ref('')
  const apiTried = ref<string[]>([])
  const apiPicked = ref(new Set<string>())
  function clearApi(): void {
    api.value = undefined
    apiError.value = ''
    apiTried.value = []
    apiPicked.value = new Set()
  }
  async function findSwagger(): Promise<void> {
    const id = deps.curId.value
    if (!id) return
    apiBusy.value = true
    // a new search (this site or another) starts from an empty list
    clearApi()
    try {
      const r = await window.qa.browser('swaggerFind', id)
      if ('error' in r) {
        apiError.value = r.error
        apiTried.value = r.tried
        return
      }
      let spec: unknown
      try {
        spec = JSON.parse(r.text)
      } catch {
        spec = yamlLoad(r.text)
      }
      api.value = { url: r.url, spec, info: readSpec(spec), origin: originOf(deps.byId(id)?.url) }
      apiPicked.value = new Set()
    } catch (e) {
      apiError.value = e instanceof Error ? e.message : String(e)
    } finally {
      apiBusy.value = false
    }
  }
  /** The Swagger found, for «Карта API»: its operations, the server's base path, the site. */
  const mapSpec = computed(() => {
    const a = api.value
    if (!a) return undefined
    let base = ''
    let host = ''
    try {
      base = new URL(serverOf(a.spec as Record<string, unknown>, a.url)).pathname.replace(/\/+$/, '')
    } catch {
      // no server named — matched by the path's end
    }
    try {
      host = new URL(a.origin).host
    } catch {
      // none
    }
    return { title: a.info.title, ops: a.info.ops, base, host }
  })
  /** How the requests are filled in (remembered). */
  const apiOpts = ref<{ defaults: boolean; optional: boolean }>(
    (() => {
      try {
        return { defaults: true, optional: false, ...(JSON.parse(localStorage.getItem(API_OPTS) ?? '{}') as object) }
      } catch {
        return { defaults: true, optional: false }
      }
    })(),
  )
  watch(
    apiOpts,
    (v) => {
      try {
        localStorage.setItem(API_OPTS, JSON.stringify(v))
      } catch {
        // fine
      }
    },
    { deep: true },
  )
  /** The «Swagger → HTTP» dialog asked (the picked operations in `apiPicked`). */
  const apiAsk = ref(false)
  function askToHttp(ids: string[]): void {
    apiPicked.value = new Set(ids)
    apiAsk.value = true
  }
  async function apiToHttp(): Promise<void> {
    const a = api.value
    apiAsk.value = false
    if (!a) return
    try {
      const { folder, vars } = specToHttp(a.spec, a.url, a.info.ops.filter((o) => apiPicked.value.has(o.id)).map((o) => o.id), apiOpts.value)
      await importToHttp(folder, vars)
      deps.openHttp(firstRequestOf(folder))
    } catch (e) {
      apiError.value = e instanceof Error ? e.message : String(e)
    }
  }
  return { api, apiBusy, apiError, apiTried, apiPicked, findSwagger, mapSpec, clearApi, apiOpts, apiAsk, askToHttp, apiToHttp }
}

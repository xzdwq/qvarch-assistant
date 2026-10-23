import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue'
import { deviceFit, type BrowserTab } from '@shared/browser'
import { bLayout, tabs, useOverlay } from '../../lib/browser'

type Box = { x: number; y: number; w: number; h: number }
const DEV_H = 'qa.browser.devH'
const DEV_W = 'qa.browser.devW'
const DEV_SIDE = 'qa.browser.devSide'

/**
 * Where the pages go: each pane's page box (and its docked tools, its device frame) reported to the main process,
 * which puts the native pages there; while something of the app is over them they make way — their pictures shown.
 */
export function usePageLayout(deps: {
  active: () => boolean
  byId: (id?: string) => BrowserTab | undefined
  pageShown: (id?: string) => boolean
  /** The address suggestions open (over the pages). */
  suggestFor: Readonly<Ref<string | undefined>>
  /** A tab dragged (its ghost over the pages). */
  tabDrag: Readonly<Ref<unknown>>
  recOpen: Ref<boolean>
  recW: Ref<number>
}) {
  const { byId, pageShown } = deps
  const pageEls = new Map<string, HTMLElement>()
  /** The docked developer tools: their box under the page (its height dragged, remembered). */
  const devEls = new Map<string, HTMLElement>()
  /** Each pane's device area (under its device bar) and where the device's page sits in it. */
  const areaEls = new Map<string, HTMLElement>()
  const devFits = shallowRef<Record<string, Box & { scale: number }>>({})
  // (the page put under its picture only when a popover is over it — a menu in the side panel needs nothing)
  const overlay = useOverlay(() => [...pageEls.values(), ...devEls.values()])
  const covering = computed(() => overlay.value || !!deps.suggestFor.value || !!deps.tabDrag.value)
  /** The pages' pictures (JPEG, base64) by tab id (`id:dev` — its tools') while they make way. */
  const shots = ref<Record<string, string>>({})
  let coverSeq = 0
  watch(covering, async (on) => {
    const my = ++coverSeq
    const s = await window.qa.browser('cover', on)
    if (my !== coverSeq) return
    if (on) shots.value = s
    else requestAnimationFrame(() => (shots.value = {}))
  })
  let lastSent = ''
  function sendLayout(): void {
    const rects: Array<Box & { id: string; dev?: Box; scale?: number }> = []
    const fits: Record<string, Box & { scale: number }> = {}
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height }
    }
    if (deps.active()) {
      for (const p of bLayout.panes) {
        const el = pageEls.get(p.id)
        if (!el || !p.active || !pageShown(p.active)) continue
        const dv = devEls.get(p.id)
        const dev = dv && byId(p.active)?.devtools ? { dev: box(dv) } : {}
        const device = byId(p.active)?.device
        const area = areaEls.get(p.id)
        if (device && area) {
          // the device mode: the page as big as the device, made smaller to fit
          const a = box(area)
          const fit = deviceFit(device, a)
          // The page (a native view) goes by screen px; the frame drawn under it is inside the app's CSS zoom,
          // which would scale its px once more (at 90% the frame came out smaller and shifted) — undo it.
          const z = (area as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom || 1
          fits[p.id] = { x: (fit.x - a.x) / z, y: (fit.y - a.y) / z, w: fit.w / z, h: fit.h / z, scale: fit.scale }
          rects.push({ id: p.active, x: fit.x, y: fit.y, w: fit.w, h: fit.h, scale: fit.scale, ...dev })
        } else rects.push({ id: p.active, ...box(el), ...dev })
      }
    }
    const fk = JSON.stringify(fits)
    if (fk !== JSON.stringify(devFits.value)) devFits.value = fits
    const key = JSON.stringify(rects.map((r) => [r.id, Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h), r.scale, r.dev && [Math.round(r.dev.x), Math.round(r.dev.y), Math.round(r.dev.w), Math.round(r.dev.h)]]))
    if (key === lastSent) return
    lastSent = key
    window.qa.browserLayout(rects)
  }
  let ro: ResizeObserver | undefined
  let tick: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    ro = new ResizeObserver(() => requestAnimationFrame(sendLayout))
    window.addEventListener('resize', sendLayout)
    // the app's zoom / a panel moving do not always resize the page box itself
    tick = setInterval(sendLayout, 300)
  })
  onBeforeUnmount(() => {
    ro?.disconnect()
    clearInterval(tick)
    window.removeEventListener('resize', sendLayout)
    window.qa.browserLayout([])
  })
  watch(
    () => [deps.active(), bLayout.panes.map((p) => `${p.id}:${p.active}`).join(), tabs.value.map((t) => `${t.id}${t.url}${t.error ? 'e' : ''}${t.devtools ? 'd' : ''}${t.device ? `${t.device.w}x${t.device.h}` : ''}`).join(), deps.recOpen.value, deps.recW.value, bLayout.split],
    () => nextTick(sendLayout),
  )
  function devRef(pid: string, el: unknown): void {
    if (el instanceof HTMLElement) devEls.set(pid, el)
    else devEls.delete(pid)
    void nextTick(sendLayout)
  }
  const devH = ref(Math.min(900, Math.max(120, Number(localStorage.getItem(DEV_H)) || 320)))
  const devW = ref(Math.min(1200, Math.max(240, Number(localStorage.getItem(DEV_W)) || 480)))
  /** Where the developer tools sit: under the page or at its right (remembered). */
  const devSide = ref<'bottom' | 'right'>(localStorage.getItem(DEV_SIDE) === 'right' ? 'right' : 'bottom')
  watch(devSide, (v) => {
    try {
      localStorage.setItem(DEV_SIDE, v)
    } catch {
      // fine
    }
    void nextTick(sendLayout)
  })
  function dragDev(e: PointerEvent): void {
    e.preventDefault()
    const x0 = e.clientX
    const y0 = e.clientY
    const h0 = devH.value
    const w0 = devW.value
    const right = devSide.value === 'right'
    const move = (ev: PointerEvent) => {
      if (right) devW.value = Math.min(window.innerWidth - 300, Math.max(240, w0 - (ev.clientX - x0)))
      else devH.value = Math.min(window.innerHeight - 220, Math.max(120, h0 - (ev.clientY - y0)))
      sendLayout()
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      try {
        localStorage.setItem(DEV_H, String(devH.value))
        localStorage.setItem(DEV_W, String(devW.value))
      } catch {
        // fine
      }
    }
    document.body.style.cursor = right ? 'col-resize' : 'row-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  /** A box watched for its size (the page's, the device area's): a new one replaces the old. */
  function observed(map: Map<string, HTMLElement>, pid: string, el: unknown): boolean {
    const prev = map.get(pid)
    if (el === prev) return false
    if (prev) ro?.unobserve(prev)
    if (el instanceof HTMLElement) {
      map.set(pid, el)
      ro?.observe(el)
    } else map.delete(pid)
    return true
  }
  function areaRef(pid: string, el: unknown): void {
    if (observed(areaEls, pid, el)) void nextTick(sendLayout)
  }
  function pageRef(pid: string, el: unknown): void {
    observed(pageEls, pid, el)
  }
  return { devFits, shots, devH, devW, devSide, dragDev, devRef, areaRef, pageRef }
}

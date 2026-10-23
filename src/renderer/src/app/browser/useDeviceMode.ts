import { DEVICES, RESPONSIVE, UA_MOBILE, type BrowserTab, type DeviceMode } from '@shared/browser'

const DEV_KEY = 'qa.browser.device'
const DPRS = [1, 1.25, 1.5, 2, 2.625, 3, 3.5, 4]
/** The presets in the device menu, by kind. */
const DEVICE_GROUPS = [
  { label: 'Телефоны', list: DEVICES.filter((d) => d.mobile && d.w < 600) },
  { label: 'Планшеты', list: DEVICES.filter((d) => d.mobile && d.w >= 600) },
  { label: 'Компьютеры', list: DEVICES.filter((d) => !d.mobile) },
]
/** The densities to pick from (the device's own among them). */
const dprList = (d: DeviceMode) => (DPRS.includes(d.dpr) ? DPRS : [...DPRS, d.dpr].sort((a, b) => a - b))
/** The device mode switched on last (its sizes kept), else «Адаптивный». */
function lastDevice(): DeviceMode {
  try {
    const d = JSON.parse(localStorage.getItem(DEV_KEY) ?? 'null') as DeviceMode | null
    if (d && d.w > 0 && d.h > 0) return d
  } catch {
    // none
  }
  return { ...RESPONSIVE }
}
const below = (e: MouseEvent) => (e.currentTarget as HTMLElement).getBoundingClientRect()

/** The device mode of a tab: on / off, a preset or sizes of one's own, its density, touch, turned. */
export function useDeviceMode(deps: { byId: (id?: string) => BrowserTab | undefined; pageShown: (id?: string) => boolean }) {
  const { byId } = deps
  function setDevice(id: string | undefined, d?: DeviceMode): void {
    if (!id) return
    if (d) {
      try {
        localStorage.setItem(DEV_KEY, JSON.stringify(d))
      } catch {
        // fine
      }
    }
    void window.qa.browser('device', id, d ? { ...d } : undefined)
  }
  function toggleDevice(id: string | undefined): void {
    const t = byId(id)
    if (!t || !deps.pageShown(id)) return
    setDevice(id, t.device ? undefined : lastDevice())
  }
  /** A preset picked (its name), or «Адаптивный» — the sizes stay. */
  function pickDevice(id: string | undefined, name: string): void {
    const cur = byId(id)?.device
    if (!cur) return
    const p = DEVICES.find((x) => x.name === name)
    setDevice(id, p ? { ...p } : { ...RESPONSIVE, w: cur.w, h: cur.h })
  }
  /** The sizes typed: a device of one's own (as Chrome's «Адаптивный»). */
  function sizeDevice(id: string | undefined, w: number, h: number): void {
    const cur = byId(id)?.device
    if (!cur || !(w >= 50 && h >= 50)) return
    setDevice(id, { ...cur, name: '', w: Math.min(4000, Math.round(w)), h: Math.min(4000, Math.round(h)) })
  }
  function patchDevice(id: string | undefined, patch: Partial<DeviceMode>): void {
    const cur = byId(id)?.device
    if (!cur) return
    const next = { ...cur, ...patch }
    // a preset changed by hand is one's own
    if (patch.mobile !== undefined || patch.dpr !== undefined) next.name = ''
    if (patch.mobile !== undefined) next.ua = patch.mobile ? cur.ua || UA_MOBILE : undefined
    setDevice(id, next)
  }
  const rotateDevice = (id: string | undefined) => {
    const cur = byId(id)?.device
    if (cur) setDevice(id, { ...cur, w: cur.h, h: cur.w })
  }
  async function deviceMenu(id: string | undefined, e: MouseEvent): Promise<void> {
    const cur = byId(id)?.device
    if (!cur) return
    const r = below(e)
    const items = [
      { id: '', label: 'Адаптивный — свои размеры', checked: !cur.name },
      ...DEVICE_GROUPS.flatMap((g) => [{ id: '-', label: '' }, { id: `#${g.label}`, label: g.label }, ...g.list.map((d) => ({ id: d.name, label: `${d.name}    ${d.w} × ${d.h}`, checked: cur.name === d.name }))]),
    ]
    const pick = await window.qa.browser('choose', items, r.left, r.bottom + 2)
    if (pick !== undefined) pickDevice(id, pick)
  }
  async function dprMenu(id: string | undefined, e: MouseEvent): Promise<void> {
    const cur = byId(id)?.device
    if (!cur) return
    const r = below(e)
    const pick = await window.qa.browser('choose', [{ id: '#', label: 'Плотность пикселей (DPR)' }, ...dprList(cur).map((v) => ({ id: String(v), label: String(v), checked: v === cur.dpr }))], r.left, r.bottom + 2)
    if (pick) patchDevice(id, { dpr: Number(pick) })
  }
  return { setDevice, toggleDevice, sizeDevice, patchDevice, rotateDevice, deviceMenu, dprMenu }
}

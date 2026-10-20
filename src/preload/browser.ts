/// <reference lib="dom" />
import { ipcRenderer } from 'electron'
// recording a Playwright scenario (off until the app starts it for this tab)
import './pwRecorder'

/**
 * The browser's pages: sign-in forms only. A login sent (a form submitted, Enter in it, its button clicked) goes
 * to the app — it offers to keep it; a page with a password field gets its site's saved login typed in. The page
 * itself cannot reach this (isolated), and the app answers only for the page's own address.
 */
const visible = (el: HTMLElement) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
const passwords = (root: ParentNode = document) => [...root.querySelectorAll<HTMLInputElement>('input[type="password"]')].filter(visible)
/** The login field of a password: the nearest text / e-mail field before it (in its form, else on the page). */
function loginFor(pw: HTMLInputElement): HTMLInputElement | undefined {
  const scope: ParentNode = pw.form ?? document
  let best: HTMLInputElement | undefined
  for (const i of scope.querySelectorAll<HTMLInputElement>('input')) {
    if (i === pw) break
    if (/^(text|email|tel|)$/i.test(i.type) && visible(i)) best = i
  }
  return best
}
function send(pw: HTMLInputElement | undefined): void {
  if (!pw?.value) return
  ipcRenderer.send('qa:bpw-submit', { username: loginFor(pw)?.value ?? '', password: pw.value })
}
const filledPw = () => passwords().find((p) => p.value)
document.addEventListener('submit', (e) => send(passwords(e.target as HTMLFormElement).find((p) => p.value)), true)
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Enter') return
    const t = e.target as HTMLInputElement
    if (t.tagName === 'INPUT' && (t.type === 'password' || (filledPw() && /^(text|email|tel)$/i.test(t.type)))) send(filledPw())
  },
  true,
)
document.addEventListener(
  'click',
  (e) => {
    const b = (e.target as HTMLElement).closest?.('button, input[type="submit"], [role="button"], a')
    if (b) send(filledPw())
  },
  true,
)

/** A value typed as a person would: the page's own handlers (React, Vue) see it. */
function put(el: HTMLInputElement, v: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  set?.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}
function fill(c: { username: string; password: string }, force = false): void {
  const pw = passwords()[0]
  if (!pw) return
  if (force || !pw.value) put(pw, c.password)
  const login = loginFor(pw)
  if (login && c.username && (force || !login.value)) put(login, c.username)
}
// the site's saved login into its form — once per page, when a password field shows up (also later, in an app)
let asked = false
let timer: ReturnType<typeof setTimeout> | undefined
function look(): void {
  timer = undefined
  if (asked || !passwords().length) return
  asked = true
  void ipcRenderer.invoke('qa:bpw-get').then((c: { username: string; password: string } | null) => c && fill(c))
}
const schedule = () => (timer ??= setTimeout(look, 400))
window.addEventListener('DOMContentLoaded', () => {
  schedule()
  const mo = new MutationObserver(schedule)
  mo.observe(document.documentElement, { childList: true, subtree: true })
  // a single-page app keeps changing — looking stops after a while
  setTimeout(() => mo.disconnect(), 60_000)
})
// «Подставить» from the app's passwords list
ipcRenderer.on('qa:bpw-fill', (_e, c: { username: string; password: string }) => fill(c, true))

// ---------- rulers (like «Liner»): along the top and the left; guides pulled out of them, dropped back — gone ----------
type Ruler = { on: boolean; v: number[]; h: number[] }
const R = 18
let host: HTMLDivElement | undefined
let state: Ruler = { on: false, v: [], h: [] }
const save = () => ipcRenderer.send('qa:ruler-set', state)
/** The listeners of the rulers drawn now (dropped with them). */
let ac: AbortController | undefined
function drawRuler(): void {
  ac?.abort()
  ac = new AbortController()
  const signal = ac.signal
  host?.remove()
  host = undefined
  if (!state.on || !document.documentElement) return
  host = document.createElement('div')
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none'
  const root = host.attachShadow({ mode: 'closed' })
  root.innerHTML = `<style>
    .bar{position:fixed;background:rgba(22,27,34,.92);pointer-events:auto;color:#adb7c6;font:10px/1 Consolas,monospace;user-select:none}
    .top{left:0;right:0;top:0;height:${R}px;cursor:s-resize;border-bottom:1px solid #30363d}
    .left{top:0;bottom:0;left:0;width:${R}px;cursor:e-resize;border-right:1px solid #30363d}
    canvas{position:absolute;inset:0}
    .corner{position:fixed;left:0;top:0;width:${R}px;height:${R}px;background:#161b22;pointer-events:auto;cursor:pointer;color:#ff6b00;font:bold 12px/18px sans-serif;text-align:center;z-index:2;border:0;border-right:1px solid #30363d;border-bottom:1px solid #30363d}
    .g{position:fixed;pointer-events:auto}
    .g.v{top:0;bottom:0;width:7px;margin-left:-3px;cursor:ew-resize}
    .g.h{left:0;right:0;height:7px;margin-top:-3px;cursor:ns-resize}
    .g i{position:absolute;background:#18e0ff}
    .g.v i{left:3px;top:0;bottom:0;width:1px}
    .g.h i{top:3px;left:0;right:0;height:1px;background:#ff4fd8}
    .g b{position:absolute;padding:1px 4px;border-radius:2px;background:#18e0ff;color:#0d1117;font:10px/1.4 Consolas,monospace;white-space:nowrap}
    .g.v b{top:${R + 4}px;left:6px}
    .g.h b{left:${R + 4}px;top:6px;background:#ff4fd8}
    .m{position:fixed;background:#ff6b00;pointer-events:none}
  </style>
  <div class="bar top"><canvas></canvas></div><div class="bar left"><canvas></canvas></div>
  <button class="corner" title="Убрать линейки">×</button><i class="m mx" style="top:0;height:${R}px;width:1px"></i><i class="m my" style="left:0;width:${R}px;height:1px"></i>`
  document.documentElement.appendChild(host)
  const [top, left] = [...root.querySelectorAll<HTMLDivElement>('.bar')]
  const ticks = () => {
    for (const [bar, horiz] of [[top, true], [left, false]] as const) {
      const c = bar.querySelector('canvas')!
      const len = horiz ? innerWidth : innerHeight
      const dpr = devicePixelRatio
      c.width = (horiz ? len : R) * dpr
      c.height = (horiz ? R : len) * dpr
      c.style.width = `${horiz ? len : R}px`
      c.style.height = `${horiz ? R : len}px`
      const g = c.getContext('2d')!
      g.scale(dpr, dpr)
      g.strokeStyle = '#566173'
      g.fillStyle = '#adb7c6'
      g.font = '9px Consolas, monospace'
      g.beginPath()
      for (let p = 0; p <= len; p += 5) {
        const size = p % 100 === 0 ? R : p % 50 === 0 ? 9 : p % 10 === 0 ? 6 : 3
        if (horiz) (g.moveTo(p + 0.5, R), g.lineTo(p + 0.5, R - size))
        else (g.moveTo(R, p + 0.5), g.lineTo(R - size, p + 0.5))
        if (p % 100 === 0 && p) {
          if (horiz) g.fillText(String(p), p + 3, 9)
          else {
            g.save()
            g.translate(9, p - 3)
            g.rotate(-Math.PI / 2)
            g.fillText(String(p), 0, 0)
            g.restore()
          }
        }
      }
      g.stroke()
    }
  }
  ticks()
  addEventListener('resize', ticks, { signal })
  const mx = root.querySelector<HTMLElement>('.mx')!
  const my = root.querySelector<HTMLElement>('.my')!
  addEventListener('mousemove', (e) => ((mx.style.left = `${e.clientX}px`), (my.style.top = `${e.clientY}px`)), { passive: true, signal })
  root.querySelector('.corner')!.addEventListener('click', () => {
    state.on = false
    save()
    drawRuler()
  })
  const guide = (kind: 'v' | 'h', pos: number) => {
    const el = document.createElement('div')
    el.className = `g ${kind}`
    el.innerHTML = '<i></i><b></b>'
    const place = (p: number) => {
      el.style[kind === 'v' ? 'left' : 'top'] = `${p}px`
      el.querySelector('b')!.textContent = `${Math.round(p)}px`
    }
    place(pos)
    root.appendChild(el)
    return { el, place }
  }
  /** A guide follows the pointer; let go over its ruler — it goes. */
  const drag = (kind: 'v' | 'h', g: { el: HTMLElement; place: (p: number) => void }, startIdx: number, e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    let idx = startIdx
    const at = (ev: PointerEvent) => (kind === 'v' ? ev.clientX : ev.clientY)
    const move = (ev: PointerEvent) => {
      const p = Math.max(0, at(ev))
      g.place(p)
      state[kind][idx] = p
    }
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move, true)
      removeEventListener('pointerup', up, true)
      if (at(ev) < R) {
        state[kind].splice(idx, 1)
        g.el.remove()
        idx = -1
      }
      save()
      drawRuler()
    }
    addEventListener('pointermove', move, true)
    addEventListener('pointerup', up, true)
    move(e)
  }
  state.v.forEach((p, i) => {
    const g = guide('v', p)
    g.el.addEventListener('pointerdown', (e) => drag('v', g, i, e))
  })
  state.h.forEach((p, i) => {
    const g = guide('h', p)
    g.el.addEventListener('pointerdown', (e) => drag('h', g, i, e))
  })
  // pulled out of the top ruler — a horizontal line; out of the left one — a vertical line
  top.addEventListener('pointerdown', (e) => {
    state.h.push(e.clientY)
    drag('h', guide('h', e.clientY), state.h.length - 1, e)
  })
  left.addEventListener('pointerdown', (e) => {
    state.v.push(e.clientX)
    drag('v', guide('v', e.clientX), state.v.length - 1, e)
  })
}
ipcRenderer.on('qa:ruler', (_e, r: Ruler) => {
  state = r
  drawRuler()
})
window.addEventListener('DOMContentLoaded', () => {
  void ipcRenderer.invoke('qa:ruler-get').then((r: Ruler | null) => {
    if (r?.on) {
      state = r
      drawRuler()
    }
  })
})

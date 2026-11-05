/// <reference lib="dom" />
import type { PageRuler } from '../../shared/browser/pageChannels'
import { RULER_MARK as C } from '../../shared/browser/pageMarks'
import { askMain, onMain, sendMain } from '../pageIpc'

/**
 * Rulers over a browser page (like «Liner»): along the top and the left; guides pulled out of them, dropped back —
 * gone. Kept by main across the tab's navigations (a new page asks for them).
 */

/** The bars' thickness, px. */
const R = 18
let host: HTMLDivElement | undefined
let state: PageRuler = { on: false, v: [], h: [] }
const save = () => sendMain('rulerSet', state)
/** The listeners of the rulers drawn now (dropped with them). */
let ac: AbortController | undefined

/** The bars' styles (the site's page has none of the app's CSS: the colours are shared/browser/pageMarks.ts). */
const STYLE = `
  .bar{position:fixed;background:${C.bar};pointer-events:auto;color:${C.text};font:10px/1 Consolas,monospace;user-select:none}
  .top{left:0;right:0;top:0;height:${R}px;cursor:s-resize;border-bottom:1px solid ${C.line}}
  .left{top:0;bottom:0;left:0;width:${R}px;cursor:e-resize;border-right:1px solid ${C.line}}
  canvas{position:absolute;inset:0}
  .corner{position:fixed;left:0;top:0;width:${R}px;height:${R}px;background:${C.corner};pointer-events:auto;cursor:pointer;color:${C.mark};font:bold 12px/18px sans-serif;text-align:center;z-index:2;border:0;border-right:1px solid ${C.line};border-bottom:1px solid ${C.line}}
  .g{position:fixed;pointer-events:auto}
  .g.v{top:0;bottom:0;width:7px;margin-left:-3px;cursor:ew-resize}
  .g.h{left:0;right:0;height:7px;margin-top:-3px;cursor:ns-resize}
  .g i{position:absolute;background:${C.guideV}}
  .g.v i{left:3px;top:0;bottom:0;width:1px}
  .g.h i{top:3px;left:0;right:0;height:1px;background:${C.guideH}}
  .g b{position:absolute;padding:1px 4px;border-radius:2px;background:${C.guideV};color:${C.onGuide};font:10px/1.4 Consolas,monospace;white-space:nowrap}
  .g.v b{top:${R + 4}px;left:6px}
  .g.h b{left:${R + 4}px;top:6px;background:${C.guideH}}
  .m{position:fixed;background:${C.mark};pointer-events:none}
`

/** The ticks and numbers of both bars (drawn again on a resize). */
function drawTicks(top: HTMLElement, left: HTMLElement): void {
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
    g.strokeStyle = C.tick
    g.fillStyle = C.text
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
  root.innerHTML = `<style>${STYLE}</style>
  <div class="bar top"><canvas></canvas></div><div class="bar left"><canvas></canvas></div>
  <button class="corner" title="Убрать линейки">×</button><i class="m mx" style="top:0;height:${R}px;width:1px"></i><i class="m my" style="left:0;width:${R}px;height:1px"></i>`
  document.documentElement.appendChild(host)
  const [top, left] = [...root.querySelectorAll<HTMLDivElement>('.bar')]
  const ticks = () => drawTicks(top, left)
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

onMain('ruler', (r) => {
  state = r
  drawRuler()
})
window.addEventListener('DOMContentLoaded', () => {
  void askMain('rulerGet').then((r) => {
    if (r?.on) {
      state = r
      drawRuler()
    }
  })
})

/**
 * Where a dropdown opens: it floats over everything (teleported to <body>, fixed to the window), towards the
 * side with more room — no panel, scroll box or card clips it. In the island it goes out of the island's shell
 * as a layer (the island keeps its size; the island counts the layers of <body> as its own for clicks).
 */
export interface Float {
  teleport: boolean
  up: boolean
  maxH: number
  style: Record<string, string>
}

import { onBeforeUnmount, watch, type Ref } from 'vue'

/**
 * While a dropdown is open it stays glued to its button: the island may still be growing or moving when it
 * opens — every frame the button's place is checked and the list re-placed if it changed.
 */
export function useAnchor(open: Ref<boolean>, root: Ref<HTMLElement | undefined>, measure: () => void): void {
  let raf = 0
  let last = ''
  const tick = () => {
    const r = root.value?.getBoundingClientRect()
    const key = r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)},${window.innerWidth},${window.innerHeight}` : ''
    if (key && key !== last) {
      last = key
      measure()
    }
    raf = requestAnimationFrame(tick)
  }
  watch(open, (on) => {
    cancelAnimationFrame(raf)
    last = ''
    if (on) raf = requestAnimationFrame(tick)
  })
  onBeforeUnmount(() => cancelAnimationFrame(raf))
}

export function placeFloat(root: HTMLElement, width: number, alignLeft = false, chrome = 48): Float {
  const btn = root.getBoundingClientRect()
  const above = btn.top - 8
  const below = window.innerHeight - btn.bottom - 8
  const up = above > below
  const w = Math.min(width, window.innerWidth - 16)
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, alignLeft ? btn.left : btn.right - w))
  return {
    teleport: true,
    up,
    maxH: Math.max(120, Math.min(420, (up ? above : below) - chrome)),
    style: {
      position: 'fixed',
      left: `${left}px`,
      right: 'auto',
      width: `${w}px`,
      ...(up ? { bottom: `${window.innerHeight - btn.top + 4}px`, top: 'auto' } : { top: `${btn.bottom + 4}px`, bottom: 'auto' }),
      zIndex: '1000',
    },
  }
}

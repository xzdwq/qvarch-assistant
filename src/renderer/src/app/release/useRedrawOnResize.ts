import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from 'vue'

/** Redraws (once per frame) whenever the element is resized — and once after mounting; follows the element when it is swapped. */
export function useRedrawOnResize(el: Ref<HTMLElement | undefined>, draw: () => void): void {
  let ro: ResizeObserver | undefined
  let raf = 0
  const redraw = () => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(draw)
  }
  onMounted(() => {
    ro = new ResizeObserver(redraw)
    if (el.value) ro.observe(el.value)
    void nextTick(redraw)
  })
  watch(el, (now, before) => {
    if (before) ro?.unobserve(before)
    if (now) ro?.observe(now)
  })
  onBeforeUnmount(() => ro?.disconnect())
}

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Entry, Link, LinkEnd } from '@shared/types'
import { closestPair, cornerAnchors, linkPath, pinAnchors, sideAnchors, type Anchor, type LinkStyle } from '@shared/linkpath'
import { kindColor } from '../lib/palette'
import Icon from './Icon.vue'

/**
 * Links drawn over a timeline: a line between the closest corners of two blocks (or a block and a note
 * pin) in the style chosen in settings; its gradient goes from one block's colour to the other's. Point at a corner of a block — a dot appears right on that corner; drag it
 * onto another block / note to link. Hover a line → × to unlink. Lives inside the timeline's lanes container (positioned); finds blocks by
 * [data-entry] / [data-note].
 */
/** under — drawn beneath the blocks (a dense grid: a line never crosses another block's text). */
/** sides — lines attach to the blocks' left / right edges and run in the gaps (vertical events: the calendar). */
const props = defineProps<{ links: Link[]; entries: Entry[]; tick?: unknown; linkStyle?: LinkStyle; under?: boolean; sides?: boolean }>()
const emit = defineEmits<{ link: [a: LinkEnd, b: LinkEnd]; unlink: [id: string] }>()

const el = ref<SVGSVGElement>()
const host = () => el.value?.parentElement ?? undefined
type P = { x: number; y: number }
/** Candidate anchors of every linked thing, relative to the host. */
const anchors = ref(new Map<string, Anchor[]>())
const key = (e: LinkEnd) => `${e.type}:${e.id}`
const NOTE_COLOR = '#fbbf24'
const colorOf = (e: LinkEnd) => (e.type === 'note' ? NOTE_COLOR : kindColor(props.entries.find((x) => x.id === e.id)?.kind ?? ''))

function elementOf(e: LinkEnd): HTMLElement | null {
  return host()?.querySelector<HTMLElement>(e.type === 'entry' ? `[data-entry="${CSS.escape(e.id)}"]` : `[data-note="${CSS.escape(e.id)}"]`) ?? null
}
/** A block offers its four corner dots, a note pin its top and bottom. Clamped into a scrolled lane. */
function anchorsOf(e: LinkEnd, h: DOMRect): Anchor[] | undefined {
  const node = elementOf(e)
  if (!node) return undefined
  const r = node.getBoundingClientRect()
  if (!r.width) return undefined
  const list = e.type === 'entry' ? (props.sides ? sideAnchors(r) : cornerAnchors(r)) : pinAnchors(r)
  const clip = node.parentElement?.closest<HTMLElement>('.mainl, .row-scroll')?.getBoundingClientRect()
  return list.map((p) => ({
    x: (clip ? Math.max(clip.left, Math.min(clip.right, p.x)) : p.x) - h.left,
    y: (clip ? Math.max(clip.top, Math.min(clip.bottom, p.y)) : p.y) - h.top,
    dir: p.dir,
  }))
}

/** Reads where the blocks are right now (the DOM is already updated) — the lines move in the same frame. */
function measureNow(): void {
  const h = host()?.getBoundingClientRect()
  if (!h || (!props.links.length && !drag.value)) {
    if (anchors.value.size) anchors.value = new Map()
    return
  }
  const m = new Map<string, Anchor[]>()
  const ends = props.links.flatMap((l) => [l.a, l.b])
  if (drag.value) ends.push(drag.value.from)
  for (const e of ends) {
    const p = anchorsOf(e, h)
    if (p) m.set(key(e), p)
  }
  anchors.value = m
}
/** At most one measure per frame — never postponed by the next change (a running wheel / zoom kept the old lines). */
let raf = 0
function measure(): void {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    measureNow()
  })
}
/** While something animates (the island unfolding, lanes growing) the lines follow it every frame. */
let followUntil = 0
let followRaf = 0
function follow(ms: number): void {
  followUntil = Math.max(followUntil, performance.now() + ms)
  if (followRaf) return
  const tick = () => {
    measureNow()
    followRaf = performance.now() < followUntil ? requestAnimationFrame(tick) : 0
  }
  followRaf = requestAnimationFrame(tick)
}
const onTransition = () => follow(700)

const style = computed<LinkStyle>(() => props.linkStyle ?? 'curve')
const shown = computed(() =>
  props.links.flatMap((l) => {
    const pair = closestPair(anchors.value.get(key(l.a)) ?? [], anchors.value.get(key(l.b)) ?? [])
    if (!pair) return []
    const [a, b] = pair
    return [{ id: l.id, a, b, ca: colorOf(l.a), cb: colorOf(l.b), ...linkPath(a, b, style.value) }]
  }),
)
const hovered = ref<string>()
let leaveTimer: ReturnType<typeof setTimeout> | undefined
function enter(id: string): void {
  clearTimeout(leaveTimer)
  hovered.value = id
}
function leave(): void {
  clearTimeout(leaveTimer)
  leaveTimer = setTimeout(() => (hovered.value = undefined), 250)
}

// ---------- the corner dot: shown only at the corner under the pointer, sitting on the block's edge ----------
const HOT = 13 // px around a corner
const corner = ref<{ end: LinkEnd; x: number; y: number }>()
function onHostMove(e: PointerEvent): void {
  if (drag.value) return
  const t = e.target as HTMLElement | null
  if (t?.closest('.lk-corner')) return
  const h = host()
  const node = t?.closest<HTMLElement>('[data-entry]')
  if (!h || !node || !h.contains(node)) {
    corner.value = undefined
    return
  }
  const r = node.getBoundingClientRect()
  const hr = h.getBoundingClientRect()
  let best: { x: number; y: number; d: number } | undefined
  for (const [cx, cy, ox, oy] of [
    [r.left, r.top, -1, -1],
    [r.right, r.top, 1, -1],
    [r.left, r.bottom, -1, 1],
    [r.right, r.bottom, 1, 1],
  ]) {
    const d = Math.hypot(e.clientX - cx, e.clientY - cy)
    // the dot sits on the corner, a little outside the block
    if (d < HOT && (!best || d < best.d)) best = { x: cx + ox * 1.5 - hr.left, y: cy + oy * 1.5 - hr.top, d }
  }
  corner.value = best ? { end: { type: 'entry', id: node.dataset.entry! }, x: best.x, y: best.y } : undefined
}
const onHostLeave = () => (corner.value = undefined)

// ---------- drag a new link ----------
const drag = ref<{ from: LinkEnd; to: P; start: P; moved: boolean; x0: number; y0: number }>()
let target: HTMLElement | null = null
function setTarget(t: HTMLElement | null): void {
  if (t === target) return
  target?.classList.remove('link-target')
  target = t
  target?.classList.add('link-target')
}
function endUnder(x: number, y: number): { end: LinkEnd; node: HTMLElement } | undefined {
  const node = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-entry], [data-note]')
  if (!node) return undefined
  return node.dataset.entry ? { end: { type: 'entry', id: node.dataset.entry }, node } : { end: { type: 'note', id: node.dataset.note! }, node }
}
function startDrag(e: PointerEvent, from: LinkEnd): void {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  const h = host()?.getBoundingClientRect()
  if (!h) return
  const p = { x: e.clientX - h.left, y: e.clientY - h.top }
  drag.value = { from, to: p, start: p, moved: false, x0: e.clientX, y0: e.clientY }
  host()?.classList.add('linking')
  corner.value = undefined
  measure()
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragUp, { once: true })
  window.addEventListener('keydown', onDragKey)
}
function onDragMove(e: PointerEvent): void {
  const d = drag.value
  const h = host()?.getBoundingClientRect()
  if (!d || !h) return
  d.moved ||= Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > 4
  d.to = { x: e.clientX - h.left, y: e.clientY - h.top }
  const u = endUnder(e.clientX, e.clientY)
  setTarget(u && !(u.end.type === d.from.type && u.end.id === d.from.id) ? u.node : null)
}
function finishDrag(): void {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('keydown', onDragKey)
  setTarget(null)
  host()?.classList.remove('linking')
  drag.value = undefined
}
function onDragUp(e: PointerEvent): void {
  const d = drag.value
  const u = d?.moved ? endUnder(e.clientX, e.clientY) : undefined
  finishDrag()
  if (d && u && !(u.end.type === d.from.type && u.end.id === d.from.id)) emit('link', { type: d.from.type, id: d.from.id }, u.end) // plain copies: IPC cannot clone reactive proxies
}
function onDragKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  window.removeEventListener('pointerup', onDragUp)
  finishDrag()
}
/** While dragging: from the corner the drag started at, to the pointer. */
const dragPath = computed(() => {
  const d = drag.value
  const list = d && anchors.value.get(key(d.from))
  if (!d?.moved || !list?.length) return undefined
  const a = closestPair(list, [{ ...d.start, dir: -1 }])![0]
  const b: Anchor = { ...d.to, dir: d.to.y < a.y ? 1 : -1 }
  return { ...linkPath(a, b, style.value), color: colorOf(d.from) }
})

defineExpose({ startDrag, measure })

// after the render that moved the blocks (wheel, zoom, drag) — measured at once, not a frame later
watch(() => [props.links, props.entries, props.tick, props.linkStyle], () => measureNow(), { flush: 'post' })
let ro: ResizeObserver | undefined
const onScroll = () => measure()
onMounted(() => {
  const h = host()
  if (h) {
    ro = new ResizeObserver(measure)
    ro.observe(h)
    h.addEventListener('scroll', onScroll, true)
    h.addEventListener('pointermove', onHostMove)
    h.addEventListener('pointerleave', onHostLeave)
  }
  window.addEventListener('resize', onScroll)
  document.addEventListener('transitionrun', onTransition, true)
  document.addEventListener('animationstart', onTransition, true)
  void nextTick(() => follow(500))
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  cancelAnimationFrame(followRaf)
  document.removeEventListener('transitionrun', onTransition, true)
  document.removeEventListener('animationstart', onTransition, true)
  ro?.disconnect()
  host()?.removeEventListener('scroll', onScroll, true)
  host()?.removeEventListener('pointermove', onHostMove)
  host()?.removeEventListener('pointerleave', onHostLeave)
  window.removeEventListener('resize', onScroll)
  if (drag.value) finishDrag()
  window.removeEventListener('pointerup', onDragUp)
})
</script>

<template>
  <svg ref="el" class="linklayer" :class="{ under }" aria-hidden="true">
    <defs>
      <linearGradient v-for="l in shown" :id="`lg-${l.id}`" :key="l.id" gradientUnits="userSpaceOnUse" :x1="l.a.x" :y1="l.a.y" :x2="l.b.x" :y2="l.b.y">
        <stop offset="0" :stop-color="l.ca" />
        <stop offset="1" :stop-color="l.cb" />
      </linearGradient>
    </defs>
    <g v-for="l in shown" :key="l.id" :class="{ hot: hovered === l.id }">
      <path class="glow" :d="l.d" :stroke="`url(#lg-${l.id})`" />
      <path class="line" :d="l.d" :stroke="`url(#lg-${l.id})`" />
      <circle :cx="l.a.x" :cy="l.a.y" r="3" :fill="l.ca" class="end" />
      <circle :cx="l.b.x" :cy="l.b.y" r="3" :fill="l.cb" class="end" />
      <path class="hit" :d="l.d" @pointerenter="enter(l.id)" @pointerleave="leave" @pointerdown.stop />
    </g>
    <path v-if="dragPath" class="drag" :d="dragPath.d" :stroke="dragPath.color" />
    <circle v-if="dragPath && drag" :cx="drag.to.x" :cy="drag.to.y" r="4" :fill="dragPath.color" />
  </svg>
  <span
    v-if="corner"
    class="lk-corner"
    :style="{ left: `${corner.x}px`, top: `${corner.y}px` }"
    title="Потяните к другому блоку или заметке"
    @pointerdown="startDrag($event, corner.end)"
    @click.stop
  ></span>
  <template v-for="l in shown" :key="`x${l.id}`">
    <button
      v-if="hovered === l.id"
      class="unlink"
      :style="{ left: `${l.mid.x}px`, top: `${l.mid.y}px` }"
      title="Разорвать связь"
      @pointerenter="enter(l.id)"
      @pointerleave="leave"
      @pointerdown.stop
      @click.stop="(hovered = undefined), emit('unlink', l.id)"
    >
      <Icon name="x" :size="11" :stroke="2.6" />
    </button>
  </template>
</template>

<style scoped>
.linklayer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
  z-index: 7;
}
.linklayer.under {
  z-index: 0;
}
.line {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  opacity: 0.9;
  transition: stroke-width 0.15s;
}
.glow {
  fill: none;
  stroke-width: 6;
  opacity: 0.18;
  filter: blur(2px);
}
.hot .line {
  stroke-width: 3;
  opacity: 1;
}
.hot .glow {
  opacity: 0.4;
}
.end {
  stroke: rgba(17, 19, 26, 0.9);
  stroke-width: 1.5;
}
.hit {
  fill: none;
  stroke: transparent;
  stroke-width: 10;
  pointer-events: stroke;
  cursor: pointer;
}
.drag {
  fill: none;
  stroke-width: 2;
  stroke-dasharray: 5 4;
  opacity: 0.9;
}
.unlink {
  position: absolute;
  z-index: 8;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin: -10px 0 0 -10px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: #1c2030;
  color: #fca5a5;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  cursor: pointer;
}
.unlink:hover {
  background: #ef4444;
  color: #fff;
}
.lk-corner {
  position: absolute;
  z-index: 9;
  width: 11px;
  height: 11px;
  margin: -5.5px 0 0 -5.5px;
  box-sizing: border-box;
  border-radius: 50%;
  background: #fff;
  border: 2px solid rgba(17, 19, 26, 0.9);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5), 0 1px 4px rgba(0, 0, 0, 0.5);
  cursor: crosshair;
  animation: pop 0.12s ease-out;
}
.lk-corner:hover {
  transform: scale(1.25);
}
@keyframes pop {
  from {
    transform: scale(0.4);
    opacity: 0;
  }
}
</style>

<style>
/* while linking: the block / note under the pointer */
.link-target {
  outline: 2px solid #c4b5fd !important;
  outline-offset: 2px;
}
.linking [data-entry],
.linking [data-note] {
  cursor: copy !important;
}
</style>

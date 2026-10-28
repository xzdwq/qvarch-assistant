import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import ForceGraph from 'force-graph'
import type { NotebookGraph, ViewNode } from '@shared/notebook/graph'
import { cssColor } from '@renderer/lib/cssColor'
import { iconPicture, loadIconPictures, markColor, NODE_LOOK, radiusOf } from './graphLook'

/** A node as the graph keeps it (its place, its look). */
export type GNode = ViewNode & { x?: number; y?: number; r: number; color: string; emoji?: string }
type GLink = { source: string | GNode; target: string | GNode; type: string }

/** Where each node was last (a graph opened again — as it was left; dragged nodes stay where they were put). */
const placed = new Map<string, { x: number; y: number }>()
/** Labels come in as the view is zoomed in (as Obsidian's): from this zoom, fully a bit further. */
const LABEL_FROM = 0.75
const LABEL_FULL = 1.35
const cut = (s: string, n = 32) => (s.length > n ? `${s.slice(0, n)}…` : s)
const idOf = (end: string | GNode) => (typeof end === 'string' ? end : end.id)

export interface ForceGraphView {
  /** The graph to show. */
  data: Readonly<Ref<NotebookGraph | undefined>>
  /** A node's colour mark and emoji (a note's, a folder's — as the tree has them). */
  markOf: (n: ViewNode) => { color?: string; emoji?: string }
  /** The nodes a search finds (none — no search). */
  found: Readonly<Ref<ReadonlySet<string> | undefined>>
  /** The note the graph is about (ringed). */
  current: Readonly<Ref<string | undefined>>
  click: (n: GNode, e: MouseEvent) => void
}

/**
 * The notebook's graph drawn by force-graph (canvas, d3-force): nodes pull and push as Obsidian's, are dragged, the
 * wheel zooms and a drag moves; a node pointed at — it, its neighbours and its links lit, the rest faded; labels with
 * their icon (an emoji mark — instead) come in as the view is zoomed in. The theme's colours are read when drawn.
 */
export function useForceGraph(el: Ref<HTMLElement | undefined>, view: ForceGraphView) {
  let fg: InstanceType<typeof ForceGraph<GNode, GLink>> | undefined
  let near = new Map<string, Set<string>>()
  let hover: GNode | undefined
  let colors = { label: '', link: '', lit: '', ring: '' }
  const readColors = () => (colors = { label: cssColor('--graph-label'), link: cssColor('--graph-link'), lit: cssColor('--graph-link-lit'), ring: cssColor('--text-hi') })
  const lit = (id: string) => !!hover && (hover.id === id || !!near.get(hover.id)?.has(id))
  const faded = (n: GNode) => (hover ? !lit(n.id) : !!view.found.value && !view.found.value.has(n.id))
  const linkLit = (l: GLink) => !!hover && (idOf(l.source) === hover.id || idOf(l.target) === hover.id)
  const widthOf = (l: GLink) => (linkLit(l) ? 1.6 : 0.7)
  /**
   * A frame drawn again: the graph draws only while it moves or is touched — a link's width set anew asks for a frame;
   * while a node is pointed at, every frame is drawn (its neighbours lit).
   */
  const redraw = () => fg?.autoPauseRedraw(!hover).linkWidth(widthOf)

  function paintNode(n: GNode, ctx: CanvasRenderingContext2D, k: number): void {
    const dim = faded(n)
    ctx.globalAlpha = dim ? 0.15 : 1
    ctx.beginPath()
    ctx.arc(n.x ?? 0, n.y ?? 0, n.r, 0, 2 * Math.PI)
    ctx.fillStyle = n.color
    ctx.fill()
    if (n.path && n.path === view.current.value) {
      ctx.lineWidth = 2 / k
      ctx.strokeStyle = colors.ring
      ctx.stroke()
    }
    const shown = lit(n.id) || !!view.found.value?.has(n.id) ? 1 : Math.max(0, Math.min(1, (k - LABEL_FROM) / (LABEL_FULL - LABEL_FROM)))
    if (shown <= 0) return void (ctx.globalAlpha = 1)
    ctx.globalAlpha = (dim ? 0.15 : 1) * shown
    const fs = 11 / k
    const icon = fs * 1.15
    const gap = fs * 0.35
    const text = n.kind === 'tag' ? `#${cut(n.label)}` : cut(n.label)
    ctx.font = `${fs}px "Inter Variable", system-ui, sans-serif`
    ctx.textBaseline = 'middle'
    const width = icon + gap + ctx.measureText(text).width
    const x = (n.x ?? 0) - width / 2
    const y = (n.y ?? 0) + n.r + fs
    if (n.emoji) {
      ctx.font = `${icon}px system-ui, "Segoe UI Emoji", sans-serif`
      ctx.fillText(n.emoji, x, y)
      ctx.font = `${fs}px "Inter Variable", system-ui, sans-serif`
    } else {
      const pic = iconPicture(NODE_LOOK[n.kind].icon, colors.label)
      // (a picture that did not load is not drawn — a broken one would stop the whole frame)
      if (pic?.complete && pic.naturalWidth) ctx.drawImage(pic, x, y - icon / 2, icon, icon)
    }
    ctx.fillStyle = colors.label
    ctx.fillText(text, x + icon + gap, y)
    ctx.globalAlpha = 1
  }

  /** The data given to the graph: the nodes it had keep their places; new ones start where they were last. */
  function show(g: NotebookGraph | undefined): void {
    if (!fg || !g) return
    const had = new Map(fg.graphData().nodes.map((n) => [n.id, n]))
    const nodes: GNode[] = g.nodes.map((v) => {
      const mark = view.markOf(v)
      const was = had.get(v.id) ?? placed.get(v.id)
      return { ...v, r: radiusOf(v.degree), color: mark.color ? markColor(mark.color) : cssColor(NODE_LOOK[v.kind].color), ...(mark.emoji ? { emoji: mark.emoji } : {}), ...(was ? { x: was.x, y: was.y } : {}) }
    })
    near = new Map()
    for (const l of g.links) {
      near.set(l.from, (near.get(l.from) ?? new Set()).add(l.to))
      near.set(l.to, (near.get(l.to) ?? new Set()).add(l.from))
    }
    hover = undefined
    fg.graphData({ nodes, links: g.links.map((l) => ({ source: l.from, target: l.to, type: l.type })) })
  }

  onMounted(async () => {
    if (!el.value) return
    readColors()
    await loadIconPictures([colors.label])
    if (!el.value) return
    fg = new ForceGraph<GNode, GLink>(el.value)
      .backgroundColor('rgba(0,0,0,0)')
      .nodeRelSize(1)
      .nodeVal((n) => n.r * n.r)
      .nodeLabel((n) => (n.path ?? `${NODE_LOOK[n.kind].title}: ${n.label}`) + ` · связей: ${n.degree}`)
      .nodeCanvasObject(paintNode)
      .nodePointerAreaPaint((n, color, ctx) => {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(n.x ?? 0, n.y ?? 0, n.r + 2, 0, 2 * Math.PI)
        ctx.fill()
      })
      .linkColor((l) => (linkLit(l) ? colors.lit : colors.link))
      .linkWidth(widthOf)
      .linkDirectionalArrowLength(3.2)
      .linkDirectionalArrowRelPos(1)
      .onNodeHover((n) => {
        hover = n ?? undefined
        el.value!.style.cursor = n ? 'pointer' : ''
        redraw()
      })
      .onNodeClick((n, e) => view.click(n, e))
      .onNodeDragEnd((n) => placed.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 }))
      .onEngineStop(() => {
        for (const n of fg?.graphData().nodes ?? []) placed.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 })
      })
    // a weak pull to the middle: what is linked to nothing stays in view, round (as Obsidian's)
    fg.d3Force('charge')?.strength?.(-38)
    fg.d3Force('link')?.distance?.(34)
    fg.d3Force('gravity', gravity(0.045))
    size()
    show(view.data.value)
  })
  /** The canvas as big as its place. */
  const size = () => el.value && fg?.width(el.value.clientWidth).height(el.value.clientHeight)
  const ro = new ResizeObserver(() => size())
  watch(el, (e, was) => (was && ro.unobserve(was), e && ro.observe(e)), { immediate: true })
  watch(view.data, (g) => show(g))
  watch([view.found, view.current], redraw)
  onBeforeUnmount(() => {
    ro.disconnect()
    for (const n of fg?.graphData().nodes ?? []) placed.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 })
    fg?._destructor()
    fg = undefined
  })

  return {
    /** The whole graph in view. */
    fit: () => fg?.zoomToFit(400, 40),
    /** The nodes pushed about again (a picture that settled badly). */
    shake: () => {
      for (const n of fg?.graphData().nodes ?? []) placed.delete(n.id)
      fg?.d3ReheatSimulation()
    },
  }
}

/** A force pulling every node a little to the middle. */
function gravity(strength: number) {
  let nodes: GNode[] = []
  const force = (alpha: number) => {
    for (const n of nodes) {
      ;(n as GNode & { vx: number }).vx -= (n.x ?? 0) * strength * alpha
      ;(n as GNode & { vy: number }).vy -= (n.y ?? 0) * strength * alpha
    }
  }
  force.initialize = (ns: GNode[]) => (nodes = ns)
  return force
}

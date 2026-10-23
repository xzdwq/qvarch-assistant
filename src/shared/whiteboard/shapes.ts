import type { ShapeKind } from './model'

/** Shapes' outlines: SVG path data, the same for the canvas (Path2D) and the shape menu's icons. */

const n = (v: number) => Math.round(v * 100) / 100
/**
 * A shape's outline as SVG path data in its own box (0,0)–(w,h); a line / an arrow — from (0,0) to (w,h).
 * The same data draws on the canvas (Path2D) and in the shape menu's icons.
 * `fillable` — the closed part (the fill); `extra` — inner strokes (a server's shelves, a note's fold…).
 */
export function shapeD(kind: ShapeKind, w: number, h: number, width = 2): { d: string; extra?: string; head?: string; fillable: boolean } {
  const mn = Math.min(Math.abs(w), Math.abs(h))
  switch (kind) {
    case 'rect':
      return { d: `M0 0H${n(w)}V${n(h)}H0Z`, fillable: true }
    case 'round':
    case 'terminator': {
      const r = n(kind === 'terminator' ? h / 2 : mn * 0.18)
      return { d: `M${r} 0H${n(w - r)}A${r} ${r} 0 0 1 ${n(w)} ${r}V${n(h - r)}A${r} ${r} 0 0 1 ${n(w - r)} ${n(h)}H${r}A${r} ${r} 0 0 1 0 ${n(h - r)}V${r}A${r} ${r} 0 0 1 ${r} 0Z`, fillable: true }
    }
    case 'ellipse': {
      const rx = n(Math.abs(w) / 2)
      const ry = n(Math.abs(h) / 2)
      const cx = n(w / 2)
      const cy = n(h / 2)
      const x0 = n(w / 2 - Math.abs(w) / 2)
      const x1 = n(w / 2 + Math.abs(w) / 2)
      const y0 = n(h / 2 - Math.abs(h) / 2)
      const y1 = n(h / 2 + Math.abs(h) / 2)
      return { d: `M${x0} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${y0}A${rx} ${ry} 0 0 1 ${x1} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${y1}A${rx} ${ry} 0 0 1 ${x0} ${cy}Z`, fillable: true }
    }
    case 'diamond':
      return { d: `M${n(w / 2)} 0L${n(w)} ${n(h / 2)}L${n(w / 2)} ${n(h)}L0 ${n(h / 2)}Z`, fillable: true }
    case 'parallelogram': {
      const k = n(Math.min(w * 0.2, h * 0.6))
      return { d: `M${k} 0H${n(w)}L${n(w - k)} ${n(h)}H0Z`, fillable: true }
    }
    case 'hexagon': {
      const k = n(Math.min(w * 0.22, h * 0.5))
      return { d: `M${k} 0H${n(w - k)}L${n(w)} ${n(h / 2)}L${n(w - k)} ${n(h)}H${k}L0 ${n(h / 2)}Z`, fillable: true }
    }
    case 'doc': {
      const b = n(h * 0.86)
      return { d: `M0 0H${n(w)}V${b}C${n(w * 0.75)} ${n(h * 0.72)} ${n(w * 0.5)} ${n(h * 1.02)} ${n(w * 0.25)} ${n(h * 0.88)}C${n(w * 0.14)} ${n(h * 0.82)} ${n(w * 0.06)} ${n(h * 0.82)} 0 ${b}Z`, fillable: true }
    }
    case 'note': {
      const f = n(mn * 0.22)
      return { d: `M0 0H${n(w - f)}L${n(w)} ${f}V${n(h)}H0Z`, extra: `M${n(w - f)} 0V${f}H${n(w)}`, fillable: true }
    }
    case 'db': {
      const ry = n(Math.min(h * 0.14, w * 0.3))
      const rx = n(w / 2)
      return {
        d: `M0 ${ry}A${rx} ${ry} 0 0 1 ${n(w)} ${ry}V${n(h - ry)}A${rx} ${ry} 0 0 1 0 ${n(h - ry)}Z`,
        extra: `M0 ${ry}A${rx} ${ry} 0 0 0 ${n(w)} ${ry}`,
        fillable: true,
      }
    }
    case 'queue': {
      const rx = n(Math.min(w * 0.14, h * 0.3))
      const ry = n(h / 2)
      return {
        d: `M${rx} 0H${n(w - rx)}A${rx} ${ry} 0 0 1 ${n(w - rx)} ${n(h)}H${rx}A${rx} ${ry} 0 0 1 ${rx} 0Z`,
        extra: `M${n(w - rx)} 0A${rx} ${ry} 0 0 0 ${n(w - rx)} ${n(h)}`,
        fillable: true,
      }
    }
    case 'server': {
      const r = n(mn * 0.08)
      const dots = [1, 3, 5].map((k) => `M${n(w * 0.12)} ${n((h * k) / 6)}h${n(Math.max(1, w * 0.06))}`).join('')
      return {
        d: `M${r} 0H${n(w - r)}Q${n(w)} 0 ${n(w)} ${r}V${n(h - r)}Q${n(w)} ${n(h)} ${n(w - r)} ${n(h)}H${r}Q0 ${n(h)} 0 ${n(h - r)}V${r}Q0 0 ${r} 0Z`,
        extra: `M0 ${n(h / 3)}H${n(w)}M0 ${n((2 * h) / 3)}H${n(w)}${dots}`,
        fillable: true,
      }
    }
    case 'component': {
      const bw = n(Math.min(w * 0.18, 18 + width))
      const bh = n(Math.min(h * 0.16, 10 + width))
      const x0 = n(-bw / 2)
      return {
        d: `M0 0H${n(w)}V${n(h)}H0Z`,
        extra: `M${x0} ${n(h * 0.25)}h${bw}v${bh}h${n(-bw)}ZM${x0} ${n(h * 0.6)}h${bw}v${bh}h${n(-bw)}Z`,
        fillable: true,
      }
    }
    case 'cloud': {
      // five bumps around the box
      return {
        d: `M${n(w * 0.25)} ${n(h * 0.85)}C${n(w * 0.02)} ${n(h * 0.88)} ${n(-w * 0.02)} ${n(h * 0.5)} ${n(w * 0.2)} ${n(h * 0.45)}C${n(w * 0.15)} ${n(h * 0.12)} ${n(w * 0.45)} ${n(-h * 0.02)} ${n(w * 0.55)} ${n(h * 0.22)}C${n(w * 0.68)} ${n(h * 0.02)} ${n(w * 0.95)} ${n(h * 0.12)} ${n(w * 0.85)} ${n(h * 0.42)}C${n(w * 1.05)} ${n(h * 0.5)} ${n(w * 1.02)} ${n(h * 0.88)} ${n(w * 0.78)} ${n(h * 0.85)}Z`,
        fillable: true,
      }
    }
    case 'actor': {
      const r = n(Math.min(w * 0.22, h * 0.13))
      const cx = n(w / 2)
      const neck = n(r * 2)
      const hip = n(h * 0.62)
      return {
        d: `M${cx} 0A${r} ${r} 0 1 0 ${cx} ${neck}A${r} ${r} 0 1 0 ${cx} 0Z`,
        extra: `M${cx} ${neck}V${hip}M${n(w * 0.08)} ${n(h * 0.34)}H${n(w * 0.92)}M${cx} ${hip}L${n(w * 0.12)} ${n(h)}M${cx} ${hip}L${n(w * 0.88)} ${n(h)}`,
        fillable: true,
      }
    }
    case 'line':
    case 'arrow':
    case 'arrow2': {
      const d = `M0 0L${n(w)} ${n(h)}`
      if (kind === 'line') return { d, fillable: false }
      const len = Math.hypot(w, h) || 1
      const hl = Math.max(8, width * 4)
      const ux = w / len
      const uy = h / len
      const head = (tx: number, ty: number, dx: number, dy: number) =>
        `M${n(tx - dx * hl - dy * hl * 0.55)} ${n(ty - dy * hl + dx * hl * 0.55)}L${n(tx)} ${n(ty)}L${n(tx - dx * hl + dy * hl * 0.55)} ${n(ty - dy * hl - dx * hl * 0.55)}`
      return { d, head: head(w, h, ux, uy) + (kind === 'arrow2' ? head(0, 0, -ux, -uy) : ''), fillable: false }
    }
  }
}

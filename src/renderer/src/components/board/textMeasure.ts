/** Typed text on the board: its font, line height and measured size. */
export const FONT = `Inter, "Segoe UI", system-ui, sans-serif`
/** Line height, in font sizes. */
export const LINE = 1.25

let measureCtx: CanvasRenderingContext2D | null = null

/** A text's box at a font size (world units): its widest line, its lines' height. */
export function measureText(text: string, size: number): { w: number; h: number } {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  const g = measureCtx!
  g.font = `${size}px ${FONT}`
  const lines = text.split('\n')
  const w = Math.max(size * 0.5, ...lines.map((l) => g.measureText(l).width))
  return { w: Math.ceil(w), h: Math.ceil(lines.length * size * LINE) }
}

import { paperTiles } from '../../../lib/paper'

/** How much ink the tooth takes away (a light grain). */
export const TOOTH = 0.22

/**
 * Textured paper: its tone and tooth as canvas patterns (one per paper colour), and the ink layer the tooth is
 * cut out of before the ink is laid down.
 */
export class PaperTexture {
  private readonly toothPats = new Map<string, CanvasPattern>()
  private readonly tonePats = new Map<string, CanvasPattern>()
  private layerCv: HTMLCanvasElement | undefined

  /** The paper's grain (cut out of the ink). */
  toothOf(g: CanvasRenderingContext2D, color: string): CanvasPattern | undefined {
    return this.patternOf(this.toothPats, g, color, 'tooth')
  }

  /** The paper's uneven tone (laid over the paper colour). */
  toneOf(g: CanvasRenderingContext2D, color: string): CanvasPattern | undefined {
    return this.patternOf(this.tonePats, g, color, 'tone')
  }

  /** The ink layer for a canvas: as big as it, cleared, with its transform. */
  layerFor(g: CanvasRenderingContext2D): CanvasRenderingContext2D {
    const cv = (this.layerCv ??= document.createElement('canvas'))
    if (cv.width !== g.canvas.width || cv.height !== g.canvas.height) {
      cv.width = g.canvas.width
      cv.height = g.canvas.height
    }
    const lg = cv.getContext('2d')!
    lg.setTransform(1, 0, 0, 1, 0, 0)
    lg.clearRect(0, 0, cv.width, cv.height)
    lg.setTransform(g.getTransform())
    return lg
  }

  private patternOf(cache: Map<string, CanvasPattern>, g: CanvasRenderingContext2D, color: string, tile: 'tooth' | 'tone'): CanvasPattern | undefined {
    let p = cache.get(color)
    if (!p) {
      p = g.createPattern(paperTiles(color)[tile], 'repeat') ?? undefined
      if (p) cache.set(color, p)
    }
    return p
  }
}

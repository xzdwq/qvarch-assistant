import { nativeImage, type NativeImage } from 'electron'

/**
 * The app glyph — a bold "Q" (ring + tail) — as a raw BGRA bitmap, so no binary image assets are needed
 * at runtime. Same geometry as scripts/make-icon.mjs (the exe icon). 4×4 supersampling for smooth edges.
 */
export function qCoverage(u: number, v: number): boolean {
  const r = Math.hypot(u - 0.5, v - 0.47)
  if (r <= 0.4 && r >= 0.245) return true
  // tail: a capsule from inside the ring towards the bottom-right corner
  const [ax, ay, bx, by] = [0.57, 0.6, 0.86, 0.9]
  const t = Math.max(0, Math.min(1, ((u - ax) * (bx - ax) + (v - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
  return Math.hypot(u - (ax + t * (bx - ax)), v - (ay + t * (by - ay))) <= 0.075
}

export function makeIcon(size: number, rgb: [number, number, number] = [124, 108, 246]): NativeImage {
  const buf = Buffer.alloc(size * size * 4)
  const N = 4
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0
      for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) if (qCoverage((x + (sx + 0.5) / N) / size, (y + (sy + 0.5) / N) / size)) hits++
      const i = (y * size + x) * 4
      buf[i] = rgb[2]
      buf[i + 1] = rgb[1]
      buf[i + 2] = rgb[0]
      buf[i + 3] = Math.round((hits / (N * N)) * 255)
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size })
}

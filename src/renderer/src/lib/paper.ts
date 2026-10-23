/**
 * Textured paper for boards: an uneven tone (soft blotches, fine grain, a few fibres) and the paper's "tooth" —
 * the tiny raised spots ink does not reach — both as seamless tiles, laid in world units (they zoom with the
 * board). Made once per paper colour.
 */
import { cssHex } from './cssColor'

const T = 512

/** A hash → 0…1 (deterministic: the same paper every time). */
function hash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
/** Value noise, seamless with a period of `p` cells (the cell size must divide the tile). */
function noise(x: number, y: number, p: number, s: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = x - xi
  const fy = y - yi
  const u = fx * fx * (3 - 2 * fx)
  const v = fy * fy * (3 - 2 * fy)
  const w = (a: number) => ((a % p) + p) % p
  const a = hash(w(xi), w(yi), s)
  const b = hash(w(xi + 1), w(yi), s)
  const c = hash(w(xi), w(yi + 1), s)
  const d = hash(w(xi + 1), w(yi + 1), s)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
function rgb(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})/i.exec(c)
  const n = m ? parseInt(m[1], 16) : 0xffffff
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export interface PaperTiles {
  /** The paper itself (opaque). */
  tone: HTMLCanvasElement
  /** Where ink skips (alpha — how much). */
  tooth: HTMLCanvasElement
}
const cache = new Map<string, PaperTiles>()

export function paperTiles(color: string): PaperTiles {
  const hit = cache.get(color)
  if (hit) return hit
  const [r, g, b] = rgb(color)
  const dark = 0.299 * r + 0.587 * g + 0.114 * b < 128
  const tone = document.createElement('canvas')
  const tooth = document.createElement('canvas')
  tone.width = tone.height = tooth.width = tooth.height = T
  const tc = tone.getContext('2d')!
  const kc = tooth.getContext('2d')!
  const ti = tc.createImageData(T, T)
  const ki = kc.createImageData(T, T)
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      // blotches (large, soft) + mottling (middle) + grain (fine)
      const blot = noise(x / 128, y / 128, T / 128, 1) * 0.55 + noise(x / 32, y / 32, T / 32, 2) * 0.45
      const grain = noise(x / 2, y / 2, T / 2, 3) * 0.6 + hash(x, y, 4) * 0.4
      const l = (blot - 0.5) * 0.07 + (grain - 0.5) * 0.045
      const k = dark ? 1 + l * 1.6 : 1 + l
      const o = (y * T + x) * 4
      ti.data[o] = Math.min(255, r * k)
      ti.data[o + 1] = Math.min(255, g * k)
      ti.data[o + 2] = Math.min(255, b * k * (dark ? 1 : 0.995))
      ti.data[o + 3] = 255
      // the tooth: the high spots of a fine relief
      const t = noise(x / 2, y / 2, T / 2, 5) * 0.7 + noise(x / 4, y / 4, T / 4, 6) * 0.3
      ki.data[o + 3] = Math.max(0, Math.min(255, (t - 0.58) * 255 * 3.2))
    }
  tc.putImageData(ti, 0, 0)
  kc.putImageData(ki, 0, 0)
  // fibres: a few long faint curves (light on a dark paper, brownish on a light one)
  tc.lineCap = 'round'
  const fibre = rgb(cssHex(dark ? '--paper-fibre-on-dark' : '--paper-fibre-on-light') ?? '').join(',')
  for (let i = 0; i < 70; i++) {
    const x = hash(i, 1, 7) * T
    const y = hash(i, 2, 7) * T
    const a = hash(i, 3, 7) * Math.PI * 2
    const len = 8 + hash(i, 4, 7) * 30
    tc.strokeStyle = `rgba(${fibre},${dark ? 0.01 + hash(i, 5, 7) * 0.015 : 0.03 + hash(i, 5, 7) * 0.04})`
    tc.lineWidth = 0.4 + hash(i, 6, 7) * 0.5
    tc.beginPath()
    tc.moveTo(x, y)
    tc.quadraticCurveTo(x + Math.cos(a + 0.6) * len * 0.5, y + Math.sin(a + 0.6) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len)
    tc.stroke()
  }
  const out = { tone, tooth }
  cache.set(color, out)
  return out
}

/** A seeded random 0…1 sequence (the same splashes on every redraw of a stroke). */
export function seeded(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967295
  }
}

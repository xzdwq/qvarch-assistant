// Two parity runs compared: every element's computed styles and box, section by section (and their hover states).
// Usage: node scripts/parity/diff.mjs <before dir> <after dir> [--limit N] [--boxes] [--exact] [--summary] [--only a,b]
//   --boxes   compare the boxes too (positions move with the clock and live data — off by default; sizes are styles)
//   --exact   sub-pixel differences too (by default pixel values are rounded)
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [a, b] = process.argv.slice(2, 4)
const limit = Number(process.argv[process.argv.indexOf('--limit') + 1]) || 40
const boxes = process.argv.includes('--boxes')
const exact = process.argv.includes('--exact')
/** --summary: each kind of change (section, property, before → after) with how many elements have it */
const summary = process.argv.includes('--summary')
const kinds = new Map()
/** Sub-pixel noise let go (a clock's text a bit wider, the now line a minute further): pixel values rounded. */
const norm = (v) =>
  String(v ?? '')
    // a colour in any notation (rgb / oklab / color(srgb) — a colour-mix computes to the latter) as one rgba, its
    // channels to within rounding
    .replace(/(?:rgba?|oklab|color)\([^()]*\)/g, (c) => rgbaOf(c) ?? c)
    .replace(/-?\d+\.\d+px/g, (n) => `${Math.round(parseFloat(n))}px`)
    // the diagrams' generated ids (a new one each render)
    .replace(/qa-mmd-\d+/g, 'qa-mmd-N')
/**
 * Two computed values the same to the eye: equal once normalised, or differing only in their colours by a rounding
 * (a channel by ≤ 2 of 255, the alpha by ≤ 0.02 — a colour computed in CSS vs. one written out).
 */
function sameValue(a, b) {
  const x = norm(a)
  const y = norm(b)
  if (x === y) return true
  const COLOR = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/g
  if (x.replace(COLOR, 'C') !== y.replace(COLOR, 'C')) return false
  const cx = [...x.matchAll(COLOR)].map((m) => m.slice(1).map(Number))
  const cy = [...y.matchAll(COLOR)].map((m) => m.slice(1).map(Number))
  return cx.every((c, i) => c.every((v, k) => Math.abs(v - cy[i][k]) <= (k === 3 ? 0.02 : 2)))
}
/** A computed colour as `rgba(r,g,b,a)` (channels to steps of 4, alpha to 0.01); undefined — not one it reads. */
function rgbaOf(c) {
  // (`none` — a channel that is 0)
  const nums = (s) => s.split(/[\s,/]+/).filter(Boolean).map((x) => (x === 'none' ? 0 : x.endsWith('%') ? parseFloat(x) / 100 : parseFloat(x)))
  let rgb
  let a = 1
  const body = c.slice(c.indexOf('(') + 1, -1)
  if (c.startsWith('rgb')) {
    const n = nums(body)
    rgb = n.slice(0, 3)
    if (n.length > 3) a = n[3]
  } else if (c.startsWith('color(srgb')) {
    const n = nums(body.replace(/^srgb/, ''))
    rgb = n.slice(0, 3).map((x) => x * 255)
    if (n.length > 3) a = n[3]
  } else if (c.startsWith('oklab')) {
    const [L, A, B, alpha] = nums(body)
    if (alpha !== undefined) a = alpha
    // OKLab → linear sRGB → sRGB
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
    const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    rgb = lin.map((x) => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055))
  } else return undefined
  if (rgb.some((x) => !Number.isFinite(x))) return undefined
  // a fully clear colour is the same whatever its channels
  if (a === 0) return 'rgba(0,0,0,0)'
  const q = (x) => Math.round(Math.max(0, Math.min(255, x)))
  // (rgb() alpha is kept in 8 bits, oklab()'s is not: 0.024 and 0.025 are one colour)
  return `rgba(${rgb.map(q).join(',')},${Math.round(a * 50) / 50})`
}
/** --only a,b: these sections only (their dumps and hover dumps) */
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : undefined
const files = readdirSync(a).filter((f) => f.endsWith('.json') && f !== 'steps.json' && (!only || only.includes(f.replace(/(\.hover)?\.json$/, ''))))
let total = 0
/**
 * What cannot be seen let go: a border side of no width (its style, its colour), an outline of no width or none.
 * (`v` — [box, ...props]; `props` — their names.)
 */
function invisibleCleared(v, props) {
  const at = (p) => props.indexOf(p) + 1
  const out = [...v]
  for (const s of ['top', 'right', 'bottom', 'left'])
    if (out[at(`border-${s}-width`)] === '0px') {
      out[at(`border-${s}-style`)] = ''
      out[at(`border-${s}-color`)] = ''
    }
  if (out[at('outline-style')] === 'none' || out[at('outline-width')] === '0px') {
    out[at('outline-style')] = ''
    out[at('outline-width')] = ''
    out[at('outline-color')] = ''
  }
  return out
}
/** A dump's entries: path → [box, ...props] (a hover dump is a list of such maps — merged, its index in the key). */
function entries(file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(raw)) return raw
  const out = {}
  raw.forEach((m, i) => Object.entries(m).forEach(([k, v]) => (k === '__props' ? (out.__props = v) : (out[`#${i} ${k}`] = v))))
  return out
}
for (const f of files) {
  if (!existsSync(join(b, f))) {
    console.log(`${f}: missing after`)
    continue
  }
  const A = entries(join(a, f))
  const B = entries(join(b, f))
  // a hover dump carries no names: its section's own dump does (the same props)
  const plain = join(a, f.replace('.hover.json', '.json'))
  const plainA = existsSync(plain) ? entries(plain) : {}
  const props = (A.__props ?? B.__props ?? plainA.__props ?? '').split('|')
  // what a path is: its classes before (the old ones name it)
  const classes = plainA.__classes ?? {}
  const named = (k) => {
    const path = k.replace(/^#\d+ /, '').replace(/::(before|after)$/, '')
    return classes[path] ? `${k}  .${classes[path].trim().split(/\s+/).slice(0, 4).join('.')}` : k
  }
  const diffs = []
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    if (k === '__props' || k === '__classes') continue
    if (!(k in B)) diffs.push(`- ${k}`)
    else if (!(k in A)) diffs.push(`+ ${k}`)
    else if (A[k] !== B[k]) {
      const x = invisibleCleared(String(A[k]).split('|'), props)
      const y = invisibleCleared(String(B[k]).split('|'), props)
      const what = []
      if (boxes && x[0] !== y[0]) what.push(`box ${x[0]} → ${y[0]}`)
      for (let i = 1; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i] && (exact || !sameValue(x[i], y[i]))) what.push(`${props[i - 1] ?? i}: ${x[i]} → ${y[i]}`)
      if (what.length) diffs.push(`~ ${named(k)}\n    ${what.join('\n    ')}`)
      for (const w of what) kinds.set(`${f.replace(/(\.hover)?\.json$/, '')}  ${w}`, (kinds.get(`${f.replace(/(\.hover)?\.json$/, '')}  ${w}`) ?? 0) + 1)
    }
  }
  total += diffs.length
  console.log(`${f}: ${diffs.length ? `${diffs.length} differences` : 'same'}`)
  for (const d of diffs.slice(0, limit)) console.log(`  ${d}`)
}
if (summary) for (const [w, n] of [...kinds].sort((x, y) => y[1] - x[1])) console.log(`${String(n).padStart(4)}  ${w}`)
console.log(total ? `\n${total} differences` : '\nno differences')
process.exit(total ? 1 : 0)

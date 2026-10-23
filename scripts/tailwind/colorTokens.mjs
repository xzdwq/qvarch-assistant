// Colours and shadows written as values in the components' classes → the theme's tokens: white / black / the accent
// at an alpha as an opacity modifier (`tw:bg-[rgba(255,255,255,0.07)]` → `tw:bg-white/7`,
// `tw:bg-[rgb(var(--accent-rgb)/0.22)]` → `tw:bg-accent/22`), the named values as their token / variable. Each new
// utility must compile (Tailwind); --dry only counts.
// Usage: node scripts/tailwind/colorTokens.mjs [--dry]
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { __unstable__loadDesignSystem } from '@tailwindcss/node'
import { sourceTexts } from './classNames.mjs'

const cssPath = resolve('src/renderer/src/styles/tailwind.css')
const ds = await __unstable__loadDesignSystem(readFileSync(cssPath, 'utf8'), { base: dirname(cssPath) })
const dry = process.argv.includes('--dry')

/** The utilities that take a colour (their part before `-[…]`). */
const COLOR_UTILITY = /^(bg|text|border(?:-[trblxy])?|outline|decoration|fill|stroke|caret|accent|from|via|to|divide|ring|placeholder)$/
/**
 * The theme's colours by their RGB: every `--color-<name>: var(--<x>)` of tailwind.css whose `--<x>` is a plain hex in
 * base.css (and white / black) — a value of that RGB is that token.
 */
const TOKEN_BY_RGB = (() => {
  const base = readFileSync(resolve('src/renderer/src/lib/base.css'), 'utf8')
  const hexOf = new Map([...base.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)].map((m) => [m[1], m[2]]))
  const out = new Map([
    ['255,255,255', 'white'],
    ['0,0,0', 'black'],
  ])
  for (const m of readFileSync(cssPath, 'utf8').matchAll(/--color-([\w-]+):\s*var\(--([\w-]+)\)/g)) {
    const hex = hexOf.get(m[2])
    const rgb = hex && rgbOfHex(hex)
    if (rgb && !out.has(rgb)) out.set(rgb, m[1])
  }
  return out
})()
function rgbOfHex(hex) {
  const h = hex.slice(1)
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).join(',')
}
/** A colour value → [its RGB key, alpha]; the accent by its variable. */
function colorOf(v) {
  let m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(v)
  if (m) return [rgbOfHex(v), 1]
  m = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,/\s]+(0?\.\d+|1|0))?\)$/.exec(v)
  if (m) return [`${m[1]},${m[2]},${m[3]}`, m[4] === undefined ? 1 : Number(m[4])]
  m = /^rgb\(var\(--accent-rgb\)\/(0?\.\d+|1)\)$/.exec(v)
  if (m) return ['accent', Number(m[1])]
  return undefined
}
/** Whole arbitrary properties → a named value. */
const NAMED_PROPERTIES = {
  '[box-shadow:0_14px_34px_rgba(0,0,0,0.55)]': '[box-shadow:var(--shadow-menu)]',
  '[box-shadow:var(--shadow),inset_0_2px_0_var(--accent)]': '[box-shadow:var(--shadow-pop-edge)]',
  '[box-shadow:inset_0_-2px_0_var(--accent)]': '[box-shadow:var(--shadow-underline)]',
  '[box-shadow:inset_0_0_0_1px_var(--accent)]': '[box-shadow:var(--shadow-ring-accent)]',
}
const percent = (a) => String(Math.round(Number(a) * 1000) / 10)

/** A utility (without variants) in token form, or itself. */
function tokenized(base) {
  if (NAMED_PROPERTIES[base]) return NAMED_PROPERTIES[base]
  const m = /^([a-z-]+?)-\[(?:color:)?([^\]]+)\]$/.exec(base)
  if (!m || !COLOR_UTILITY.test(m[1])) return base
  // (`_` is a space in a value: `rgb(239_68_68/0.06)`)
  const c = colorOf(m[2].replace(/_/g, ' ').replace(/\s*\/\s*/, '/').replace(/,\s*/g, ','))
  const token = c && (c[0] === 'accent' ? 'accent' : TOKEN_BY_RGB.get(c[0]))
  if (!token) return base
  return c[1] === 1 ? `${m[1]}-${token}` : `${m[1]}-${token}/${percent(c[1])}`
}
/** The variants and the base of a utility (top-level colons). */
function split(u) {
  let depth = 0
  for (let i = u.length - 1; i >= 0; i--) {
    const ch = u[i]
    if (ch === ']' || ch === ')') depth++
    else if (ch === '[' || ch === '(') depth--
    else if (ch === ':' && depth === 0) return [u.slice(0, i + 1), u.slice(i + 1)]
  }
  return ['', u]
}

let changed = 0
const unknown = new Set()
for (const [f, text] of sourceTexts()) {
  if (!f.endsWith('.vue')) continue
  const out = text.replace(/(\sclass=")([^"]*)(")/g, (_, a, v, b) => {
    const next = v.split(/(\s+)/).map((t) => {
      if (!t.startsWith('tw:')) return t
      const [variants, base] = split(t.slice(3))
      // (an important mark stays at the end)
      const bang = base.endsWith('!') ? '!' : ''
      const nb = tokenized(bang ? base.slice(0, -1) : base)
      if (nb === base.replace(/!$/, '')) return t
      const u = `tw:${variants}${nb}${bang}`
      if (!ds.candidatesToCss([u])[0]) {
        unknown.add(u)
        return t
      }
      changed++
      return u
    })
    return a + next.join('') + b
  })
  if (!dry && out !== text) writeFileSync(f, out)
}
console.log(`${changed} utilities on tokens`)
if (unknown.size) console.log(`not compiled (kept as they were):\n${[...unknown].slice(0, 20).join('\n')}`)

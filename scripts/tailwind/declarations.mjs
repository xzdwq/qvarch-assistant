// A CSS declaration → Tailwind v4 utilities (the app's theme: 1px spacing unit, colours / fonts / corners as tokens —
// src/renderer/src/styles/tailwind.css). What has no utility of its own becomes an arbitrary property: [prop:value].

/** The app's tokens: a CSS variable → its Tailwind name. */
const COLOR_TOKENS = {
  '--bg': 'bg', '--panel': 'panel', '--panel-2': 'panel-2', '--panel-3': 'panel-3', '--field-bg': 'field', '--hover': 'hover', '--pop': 'pop',
  '--border': 'border', '--border-2': 'border-2', '--border-3': 'border-3',
  '--text-hi': 'text-hi', '--text': 'text', '--text-2': 'text-2', '--muted': 'muted', '--dim': 'dim',
  '--accent': 'accent', '--accent-hi': 'accent-hi', '--accent-fg': 'accent-fg', '--accent-soft': 'accent-soft', '--accent-line': 'accent-line', '--on-accent': 'on-accent',
  '--cyan': 'cyan', '--info': 'info', '--info-fg': 'info-fg', '--up': 'up', '--up-fg': 'up-fg', '--down': 'down', '--down-fg': 'down-fg', '--warn': 'warn', '--warn-fg': 'warn-fg',
}
const RADIUS_TOKENS = { '--r1': 'r1', '--r2': 'r2', '--r3': 'r3' }
const FONT_TOKENS = { '--font-ui': 'ui', '--font-data': 'data' }

/** A value inside [...] of a class name: spaces → _, an underscore kept as \_. */
// (double quotes become single: the utility lives inside class="…")
export const arb = (v) => v.trim().replace(/_/g, '\\_').replace(/\s+/g, '_').replace(/"/g, "'")
/** An arbitrary property utility. */
const prop = (p, v) => `[${p}:${arb(v)}]`
const tokenOf = (v, table) => {
  const m = /^var\((--[\w-]+)\)$/.exec(v.trim())
  return m && table[m[1]]
}
const color = (v) => {
  const t = v.trim()
  if (t === 'transparent') return 'transparent'
  if (t === 'currentColor' || t === 'currentcolor') return 'current'
  if (t === 'inherit') return 'inherit'
  if (/^#fff(fff)?$/i.test(t)) return 'white'
  if (/^#000(000)?$/i.test(t)) return 'black'
  return tokenOf(t, COLOR_TOKENS)
}
/** A length on the 1px spacing scale (12px → 12, 0 → 0; -4px → -4), or undefined. */
const spacingNum = (v) => {
  const t = v.trim()
  if (t === '0') return '0'
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(t)
  if (!m) return undefined
  const n = Number(m[1])
  // (the scale takes quarter steps; anything finer — an arbitrary value)
  return Number.isInteger(n * 4) ? String(n) : undefined
}
/** A spacing utility: `prefix-<n>` / `-prefix-<n>` / keywords / an arbitrary value. */
function spacing(prefix, v, { auto = false, full = false } = {}) {
  const t = v.trim()
  if (auto && t === 'auto') return `${prefix}-auto`
  if (full && t === '100%') return `${prefix}-full`
  const n = spacingNum(t)
  if (n !== undefined) return n.startsWith('-') ? `-${prefix}-${n.slice(1)}` : `${prefix}-${n}`
  return `${prefix}-[${arb(t)}]`
}
/** The values of a box shorthand (1–4) as top, right, bottom, left. */
function box4(v) {
  const parts = splitTop(v)
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]]
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]]
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]]
  return parts.slice(0, 4)
}
/** A value split by its top-level spaces (not inside parentheses). */
export function splitTop(v, sep = ' ') {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of v.trim()) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) {
      if (cur) out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}
/** Box sides as utilities: all equal — one; x / y pairs — two; else four. */
function sides(prefix, v, opts) {
  const [t, r, b, l] = box4(v)
  if (t === r && r === b && b === l) return [spacing(prefix, t, opts)]
  if (t === b && r === l) return [spacing(`${prefix}y`, t, opts), spacing(`${prefix}x`, r, opts)]
  return [spacing(`${prefix}t`, t, opts), spacing(`${prefix}r`, r, opts), spacing(`${prefix}b`, b, opts), spacing(`${prefix}l`, l, opts)]
}
const KEYWORDS = {
  display: { flex: 'flex', 'inline-flex': 'inline-flex', block: 'block', 'inline-block': 'inline-block', inline: 'inline', grid: 'grid', 'inline-grid': 'inline-grid', none: 'hidden', contents: 'contents', table: 'table', 'table-cell': 'table-cell', 'table-row': 'table-row', 'list-item': 'list-item', 'flow-root': 'flow-root' },
  position: { static: 'static', relative: 'relative', absolute: 'absolute', fixed: 'fixed', sticky: 'sticky' },
  'flex-direction': { row: 'flex-row', column: 'flex-col', 'row-reverse': 'flex-row-reverse', 'column-reverse': 'flex-col-reverse' },
  'flex-wrap': { wrap: 'flex-wrap', nowrap: 'flex-nowrap', 'wrap-reverse': 'flex-wrap-reverse' },
  'align-items': { center: 'items-center', 'flex-start': 'items-start', start: 'items-start', 'flex-end': 'items-end', end: 'items-end', baseline: 'items-baseline', stretch: 'items-stretch' },
  'align-self': { center: 'self-center', 'flex-start': 'self-start', start: 'self-start', 'flex-end': 'self-end', end: 'self-end', stretch: 'self-stretch', baseline: 'self-baseline', auto: 'self-auto' },
  'align-content': { center: 'content-center', 'flex-start': 'content-start', 'flex-end': 'content-end', 'space-between': 'content-between', stretch: 'content-stretch' },
  'justify-content': { center: 'justify-center', 'flex-start': 'justify-start', start: 'justify-start', 'flex-end': 'justify-end', end: 'justify-end', 'space-between': 'justify-between', 'space-around': 'justify-around', 'space-evenly': 'justify-evenly', stretch: 'justify-stretch' },
  'justify-items': { center: 'justify-items-center', start: 'justify-items-start', end: 'justify-items-end', stretch: 'justify-items-stretch' },
  'place-items': { center: 'place-items-center', start: 'place-items-start', end: 'place-items-end', stretch: 'place-items-stretch' },
  'text-align': { left: 'text-left', center: 'text-center', right: 'text-right', justify: 'text-justify', start: 'text-start', end: 'text-end' },
  'text-transform': { uppercase: 'uppercase', lowercase: 'lowercase', capitalize: 'capitalize', none: 'normal-case' },
  'font-style': { italic: 'italic', normal: 'not-italic' },
  'white-space': { nowrap: 'whitespace-nowrap', normal: 'whitespace-normal', pre: 'whitespace-pre', 'pre-wrap': 'whitespace-pre-wrap', 'pre-line': 'whitespace-pre-line', 'break-spaces': 'whitespace-break-spaces' },
  'text-overflow': { ellipsis: 'text-ellipsis', clip: 'text-clip' },
  overflow: { auto: 'overflow-auto', hidden: 'overflow-hidden', visible: 'overflow-visible', scroll: 'overflow-scroll', clip: 'overflow-clip' },
  'overflow-x': { auto: 'overflow-x-auto', hidden: 'overflow-x-hidden', visible: 'overflow-x-visible', scroll: 'overflow-x-scroll', clip: 'overflow-x-clip' },
  'overflow-y': { auto: 'overflow-y-auto', hidden: 'overflow-y-hidden', visible: 'overflow-y-visible', scroll: 'overflow-y-scroll', clip: 'overflow-y-clip' },
  cursor: { pointer: 'cursor-pointer', default: 'cursor-default', grab: 'cursor-grab', grabbing: 'cursor-grabbing', text: 'cursor-text', move: 'cursor-move', 'not-allowed': 'cursor-not-allowed', auto: 'cursor-auto', 'col-resize': 'cursor-col-resize', 'row-resize': 'cursor-row-resize', crosshair: 'cursor-crosshair', help: 'cursor-help', wait: 'cursor-wait', 'zoom-in': 'cursor-zoom-in', 'zoom-out': 'cursor-zoom-out', 'ew-resize': 'cursor-ew-resize', 'ns-resize': 'cursor-ns-resize', 'nwse-resize': 'cursor-nwse-resize', 'nesw-resize': 'cursor-nesw-resize', none: 'cursor-none' },
  'pointer-events': { none: 'pointer-events-none', auto: 'pointer-events-auto' },
  'user-select': { none: 'select-none', text: 'select-text', all: 'select-all', auto: 'select-auto' },
  visibility: { hidden: 'invisible', visible: 'visible', collapse: 'collapse' },
  'box-sizing': { 'border-box': 'box-border', 'content-box': 'box-content' },
  'vertical-align': { middle: 'align-middle', top: 'align-top', bottom: 'align-bottom', baseline: 'align-baseline', 'text-top': 'align-text-top', 'text-bottom': 'align-text-bottom', sub: 'align-sub', super: 'align-super' },
  'word-break': { 'break-all': 'break-all', 'keep-all': 'break-keep', normal: 'break-normal' },
  'table-layout': { fixed: 'table-fixed', auto: 'table-auto' },
  'border-collapse': { collapse: 'border-collapse', separate: 'border-separate' },
  'object-fit': { contain: 'object-contain', cover: 'object-cover', fill: 'object-fill', none: 'object-none', 'scale-down': 'object-scale-down' },
  resize: { none: 'resize-none', vertical: 'resize-y', horizontal: 'resize-x', both: 'resize' },
  isolation: { isolate: 'isolate', auto: 'isolation-auto' },
  'list-style-type': { none: 'list-none', disc: 'list-disc', decimal: 'list-decimal' },
  'font-variant-numeric': { 'tabular-nums': 'tabular-nums' },
  'flex-grow': { 1: 'grow', 0: 'grow-0' },
  'flex-shrink': { 1: 'shrink', 0: 'shrink-0' },
}
const FONT_WEIGHT = { 100: 'font-thin', 200: 'font-extralight', 300: 'font-light', 400: 'font-normal', normal: 'font-normal', 500: 'font-medium', 600: 'font-semibold', 700: 'font-bold', bold: 'font-bold', 800: 'font-extrabold', 900: 'font-black' }
const SIZE_PROPS = { width: 'w', height: 'h', 'min-width': 'min-w', 'min-height': 'min-h', 'max-width': 'max-w', 'max-height': 'max-h' }
const INSET_PROPS = { top: 'top', right: 'right', bottom: 'bottom', left: 'left', inset: 'inset' }
const SIDE = { top: 't', right: 'r', bottom: 'b', left: 'l' }

/** A border shorthand (width style colour, any order) as utilities, for a side ('' — all). */
function border(side, v) {
  const s = side ? `-${SIDE[side]}` : ''
  const t = v.trim()
  if (t === 'none' || t === '0') return [`border${s}-0`]
  const out = []
  for (const part of splitTop(t)) {
    const n = spacingNum(part)
    if (n !== undefined || /^(thin|medium|thick)$/.test(part)) out.push(n === '1' ? `border${s}` : n !== undefined ? `border${s}-${n}` : `border${s}-[${part}]`)
    // (solid — the utilities' own; another on one side only — that side's (border-dashed is every side's))
    else if (/^(solid|dashed|dotted|double|none|hidden)$/.test(part)) out.push(part === 'solid' ? '' : side ? `[border-${side}-style:${part}]` : `border-${part}`)
    else {
      const c = color(part)
      out.push(c ? `border${s}-${c}` : `border${s}-[${arb(part)}]`)
    }
  }
  return out.filter(Boolean)
}

/** One declaration → its utilities (or an arbitrary property). `important` — the `!` suffix. */
export function utilitiesOf(p, value, important = false) {
  const v = value.trim()
  const out = convert(p.toLowerCase(), v)
  return important ? out.map((u) => `${u}!`) : out
}
function convert(p, v) {
  const kw = KEYWORDS[p]?.[v]
  if (kw) return [kw]
  if (p in SIZE_PROPS) {
    const pre = SIZE_PROPS[p]
    if (v === 'auto') return [`${pre}-auto`]
    if (v === '100%') return [`${pre}-full`]
    if (v === 'none' && pre.startsWith('max')) return [`${pre}-none`]
    if (/^(min|max|fit)-content$/.test(v)) return [`${pre}-${v.replace('-content', '')}`]
    return [spacing(pre, v)]
  }
  if (p in INSET_PROPS) return [spacing(INSET_PROPS[p], v, { auto: true, full: true })]
  switch (p) {
    case 'margin':
      return sides('m', v, { auto: true })
    case 'padding':
      return sides('p', v)
    case 'margin-top':
    case 'margin-right':
    case 'margin-bottom':
    case 'margin-left':
      return [spacing(`m${SIDE[p.slice(7)]}`, v, { auto: true })]
    case 'padding-top':
    case 'padding-right':
    case 'padding-bottom':
    case 'padding-left':
      return [spacing(`p${SIDE[p.slice(8)]}`, v)]
    case 'gap': {
      const [r, c = r] = splitTop(v)
      return r === c ? [spacing('gap', r)] : [spacing('gap-y', r), spacing('gap-x', c)]
    }
    case 'row-gap':
      return [spacing('gap-y', v)]
    case 'column-gap':
      return [spacing('gap-x', v)]
    case 'flex':
      // (`flex-1` is `flex: 1` — a basis of 0%; `1 1 0` — of 0px: not the same in a box of no definite size)
      if (v === '1' || v === '1 1 0%') return ['flex-1']
      if (v === 'none') return ['flex-none']
      if (v === 'auto') return ['flex-auto']
      return [prop('flex', v)]
    case 'flex-basis':
      return [spacing('basis', v, { auto: true, full: true })]
    case 'order':
      return /^-?\d+$/.test(v) ? [v.startsWith('-') ? `-order-${v.slice(1)}` : `order-${v}`] : [prop(p, v)]
    case 'z-index':
      return /^-?\d+$/.test(v) ? [v.startsWith('-') ? `-z-${v.slice(1)}` : `z-${v}`] : v === 'auto' ? ['z-auto'] : [prop(p, v)]
    case 'opacity': {
      const n = Number(v)
      return Number.isFinite(n) && Number.isInteger(n * 100) ? [`opacity-${Math.round(n * 100)}`] : [prop(p, v)]
    }
    case 'font-size':
      return [`text-[${arb(v)}]`]
    case 'font-weight':
      return [FONT_WEIGHT[v] ?? `font-[${arb(v)}]`]
    case 'font-family': {
      const t = tokenOf(v, FONT_TOKENS)
      return [t ? `font-${t}` : prop(p, v)]
    }
    case 'line-height':
      return [`leading-[${arb(v)}]`]
    case 'letter-spacing':
      return [`tracking-[${arb(v)}]`]
    case 'color': {
      const c = color(v)
      return [c ? `text-${c}` : `text-[color:${arb(v)}]`]
    }
    case 'background-color': {
      const c = color(v)
      return [c ? `bg-${c}` : `bg-[color:${arb(v)}]`]
    }
    case 'background': {
      // a plain colour — bg-…; anything else (an image, a gradient, a shorthand) — as written
      const c = color(v)
      if (c) return [`bg-${c}`]
      if (splitTop(v).length === 1 && /^(#|rgb|hsl|oklch|color-mix)/.test(v)) return [`bg-[color:${arb(v)}]`]
      return [prop(p, v)]
    }
    case 'border':
      return border('', v)
    case 'border-top':
    case 'border-right':
    case 'border-bottom':
    case 'border-left':
      return border(p.slice(7), v)
    case 'border-width': {
      const n = spacingNum(v)
      return [n === '1' ? 'border' : n !== undefined ? `border-${n}` : prop(p, v)]
    }
    case 'border-style':
      return [/\s/.test(v) ? prop(p, v) : v === 'solid' ? 'border-solid' : `border-${v}`]
    case 'border-color': {
      const c = color(v)
      return [c ? `border-${c}` : `border-[color:${arb(v)}]`]
    }
    case 'border-top-color':
    case 'border-right-color':
    case 'border-bottom-color':
    case 'border-left-color': {
      const c = color(v)
      const s = SIDE[p.split('-')[1]]
      return [c ? `border-${s}-${c}` : `border-${s}-[color:${arb(v)}]`]
    }
    case 'border-radius': {
      const t = tokenOf(v, RADIUS_TOKENS)
      if (t) return [`rounded-${t}`]
      if (v === '0') return ['rounded-none']
      return [`rounded-[${arb(v)}]`]
    }
    case 'border-top-left-radius':
    case 'border-top-right-radius':
    case 'border-bottom-left-radius':
    case 'border-bottom-right-radius': {
      const corner = { 'border-top-left-radius': 'tl', 'border-top-right-radius': 'tr', 'border-bottom-left-radius': 'bl', 'border-bottom-right-radius': 'br' }[p]
      const t = tokenOf(v, RADIUS_TOKENS)
      return [t ? `rounded-${corner}-${t}` : `rounded-${corner}-[${arb(v)}]`]
    }
    case 'box-shadow':
      if (v === 'none') return ['shadow-none']
      if (tokenOf(v, { '--shadow': 'pop' })) return ['shadow-pop']
      return [prop(p, v)]
    case 'outline':
      if (v === 'none' || v === '0') return ['outline-none']
      return [prop(p, v)]
    case 'grid-template-columns':
      return [`grid-cols-[${arb(v)}]`]
    case 'grid-template-rows':
      return [`grid-rows-[${arb(v)}]`]
    case 'text-decoration':
    case 'text-decoration-line':
      if (v === 'none') return ['no-underline']
      if (v === 'underline') return ['underline']
      if (v === 'line-through') return ['line-through']
      return [prop(p, v)]
    case 'content':
      return [`content-[${arb(v)}]`]
    case 'container-type':
      return v === 'inline-size' ? ['@container'] : [prop(p, v)]
  }
  return [prop(p, v)]
}

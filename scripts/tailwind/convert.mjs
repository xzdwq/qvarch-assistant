// A Vue component's <style> moved into Tailwind utilities on its template's elements.
// Usage: node scripts/tailwind/convert.mjs <file.vue> [--dry]
//
// Each CSS rule is matched to the template's elements: its last compound — the elements it styles (a class a :class
// binding may add becomes a state variant: [&.on]:); the compounds before it — their ancestors, resolved by the
// template's tree (static ones need no variant; one with a state — the ancestor becomes a `group/<name>`, the element
// gets `group-hover/<name>:` / `group-[.on]/<name>:`; one outside the template — an arbitrary variant [.a_&]:);
// :deep(…) — a descendant variant on the anchor ([&_.x]:). The declarations — utilities (declarations.mjs). For each
// element and each longhand property the cascade is played out (specificity, then order): what never wins is dropped;
// two state rules that may meet are reported (Tailwind orders them its own way). What cannot move stays in <style>.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { parse as parseSfc } from '@vue/compiler-sfc'
import MagicString from 'magic-string'
import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'
import { arb, utilitiesOf } from './declarations.mjs'
import { attachChildRoots, elementsOf, rootsOf, writeClasses } from './template.mjs'

/**
 * The utilities' prefix (tailwind.css: prefix(tw)): a utility never meets a class an element carries for its own sake
 * or one a library's markup has (`hidden`, `invisible`, `table`…), and reads apart from them.
 */
const TW = 'tw:'

// ---------- longhands (for the cascade) ----------
const SIDES = ['top', 'right', 'bottom', 'left']
const LONGHANDS = {
  margin: SIDES.map((s) => `margin-${s}`),
  padding: SIDES.map((s) => `padding-${s}`),
  inset: SIDES,
  gap: ['row-gap', 'column-gap'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  overflow: ['overflow-x', 'overflow-y'],
  'place-items': ['align-items', 'justify-items'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius'],
  'border-width': SIDES.map((s) => `border-${s}-width`),
  'border-style': SIDES.map((s) => `border-${s}-style`),
  'border-color': SIDES.map((s) => `border-${s}-color`),
  border: SIDES.flatMap((s) => [`border-${s}-width`, `border-${s}-style`, `border-${s}-color`]),
  ...Object.fromEntries(SIDES.map((s) => [`border-${s}`, [`border-${s}-width`, `border-${s}-style`, `border-${s}-color`]])),
  background: ['background-color', 'background-image', 'background-position', 'background-size', 'background-repeat', 'background-attachment', 'background-origin', 'background-clip'],
  outline: ['outline-color', 'outline-style', 'outline-width'],
  'text-decoration': ['text-decoration-line', 'text-decoration-color', 'text-decoration-style', 'text-decoration-thickness'],
  font: ['font-style', 'font-variant', 'font-weight', 'font-stretch', 'font-size', 'line-height', 'font-family'],
  transition: ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay'],
  animation: ['animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay', 'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state'],
  'grid-column': ['grid-column-start', 'grid-column-end'],
  'grid-row': ['grid-row-start', 'grid-row-end'],
  'list-style': ['list-style-type', 'list-style-position', 'list-style-image'],
}
const longhandsOf = (p) => LONGHANDS[p] ?? [p]

// ---------- variants ----------
const PSEUDO_VARIANT = {
  ':hover': 'hover', ':focus': 'focus', ':focus-visible': 'focus-visible', ':focus-within': 'focus-within', ':active': 'active', ':disabled': 'disabled',
  ':enabled': 'enabled', ':checked': 'checked', ':first-child': 'first', ':last-child': 'last', ':only-child': 'only', ':empty': 'empty',
  ':placeholder-shown': 'placeholder-shown', ':first-of-type': 'first-of-type', ':last-of-type': 'last-of-type', ':visited': 'visited', ':target': 'target',
  ':read-only': 'read-only', ':required': 'required', ':invalid': 'invalid', ':indeterminate': 'indeterminate', ':open': 'open',
}
const PSEUDO_ELEMENT_VARIANT = { '::before': 'before', '::after': 'after', '::placeholder': 'placeholder', '::selection': 'selection', '::marker': 'marker', '::file-selector-button': 'file', ':before': 'before', ':after': 'after' }
/** A pseudo-class of the styled element as a variant. */
function pseudoVariant(p) {
  const s = String(p).trim()
  if (s === ':not(:disabled)') return 'enabled'
  return PSEUDO_VARIANT[s] ?? `[&${arb(s)}]`
}
/** A pseudo-class of an ancestor as a group variant. */
function groupPseudo(p, g) {
  const s = String(p).trim()
  const v = PSEUDO_VARIANT[s]
  return v ? `group-${v}/${g}` : `group-[${arb(s)}]/${g}`
}

// ---------- selectors ----------
/** A compound selector's parts. */
function compoundOf(nodes) {
  const c = { tag: undefined, classes: [], pseudos: [], pseudoElement: undefined, attrs: [], deep: undefined, other: [], text: nodes.map(String).join('').trim() }
  for (const n of nodes) {
    if (n.type === 'tag') c.tag = n.value
    else if (n.type === 'class') c.classes.push(n.value)
    else if (n.type === 'attribute') c.attrs.push(String(n).trim())
    else if (n.type === 'pseudo') {
      const v = n.value.toLowerCase()
      if (v === ':deep' || v === '::v-deep') c.deep = n.nodes.map(String).join(',').trim()
      else if (v in PSEUDO_ELEMENT_VARIANT || v.startsWith('::')) c.pseudoElement = String(n).trim()
      else c.pseudos.push(String(n).trim())
    } else if (n.type === 'universal') c.tag = c.tag ?? '*'
    else c.other.push(String(n))
  }
  return c
}
/** A selector as compounds and the combinators between them. */
function chainOf(sel) {
  const parts = [[]]
  const combs = []
  for (const n of sel.nodes) {
    if (n.type === 'combinator') {
      combs.push(n.value.trim() || ' ')
      parts.push([])
    } else if (n.type !== 'comment') parts[parts.length - 1].push(n)
  }
  return { compounds: parts.filter((p) => p.length).map(compoundOf), combs }
}
/** Specificity as a comparable number. */
function specificityOf(sel) {
  let a = 0
  let b = 0
  let c = 0
  sel.walk((n) => {
    if (n.type === 'id') a++
    else if (n.type === 'class' || n.type === 'attribute') b++
    else if (n.type === 'pseudo') {
      const v = n.value.toLowerCase()
      if (v === ':deep' || v === '::v-deep' || v === ':not' || v === ':is' || v === ':where') return
      if (v.startsWith('::') || v === ':before' || v === ':after') c++
      else b++
    } else if (n.type === 'tag') c++
  })
  return a * 10000 + b * 100 + c
}

// ---------- matching ----------
const tagOk = (el, tag) => !tag || tag === '*' || el.pageTags.includes(tag)
/**
 * How an element matches a compound: undefined — not; else what must hold besides — { states: the classes that come
 * and go ([&.on]), attrs: the attribute selectors its written attributes do not settle ([&[type='text']]) }.
 */
function matchCompound(el, c) {
  if (!tagOk(el, c.tag) || c.other.length) return undefined
  const states = []
  for (const cls of c.classes) {
    const h = el.has(cls)
    if (!h) return undefined
    if (h === 'dynamic') states.push(cls)
  }
  const attrs = []
  for (const a of c.attrs) {
    const m = el.meetsAttr(a)
    if (m === false) return undefined
    if (m === 'dynamic') attrs.push(a)
  }
  return { states, attrs }
}
let groupNo = 0
/** The group name of an ancestor (its first static class, or a number). */
function groupOf(el) {
  if (!el.group) {
    const base = [...el.static][0]?.replace(/[^\w-]/g, '') || `g${++groupNo}`
    el.group = base
    el.add.unshift(`${TW}group/${base}`)
  }
  return el.group
}
/**
 * The variants under which a rule's ancestor compounds hold for an element (walking up its template tree); undefined —
 * they never do. An ancestor outside the template — an arbitrary variant on the element.
 */
function ancestorVariants(el, compounds, combs, i) {
  if (i < 0) return []
  const c = compounds[i]
  const comb = combs[i]
  const text = c.text
  const asVariant = (target) => {
    const m = matchCompound(target, c)
    if (!m) return undefined
    const vs = []
    if (m.states.length || c.pseudos.length || m.attrs.length) {
      const g = groupOf(target)
      for (const s of m.states) vs.push(`group-[.${s}]/${g}`)
      for (const p of c.pseudos) vs.push(groupPseudo(p, g))
      for (const a of m.attrs) vs.push(`group-[${arb(a)}]/${g}`)
    }
    const rest = ancestorVariants(target, compounds, combs, i - 1)
    return rest && [...rest, ...vs]
  }
  if (comb === '>') {
    const p = el.parentEl
    if (p && !p.isRoot) return asVariant(p)
    // a root here, but the parent the rule wants is in the template: not for it
    if (el.all.some((x) => matchCompound(x, c))) return undefined
    // the parent is outside the template (the component's user): an arbitrary variant, the rest of the chain with it
    return [`[${chainText(compounds, combs, i)}>&]`]
  }
  // a sibling: the whole chain before it as one arbitrary variant (`.seg button + button` — [.seg_button+&])
  if (comb === '+' || comb === '~') return [`[${chainText(compounds, combs, i)}${comb}&]`]
  for (let p = el.parentEl; p && !p.isRoot; p = p.parentEl) {
    const r = asVariant(p)
    if (r) return r
  }
  // the ancestor is in the template, but not above this element: the rule is not for it
  if (el.all.some((x) => matchCompound(x, c))) return undefined
  // not in the template: the ancestors are the component's users
  return [`[${chainText(compounds, combs, i)}_&]`]
}
/** Compounds 0…i with their combinators, as an arbitrary variant's text (a descendant — `_`). */
function chainText(compounds, combs, i) {
  return compounds
    .slice(0, i + 1)
    .map((x, k) => (k ? `${combs[k - 1] === ' ' ? '_' : combs[k - 1]}${arb(x.text)}` : arb(x.text)))
    .join('')
}

// ---------- the conversion ----------
/**
 * `childDecls` — each component's own declarations on its root element (absolute path → [{ variants, weight, spec,
 * longhands }], from a dry run over all of them: report.rootDecls) — so a parent's rule on that root is weighed against them.
 */
export function convertFile(file, { dry = false, childDecls } = {}) {
  const src = readFileSync(file, 'utf8')
  const { descriptor, errors } = parseSfc(src, { filename: file })
  if (errors.length) throw new Error(`${file}: ${errors[0].message}`)
  if (!descriptor.template?.ast) return { file, skipped: 'no template' }
  const { all, root } = elementsOf(descriptor.template.ast)
  attachChildRoots(all, childResolver(file, descriptor))
  // an element whose :class is opaque (`m.cls`) may carry any class the script names in a string ('lunch') that the
  // styles use: each — a state it may be in
  const script = `${descriptor.script?.content ?? ''}\n${descriptor.scriptSetup?.content ?? ''}`
  const named = new Set([...script.matchAll(/(['"`])([\w -]+)\1/g)].flatMap((m) => m[2].split(/\s+/)))
  const styled = new Set(descriptor.styles.flatMap((s) => [...s.content.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1])))
  for (const el of all) if (el.opaqueClass) for (const c of named) if (styled.has(c) && !el.static.has(c)) el.dynamic.add(c)
  // the element a parent's classes land on (the one root, or the one given $attrs)
  const ownAttrs = /inheritAttrs\s*:\s*false/.test(`${descriptor.script?.content ?? ''}${descriptor.scriptSetup?.content ?? ''}`)
  const ownRoots = (ownAttrs ? all.filter((e) => e.spreadExp === '$attrs') : rootsOf(root)) ?? []
  const ms = new MagicString(src)
  const report = { file, rules: 0, moved: 0, foreign: 0, kept: [], orderSensitive: [], unmatched: [], childRoots: [], rootDecls: [] }
  /** Every declaration for an element: { el, variants, longhands, utilities, spec, order }. */
  const decls = []
  let order = 0
  const component = basename(file, '.vue')
  for (const style of descriptor.styles) {
    const ast = postcss.parse(style.content)
    /** The rules moved into utilities (taken out of the stylesheet afterwards: what remains stays, wrappers and all). */
    const moved = []
    // the component's animations: into the app's animations file under the component's name, the uses renamed
    const frames = new Map()
    ast.walkAtRules(/^keyframes$/i, (at) => {
      const name = `${component}-${at.params.trim()}`
      frames.set(at.params.trim(), name)
      if (!dry) addKeyframes(name, at)
      at.remove()
    })
    if (frames.size)
      ast.walkDecls(/^animation(-name)?$/i, (d) => {
        d.value = d.value.replace(/[\w-]+/g, (w) => frames.get(w) ?? w)
      })
    const visit = (container, media) => {
      for (const node of container.nodes ?? []) {
        if (node.type === 'atrule') {
          const name = node.name.toLowerCase()
          if (name === 'media' || name === 'container') {
            const v = mediaVariant(name, node.params)
            if (v) visit(node, [...media, v])
          }
          continue
        }
        if (node.type !== 'rule') continue
        report.rules++
        let all_ok = true
        const parsed = selectorParser().astSync(node.selector)
        const results = []
        for (const sel of parsed.nodes) {
          const { compounds, combs } = chainOf(sel)
          const spec = specificityOf(sel)
          const targetC = compounds[compounds.length - 1]
          // what the component does not render itself (:deep — v-html, an editor, a child's insides) stays CSS: as
          // utilities it would be a heap of descendant variants on one element; a global rule — only when its outer
          // class is this component's alone (else it may style someone else's elements)
          const foreign = compounds.some((c) => c.deep !== undefined) || (!style.scoped && !compounds[0].classes.some((c) => ownClass(c, file)))
          if (!targetC || targetC.other.length || foreign) {
            all_ok = false
            if (foreign) report.foreign++
            continue
          }
          const target = targetC
          const candidates = all.filter((el) => matchCompound(el, target))
          if (!candidates.length) {
            all_ok = false
            report.unmatched.push(sel.toString().trim())
            continue
          }
          const found = results.length
          for (const el of candidates) {
            const m = matchCompound(el, target)
            const anc = ancestorVariants(el, compounds, combs, compounds.length - 2)
            if (!anc) continue
            const variants = [...media, ...anc, ...m.states.map((s) => `[&.${s}]`), ...m.attrs.map((a) => `[&${arb(a)}]`), ...target.pseudos.map(pseudoVariant)]
            if (target.pseudoElement) variants.push(PSEUDO_ELEMENT_VARIANT[target.pseudoElement] ?? `[&${arb(target.pseudoElement)}]`)
            results.push({ el, variants, spec })
            if (el.childRoots) report.childRoots.push(`${sel.toString().trim()} → <${el.tag}>`)
          }
          // its elements are there, but none where the selector reaches them (the class is added elsewhere — by code)
          if (results.length === found) {
            all_ok = false
            report.unmatched.push(sel.toString().trim())
          }
        }
        if (!all_ok) continue
        node.walkDecls((d) => {
          const utilities = utilitiesOf(d.prop, d.value, d.important)
          for (const r of results) decls.push({ ...r, prop: d.prop.toLowerCase(), value: d.value, important: d.important, longhands: longhandsOf(d.prop.toLowerCase()), utilities, order: order++ })
        })
        moved.push(node)
        report.moved++
      }
    }
    visit(ast, [])
    for (const n of moved) n.remove()
    // a wrapper left empty goes too (innermost first)
    let emptied = true
    while (emptied) {
      emptied = false
      ast.walkAtRules((at) => {
        if (at.nodes && !at.nodes.some((n) => n.type !== 'comment')) {
          at.remove()
          emptied = true
        }
      })
    }
    ast.walkRules((r) => void report.kept.push(r.parent?.type === 'atrule' ? `@${r.parent.name} ${r.parent.params} ${r.selector}` : r.selector))
    // the style block: what stays moves into a stylesheet beside the component (<Component>.css, a global block —
    // <Component>.global.css), the block only points at it; nothing stays — the block goes
    const rest = ast.nodes.some((n) => n.type !== 'comment') ? ast.toString().trim() : ''
    const start = style.loc.start.offset
    const end = style.loc.end.offset
    const open = src.lastIndexOf('<style', start)
    const close = src.indexOf('</style>', end) + '</style>'.length
    if (rest.trim()) {
      const cssName = `${component}${style.scoped ? '' : '.global'}.css`
      if (!dry) writeFileSync(join(dirname(file), cssName), `/* ${component}: what its template cannot carry as utilities (${style.scoped ? 'scoped' : 'global'}). */\n\n${rest}\n`)
      ms.overwrite(open, close, `<style${style.scoped ? ' scoped' : ''} src="./${cssName}"></style>`)
    } else {
      // the whole <style …>…</style> tag removed (and the blank line before it)
      let from = open
      while (from > 0 && /\s/.test(src[from - 1])) from--
      ms.remove(from, close)
    }
  }
  // ---------- the cascade, per element and box (the element itself, its ::before, ::after…) / longhand ----------
  const groups = new Map()
  for (const d of decls) {
    d.box = boxOf(d.variants)
    const key = `${all.indexOf(d.el)} ${d.box}`
    if (!groups.has(key)) groups.set(key, { el: d.el, box: d.box, list: [] })
    groups.get(key).list.push(d)
  }
  // !important first, then specificity, then order
  const rank = (d) => (d.important ? 1e12 : 0) + d.spec * 1e6 + d.order
  for (const { el, box, list } of groups.values()) {
    // base.css's rules on the element take part as they met the scoped styles (base.css styles elements, not their
    // pseudo-elements)
    if (!box) list.push(...baseRivalsOf(el))
    const alive = new Set()
    for (const d of list) {
      // it wins a longhand when nothing that applies whenever it does (a subset of its variants) beats it there
      const wins = d.longhands.some((lh) => !list.some((o) => o !== d && o.longhands.includes(lh) && rank(o) > rank(d) && o.variants.every((v) => d.variants.includes(v))))
      if (wins) alive.add(d)
    }
    for (const d of list) {
      if (!alive.has(d)) continue
      // a shorthand written as an arbitrary property ([font:inherit]) goes after every named utility in Tailwind's
      // output — a longhand that beats it in CSS (font-size after `font: inherit`) would lose: a global keyword is laid
      // out into its longhands but the beaten ones (cleaner); any other value — the weighing below makes the longhand
      // heavier
      const beaten = d.longhands.length > 1 ? d.longhands.filter((lh) => list.some((o) => o !== d && alive.has(o) && o.longhands.length === 1 && o.longhands[0] === lh && rank(o) > rank(d) && d.variants.every((v) => o.variants.includes(v)))) : []
      const keyword = /^(inherit|initial|unset|revert)$/.test(d.value.trim()) ? d.value.trim() : undefined
      if (beaten.length && keyword && d.utilities.some((u) => u.startsWith('['))) d.utilities = d.longhands.filter((lh) => !beaten.includes(lh)).map((lh) => `[${lh}:${keyword}]`)
      d.final = [...d.variants]
      d.bump = d.bump ?? 0
      // two rules under different conditions that may meet (neither always holds when the other does): Tailwind orders
      // them its own way, so the one that loses in CSS is kept off while the winner's one extra condition holds
      // (`not-<it>:`); a winner of more is made heavier instead (below)
      for (const o of list) {
        if (o === d || !alive.has(o) || rank(o) < rank(d)) continue
        const shared = d.longhands.some((lh) => o.longhands.includes(lh))
        const nested = d.variants.every((v) => o.variants.includes(v)) || o.variants.every((v) => d.variants.includes(v))
        if (!shared || nested) continue
        const extra = o.variants.filter((v) => !d.variants.includes(v))
        if (extra.length === 1 && !d.final.includes(`not-${extra[0]}`)) d.final.push(`not-${extra[0]}`)
      }
    }
    // the element is another component's root: that component's own rules meet these on it (both scoped — the same
    // bonus; a tie goes to the parent, its style comes later)
    const own = el.childPath ? childDecls?.get(el.childPath) : undefined
    for (const d of own ? list : []) {
      if (!alive.has(d) || d.rival) continue
      for (const c of own) {
        if (c.box !== box || !d.longhands.some((lh) => c.longhands.includes(lh))) continue
        const weight = weightOf(d.final) + d.bump
        if (d.spec >= c.spec) d.bump += Math.max(0, c.weight - weight + 1)
        else if (c.weight <= weight) {
          const extra = c.variants.filter((v) => !d.final.includes(v))
          const sel = extra.map(selectorOfVariant)
          if (extra.length === 1) d.final.push(`not-${extra[0]}`)
          else if (sel.every(Boolean)) d.final.push(`not-[&${arb(sel.join(''))}]`)
          else report.orderSensitive.push(`<${el.tag}> root: ${d.prop} [${d.final.join(':')}] / its own [${c.variants.join(':')}]`)
        }
      }
    }
    const write = (variants, bump, utilities) => {
      const all = bump > 0 ? [`[${'&'.repeat(bump + 1)}]`, ...variants] : variants
      const prefix = `${TW}${all.length ? `${all.join(':')}:` : ''}`
      for (const u of utilities) el.add.push(prefix + u)
    }
    const beats = (o, d) => o !== d && rank(o) > rank(d) && d.longhands.some((lh) => o.longhands.includes(lh))
    const together = (a, b) => !a.final.some((x) => b.final.some((y) => contradicts(x, y)))
    // a base rule is written only where it beats one of the component's declarations (elsewhere base.css, a layer
    // below the utilities, does it itself)
    const live = list.filter((d) => alive.has(d) && (!d.rival || list.some((x) => !x.rival && alive.has(x) && beats(d, x) && together(d, x))))
    // what beats a declaration in CSS and may hold with it (no condition of one denies the other's) must outweigh it
    // here — Tailwind's order between two as heavy is its own: the winner is made heavier ([&&]: its class doubled)
    const weight = (x) => weightOf(x.final) + x.bump
    for (let changed = true, round = 0; changed && round < 50; round++) {
      changed = false
      for (const d of live)
        for (const o of live)
          if (beats(o, d) && together(o, d) && weight(o) <= weight(d)) {
            o.bump += weight(d) - weight(o) + 1
            changed = true
          }
    }
    for (const d of live) write(d.final, d.bump, d.utilities)
    for (const d of live) if (ownRoots.includes(el) && !d.rival) report.rootDecls.push({ box, variants: d.final, weight: weightOf(d.final) + d.bump, spec: d.spec, longhands: d.longhands })
  }
  for (const el of all) if (el.noClasses && el.add.length) report.orderSensitive.push(`<${el.tag}> takes no classes (several roots): ${el.add.length} utilities lost`)
  writeClasses(ms, all)
  if (!dry) writeFileSync(file, ms.toString())
  return report
}

// ---------- the app's base styles (base.css) as the utilities' rivals ----------
// base.css lies in a cascade layer below the utilities: a utility always outweighs it. A component's scoped rule met
// it with its class + the scope attribute, and lost now and then (a button of one class lit up on hover by
// `button:hover:not(:disabled)`). Each base rule on an element joins its cascade as it was (its specificity less the
// attribute; a tie — the component's); where it beats a component's declaration it is written as utilities —
// `hover:enabled:bg-hover`: the button lights up on hover, as it did.
const BASE_CSS = new URL('../../src/renderer/src/lib/base.css', import.meta.url)
let baseRules
/** base.css's one-compound rules on elements: { tag, classes, pseudos, spec, text, decls: [{ prop, longhands, utilities }] }. */
function baseRulesOf() {
  if (baseRules) return baseRules
  baseRules = []
  postcss.parse(readFileSync(BASE_CSS, 'utf8')).walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && !/^layer$/i.test(rule.parent.name)) return
    const decls = []
    rule.walkDecls((d) => decls.push({ prop: d.prop.toLowerCase(), longhands: longhandsOf(d.prop.toLowerCase()), utilities: utilitiesOf(d.prop, d.value, d.important) }))
    for (const sel of selectorParser().astSync(rule.selector).nodes) {
      const { compounds } = chainOf(sel)
      const c = compounds[0]
      if (compounds.length !== 1 || c.pseudoElement || c.other.length || c.attrs.length || c.deep !== undefined) continue
      if ((!c.tag || c.tag === '*') && !c.classes.length) continue
      baseRules.push({ tag: c.tag, classes: c.classes, pseudos: c.pseudos, spec: specificityOf(sel), text: sel.toString().trim(), decls })
    }
  })
  return baseRules
}
/** The base rules' declarations on an element, as declarations of its cascade (`rival`). */
function baseRivalsOf(el) {
  let order = 0
  return baseRulesOf()
    .filter((b) => tagOk(el, b.tag) && b.classes.every((c) => el.has(c)))
    .flatMap((b) =>
      b.decls.map((d) => ({
        el,
        rival: true,
        prop: `${d.prop} (base ${b.text})`,
        value: '',
        // its condition on this element: its pseudo-classes, its classes that come and go
        variants: [...b.classes.filter((c) => el.has(c) === 'dynamic').map((c) => `[&.${c}]`), ...b.pseudos.map(pseudoVariant)],
        spec: b.spec - 100,
        // (in base.css's order, before any component's)
        order: -1e5 + order++,
        longhands: d.longhands,
        utilities: d.utilities,
        box: '',
      })),
    )
}
/** A variant on the element itself as selector text (`hover` — `:hover`, `[&.on]` — `.on`, `not-[&.on]` — `:not(.on)`); undefined — not such. */
function selectorOfVariant(v) {
  const pseudo = Object.entries(PSEUDO_VARIANT).find(([, name]) => name === v)?.[0]
  if (pseudo) return pseudo
  if (v === 'enabled') return ':enabled'
  const own = /^\[&([^\]]+)\]$/.exec(v)
  if (own && !own[1].includes('_')) return own[1]
  const not = /^not-(.+)$/.exec(v)
  const inner = not && selectorOfVariant(not[1])
  return inner ? `:not(${inner})` : undefined
}
/** The box a declaration styles: '' — the element, else its pseudo-element's variant (after, before, placeholder…). */
function boxOf(variants) {
  return variants.find((v) => /^(?:before|after|placeholder|selection|marker|file)$/.test(v) || v.startsWith('[&::')) ?? ''
}
/** Variants that never hold together. */
const contradicts = (a, b) => a === `not-${b}` || b === `not-${a}` || (a === 'enabled' && b === 'disabled') || (a === 'disabled' && b === 'enabled')
/**
 * What a chain of variants adds to a utility's specificity, in classes: a media / container query, a pseudo-element —
 * nothing; any other condition (a pseudo-class, a state class, an ancestor, a negation) — one.
 */
function weightOf(variants) {
  return variants.filter((v) => !/^(?:min-|max-|@|motion-|\[@media|before$|after$|placeholder$|selection$|marker$|file$)/.test(v)).length
}

/**
 * The template of a component the file imports (by its tag), through the app's aliases (resolved against the `src`
 * the file lives in — a snapshot of the sources works too).
 */
function childResolver(file, descriptor) {
  const abs = resolve(file)
  const srcRoot = abs.slice(0, abs.search(/[\\/]src[\\/]/) + 4)
  const ALIASES = { '@renderer/': join(srcRoot, 'renderer/src/'), '@nb/': join(srcRoot, 'notebook/'), '@shared/': join(srcRoot, 'shared/') }
  const script = `${descriptor.script?.content ?? ''}\n${descriptor.scriptSetup?.content ?? ''}`
  const imports = new Map([...script.matchAll(/import\s+(\w+)\s+from\s+['"]([^'"]+\.vue)['"]/g)].map((m) => [m[1], m[2]]))
  return (tag) => {
    const spec = imports.get(tag)
    if (!spec) return undefined
    const alias = Object.keys(ALIASES).find((a) => spec.startsWith(a))
    const path = alias ? join(ALIASES[alias], spec.slice(alias.length)) : resolve(dirname(abs), spec)
    if (!existsSync(path)) return undefined
    const { descriptor: child } = parseSfc(readFileSync(path, 'utf8'), { filename: path })
    // inheritAttrs: false — it hands its attributes (and classes) on itself
    const ownAttrs = /inheritAttrs\s*:\s*false/.test(`${child.script?.content ?? ''}${child.scriptSetup?.content ?? ''}`)
    return { ast: child.template?.ast, path, ownAttrs }
  }
}

/** The app's sources but one (their text, read once) — to tell a class only one component uses. */
let sourceTexts
function ownClass(cls, file) {
  if (!sourceTexts) {
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : /\.(vue|ts|css)$/.test(e.name) ? [join(d, e.name)] : []))
    sourceTexts = walk(SRC).map((f) => ({ f: resolve(f), text: readFileSync(f, 'utf8') }))
  }
  const re = new RegExp(`(^|[^\\w-])${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w-])`)
  const me = resolve(file)
  return !sourceTexts.some((s) => s.f !== me && re.test(s.text))
}
const SRC = new URL('../../src', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')

/** The app's animations (the components' @keyframes, each under its component's name). */
const ANIMATIONS = new URL('../../src/renderer/src/styles/animations.css', import.meta.url)
function addKeyframes(name, at) {
  let text = existsSync(ANIMATIONS) ? readFileSync(ANIMATIONS, 'utf8') : '/* The components\' animations (moved from their styles: <Component>-<name>). */\n'
  if (text.includes(`@keyframes ${name} `) || text.includes(`@keyframes ${name}{`)) return
  const body = at.nodes.map(String).join('\n  ')
  text += `\n@keyframes ${name} {\n  ${body}\n}\n`
  writeFileSync(ANIMATIONS, text)
}

/** A media / container query as a variant (min-width / max-width; anything else — an arbitrary one). */
function mediaVariant(kind, params) {
  const p = params.trim()
  if (kind === 'container') {
    const m = /^(?:([\w-]+)\s+)?\(\s*(min|max)-width\s*:\s*([\d.]+px)\s*\)$/.exec(p)
    if (m) return `@${m[2]}-[${m[3]}]${m[1] ? `/${m[1]}` : ''}`
    return undefined
  }
  const m = /^\(\s*(min|max)-width\s*:\s*([\d.]+px)\s*\)$/.exec(p)
  if (m) return `${m[1]}-[${m[2]}]`
  if (/^\(prefers-reduced-motion:\s*reduce\)$/.test(p)) return 'motion-reduce'
  return `[@media${arb(p)}]`
}

if (process.argv[1]?.endsWith('convert.mjs')) {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const dry = process.argv.includes('--dry')
  for (const f of files) {
    const r = convertFile(f, { dry })
    console.log(JSON.stringify(r, null, 2))
  }
}

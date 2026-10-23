// The template side of the converter: the elements of a Vue template with their classes (static ones, and the ones a
// :class binding may add — conditional), their place in the tree; utilities written into their class attributes.

const ELEMENT = 1
const ATTRIBUTE = 6
const DIRECTIVE = 7

/** The class names a :class expression may add: object keys, string literals, template-literal prefixes. */
export function dynamicClasses(exp) {
  const names = new Set()
  const prefixes = new Set()
  // object keys: { on: x, 'is-y': z } and shorthands: { bad, on }
  for (const m of exp.matchAll(/(?:^|[{,])\s*(['"]?)([A-Za-z_][\w-]*)\1\s*(?=[:,}])/g)) names.add(m[2])
  // string literals ('a b', "c")
  for (const m of exp.matchAll(/(['"])((?:(?!\1).)*)\1/g)) for (const c of m[2].split(/\s+/)) if (/^[A-Za-z_][\w-]*$/.test(c)) names.add(c)
  // template literals: `k-${x}` — a prefix; `a ${b}` — its fixed words
  for (const m of exp.matchAll(/`([^`]*)`/g)) {
    for (const part of m[1].split(/\$\{[^}]*\}/)) for (const c of part.split(/\s+/)) if (/^[A-Za-z_][\w-]*$/.test(c)) names.add(c)
    for (const p of m[1].matchAll(/([A-Za-z_][\w-]*)\$\{/g)) prefixes.add(p[1])
  }
  return { names, prefixes }
}

/**
 * A :class expression whose classes cannot be read from it: a name, a call (`m.cls`, `kindClass(x)`), or an array
 * holding one — its classes come from the script.
 */
export function isOpaque(exp) {
  const t = exp.trim()
  if (t.startsWith('[')) return splitTopLevel(t.slice(1, -1)).some((part) => /^[\w$.]+(?:\(.*\))?$/s.test(part.trim()))
  return !/['"`{]/.test(t)
}
/** A list's items, split at its top-level commas. */
function splitTopLevel(s) {
  const out = ['']
  let depth = 0
  let quote
  for (const ch of s) {
    if (quote) quote = ch === quote ? undefined : quote
    else if (`'"\``.includes(ch)) quote = ch
    else if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth--
    else if (ch === ',' && depth === 0) {
      out.push('')
      continue
    }
    out[out.length - 1] += ch
  }
  return out
}

/** A template element: its tag, classes, parent, children (wrappers like <template> are transparent). */
export class El {
  constructor(node, parent, index) {
    this.node = node
    this.tag = node.tag
    this.parent = parent
    this.index = index
    this.children = []
    this.static = new Set()
    this.dynamic = new Set()
    this.prefixes = new Set()
    this.classAttr = undefined
    /** Other attributes: written ones (name → value), bound ones (:name), and whether an object is spread in (v-bind="…"). */
    this.attrs = new Map()
    this.bound = new Set()
    this.spread = false
    for (const p of node.props) {
      if (p.type === ATTRIBUTE && p.name === 'class') {
        this.classAttr = p
        for (const c of (p.value?.content ?? '').split(/\s+/)) if (c) this.static.add(c)
      } else if (p.type === DIRECTIVE && p.name === 'bind' && p.arg?.content === 'class' && p.exp) {
        const d = dynamicClasses(p.exp.content)
        for (const c of d.names) if (!this.static.has(c)) this.dynamic.add(c)
        for (const c of d.prefixes) this.prefixes.add(c)
        this.opaqueClass = isOpaque(p.exp.content)
      } else if (p.type === ATTRIBUTE) this.attrs.set(p.name, p.value?.content ?? '')
      else if (p.type === DIRECTIVE && p.name === 'bind') {
        if (p.arg?.content) this.bound.add(p.arg.content)
        else {
          this.spread = true
          this.spreadExp = p.exp?.content?.trim()
        }
      } else if (p.type === DIRECTIVE && p.name === 'model') this.bound.add('value')
    }
    /** Utilities to add (in order). */
    this.add = []
  }
  /** A Vue component (its root gets the classes through) rather than an HTML element. */
  get isComponent() {
    return /^[A-Z]/.test(this.tag) || (this.tag.includes('-') && !/^(?:font-face|annotation-xml)$/.test(this.tag))
  }
  /** How the element has this class: 'static', 'dynamic' (a :class may add it), or undefined. */
  has(c) {
    const roots = this.childRoots ?? []
    // (a class on only some of a component's possible roots comes and goes with them)
    if (this.static.has(c) || (roots.length && roots.every((r) => r.static.has(c)))) return 'static'
    if (this.dynamic.has(c) || roots.some((r) => r.has(c))) return 'dynamic'
    for (const p of this.prefixes) if (c.startsWith(p)) return 'dynamic'
    return undefined
  }
  /**
   * How the element meets an attribute selector ([type='text'], [disabled]…): true — always, false — never, 'dynamic'
   * — it may (bound, spread in, or a component's).
   */
  meetsAttr(selector) {
    const m = /^\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*))\s*(i)?)?\s*\]$/.exec(selector)
    if (!m) return 'dynamic'
    const [, name, op, dq, sq, bare, ci] = m
    if (this.bound.has(name) || this.spread || this.isComponent) return 'dynamic'
    if (!this.attrs.has(name)) return false
    if (!op) return true
    const norm = (s) => (ci ? s.toLowerCase() : s)
    const have = norm(this.attrs.get(name))
    const want = norm(dq ?? sq ?? bare ?? '')
    const OPS = {
      '=': () => have === want,
      '~=': () => have.split(/\s+/).includes(want),
      '|=': () => have === want || have.startsWith(`${want}-`),
      '^=': () => want !== '' && have.startsWith(want),
      '$=': () => want !== '' && have.endsWith(want),
      '*=': () => want !== '' && have.includes(want),
    }
    return OPS[op]()
  }
  /** The tags it may have in the page: a component's — its roots' (when known), else its own name. */
  get pageTags() {
    return this.childRoots ? this.childRoots.map((r) => r.tag) : [this.tag]
  }
  /** The element's real parent element (through transparent wrappers). */
  get parentEl() {
    let p = this.parent
    while (p && p.transparent) p = p.parent
    return p
  }
  /** The element's siblings before it (through transparent wrappers). */
  previousSiblings() {
    const p = this.parentEl
    if (!p) return []
    const flat = []
    const walk = (e) => {
      for (const c of e.children) {
        if (c.transparent) walk(c)
        else flat.push(c)
      }
    }
    walk(p)
    return flat.slice(0, flat.indexOf(this))
  }
}

/** The elements of a template AST (the root's children; `<template>`, `<Transition>` are transparent, `<Teleport>` — a root). */
export function elementsOf(templateAst) {
  const all = []
  const root = { children: [], transparent: false, isRoot: true }
  const walk = (node, parent) => {
    let i = 0
    // the v-if chain going on among these siblings (v-if starts one, v-else-if / v-else go on with it): one place
    let chain
    for (const ch of node.children ?? []) {
      if (ch.type !== ELEMENT) {
        // v-if / v-for nodes (types 9 / 11, in a transformed tree) hold their branches' children
        if (ch.branches) for (const b of ch.branches) walk(b, parent)
        else if (ch.children && ch.type === 11) walk(ch, parent)
        continue
      }
      const dir = (n) => ch.props.some((p) => p.type === DIRECTIVE && p.name === n)
      if (dir('if')) chain = {}
      else if (!dir('else-if') && !dir('else')) chain = undefined
      const el = new El(ch, parent, i++)
      el.ifChain = chain
      el.all = all
      el.transparent = ch.tag === 'template' || ch.tag === 'Transition' || ch.tag === 'TransitionGroup' || ch.tag === 'KeepAlive'
      // what a <Teleport> holds lives in <body>: the template's elements above it are not its ancestors in the page
      el.isRoot = ch.tag === 'Teleport'
      parent.children.push(el)
      all.push(el)
      walk(ch, el)
    }
  }
  walk(templateAst, root)
  return { all, root }
}

/**
 * A component element's root in the page: the single root element of the component it renders (a parent's scoped
 * style reaches it — it carries the parent's scope too); a component that hands its attributes on itself
 * (inheritAttrs: false) — the element it binds them to (v-bind="$attrs"). `resolveChild(tag)` — that component's
 * { ast, path, ownAttrs }, or undefined (not found). One that takes no classes in the end (several roots) — `noClasses`.
 */
export function attachChildRoots(all, resolveChild) {
  for (const el of all) {
    if (!el.isComponent) continue
    const child = resolveChild(el.tag)
    if (!child?.ast) continue
    const roots = child.ownAttrs ? elementsOf(child.ast).all.filter((e) => e.spreadExp === '$attrs') : singleRoot(child.ast)
    if (roots?.length) {
      el.childRoots = roots
      el.childPath = child.path
    } else el.noClasses = true
  }
}

/**
 * A template's one root in the page: its root elements (one, or the branches of one v-if chain — one of them is
 * rendered); undefined — several (a fragment) or a teleport.
 */
export function singleRoot(ast) {
  return rootsOf(elementsOf(ast).root)
}
/** The same, of a tree already built (elementsOf(…).root). */
export function rootsOf(tree) {
  const roots = tree.children
  if (!roots.length || roots.some((r) => r.transparent || r.isRoot)) return undefined
  if (roots.length === 1 || (roots[0].ifChain && roots.every((r) => r.ifChain === roots[0].ifChain))) return roots
  return undefined
}

/** The template's text with the utilities added to each element's class attribute (a new one where there is none). */
export function writeClasses(ms, all) {
  for (const el of all) {
    if (!el.add.length) continue
    const extra = [...new Set(el.add)].join(' ')
    if (el.classAttr) {
      const v = el.classAttr.value
      // the value's content between its quotes
      const start = v.loc.start.offset + 1
      const end = v.loc.end.offset - 1
      const cur = v.content.trim()
      ms.overwrite(start, end, cur ? `${cur} ${extra}` : extra)
    } else {
      const at = el.node.loc.start.offset + 1 + el.tag.length
      ms.appendLeft(at, ` class="${extra}"`)
    }
  }
}

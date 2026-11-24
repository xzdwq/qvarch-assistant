/**
 * An element's CSS as the site wrote it, from the protocol's matched styles (CSS.getMatchedStylesForNode): the rules
 * that reach it (the browser's own left out), each with only the declarations that win for it; their @media /
 * @supports / @container kept; the custom properties they use (from the ancestors too), the @keyframes they name,
 * ::before / ::after; inherited text styles of the root. A component — the same for every element inside it, each
 * rule once.
 */

/** The protocol's shapes, as far as they are read here. */
export interface CdpProp {
  name: string
  value: string
  important?: boolean
  implicit?: boolean
  text?: string
  disabled?: boolean
  parsedOk?: boolean
  range?: { startLine: number; startColumn: number }
  longhandProperties?: Array<{ name: string; value: string }>
}
export interface CdpStyle {
  styleSheetId?: string
  cssProperties: CdpProp[]
  range?: { startLine: number; startColumn: number }
}
export interface CdpRule {
  styleSheetId?: string
  selectorList: { text: string }
  origin: string
  style: CdpStyle
  media?: Array<{ text: string }>
  supports?: Array<{ text: string }>
  containerQueries?: Array<{ text: string; name?: string }>
  layers?: Array<{ text: string }>
}
export interface CdpMatched {
  inlineStyle?: CdpStyle
  matchedCSSRules?: Array<{ rule: CdpRule }>
  pseudoElements?: Array<{ pseudoType: string; matches: Array<{ rule: CdpRule }> }>
  inherited?: Array<{ inlineStyle?: CdpStyle; matchedCSSRules?: Array<{ rule: CdpRule }> }>
  cssKeyframesRules?: Array<{ animationName: { text: string }; keyframes: Array<{ keyText: { text: string }; style: CdpStyle }> }>
}

/** The text properties an element takes from its parents (the root's own look when copied alone). */
const INHERITED = ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-transform', 'text-indent', 'white-space', 'direction', 'visibility', 'cursor', 'list-style'] as const

/** The declarations written in the source (a shorthand's longhands are its own, not written). */
const written = (p: CdpProp) => !p.disabled && p.parsedOk !== false && (p.text !== undefined || p.range !== undefined) && !p.implicit
/** The names a declaration sets: its own, or its longhands'. */
const namesOf = (p: CdpProp) => (p.longhandProperties?.length ? p.longhandProperties.map((l) => l.name) : [p.name])
const ruleKey = (r: CdpRule) => `${r.styleSheetId ?? ''}|${r.style.range?.startLine ?? ''}:${r.style.range?.startColumn ?? ''}|${r.selectorList.text}`
const siteRule = (r: CdpRule) => r.origin === 'regular' || r.origin === 'inspector'

/** Of a cascade (lowest first) of declaration lists, which declarations win: each name's last — an !important beats a later plain one. */
function winners(lists: CdpProp[][]): Set<CdpProp> {
  const win = new Map<string, CdpProp>()
  for (const list of lists)
    for (const p of list) {
      if (!written(p)) continue
      for (const n of namesOf(p)) {
        const had = win.get(n)
        if (!had || !had.important || p.important) win.set(n, p)
      }
    }
  return new Set(win.values())
}
/** The custom properties a value uses (var(--x)). */
const varsIn = (v: string) => [...v.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1])

type Kept = { rule: CdpRule; props: Set<CdpProp> }

/**
 * The CSS of elements (the first — the root, the one copied; the rest — inside it), each by its matched styles.
 * `rootSel` names the root in the blocks that are not the site's own rules (its inline style, what it inherits).
 */
export function cssOfElements(nodes: CdpMatched[], rootSel: string): string {
  const kept = new Map<string, Kept>()
  const keep = (r: CdpRule, p: CdpProp) => {
    const k = ruleKey(r)
    const e = kept.get(k) ?? { rule: r, props: new Set<CdpProp>() }
    e.props.add(p)
    kept.set(k, e)
  }
  const used = new Set<string>()
  const animations = new Set<string>()
  const note = (p: CdpProp) => {
    for (const v of varsIn(p.value)) used.add(v)
    if (/^animation(-name)?$/.test(p.name)) for (const w of p.value.split(/[\s,]+/)) animations.add(w)
  }
  nodes.forEach((m) => {
    const rules = (m.matchedCSSRules ?? []).map((x) => x.rule).filter(siteRule)
    const win = winners([...rules.map((r) => r.style.cssProperties), m.inlineStyle?.cssProperties ?? []])
    for (const r of rules)
      for (const p of r.style.cssProperties)
        if (win.has(p)) {
          keep(r, p)
          note(p)
        }
    for (const pe of m.pseudoElements ?? []) {
      const prs = pe.matches.map((x) => x.rule).filter(siteRule)
      const pw = winners(prs.map((r) => r.style.cssProperties))
      for (const r of prs) for (const p of r.style.cssProperties) if (pw.has(p)) (keep(r, p), note(p))
    }
    for (const p of m.inlineStyle?.cssProperties ?? []) if (written(p)) note(p)
  })
  const root = nodes[0]
  const blocks: string[] = []
  // (the custom properties used — wherever they are set: the element's rules or its ancestors'; a variable naming another taken too)
  const vars = customProps(nodes, used)
  if (vars.length) blocks.push(`/* переменные */\n${rootSel} {\n${vars.map(([n, v]) => `  ${n}: ${v};`).join('\n')}\n}`)
  const inh = root ? inheritedOf(root) : []
  if (inh.length) blocks.push(`/* унаследовано от родителей */\n${rootSel} {\n${inh.map(([n, v]) => `  ${n}: ${v};`).join('\n')}\n}`)
  for (const { rule, props } of kept.values()) {
    const decls = rule.style.cssProperties.filter((p) => props.has(p) && !p.name.startsWith('--'))
    if (!decls.length) continue
    blocks.push(wrap(rule, `${rule.selectorList.text} {\n${decls.map(declText).join('\n')}\n}`))
  }
  const inline = (root?.inlineStyle?.cssProperties ?? []).filter(written)
  if (inline.length) blocks.push(`/* style="" элемента */\n${rootSel} {\n${inline.map(declText).join('\n')}\n}`)
  for (const k of root ? keyframesOf(nodes, animations) : []) blocks.push(k)
  return blocks.join('\n\n')
}
const declText = (p: CdpProp) => `  ${p.name}: ${p.value}${p.important && !/!important/.test(p.value) ? ' !important' : ''};`

/** A rule inside its at-rules (@layer, @supports, @container, @media — the outer first). */
function wrap(r: CdpRule, body: string): string {
  const outer = [...(r.layers ?? []).filter((l) => l.text).map((l) => `@layer ${l.text}`), ...(r.supports ?? []).map((s) => `@supports ${s.text}`), ...(r.containerQueries ?? []).map((c) => `@container ${c.name ? `${c.name} ` : ''}${c.text}`), ...[...(r.media ?? [])].reverse().map((m) => `@media ${m.text}`)]
  return outer.reduceRight((inner, at) => `${at} {\n${inner.replace(/^/gm, '  ')}\n}`, body)
}
/** The custom properties used, their values as the nearest setter has them (the element's own rules first, then its ancestors'). */
function customProps(nodes: CdpMatched[], used: Set<string>): Array<[string, string]> {
  const lists: CdpProp[][] = []
  for (const m of nodes) {
    lists.push(m.inlineStyle?.cssProperties ?? [])
    for (const x of [...(m.matchedCSSRules ?? [])].reverse()) lists.push(x.rule.style.cssProperties)
  }
  for (const m of nodes.slice(0, 1))
    for (const inh of m.inherited ?? []) {
      lists.push(inh.inlineStyle?.cssProperties ?? [])
      for (const x of [...(inh.matchedCSSRules ?? [])].reverse()) lists.push(x.rule.style.cssProperties)
    }
  const out = new Map<string, string>()
  const want = [...used]
  for (let i = 0; i < want.length; i++) {
    const n = want[i]
    if (out.has(n)) continue
    const p = lists.flat().find((x) => x.name === n && !x.disabled)
    if (!p) continue
    out.set(n, p.value)
    for (const v of varsIn(p.value)) if (!want.includes(v)) want.push(v)
  }
  return [...out]
}
/** The text styles the root takes from its nearest ancestor that sets them (those it does not set itself). */
function inheritedOf(m: CdpMatched): Array<[string, string]> {
  const own = winners([...(m.matchedCSSRules ?? []).map((x) => x.rule.style.cssProperties), m.inlineStyle?.cssProperties ?? []])
  const set = new Set([...own].flatMap(namesOf))
  const out: Array<[string, string]> = []
  for (const name of INHERITED) {
    if (set.has(name)) continue
    for (const inh of m.inherited ?? []) {
      const lists = [...(inh.matchedCSSRules ?? []).map((x) => x.rule).filter(siteRule).map((r) => r.style.cssProperties), inh.inlineStyle?.cssProperties ?? []]
      const w = [...winners(lists)].find((p) => namesOf(p).includes(name))
      if (w) {
        out.push([name, w.longhandProperties?.find((l) => l.name === name)?.value ?? w.value])
        break
      }
    }
  }
  return out
}
/** The @keyframes of the animations named. */
function keyframesOf(nodes: CdpMatched[], names: Set<string>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of nodes)
    for (const k of m.cssKeyframesRules ?? []) {
      const n = k.animationName.text
      if (!names.has(n) || seen.has(n)) continue
      seen.add(n)
      out.push(`@keyframes ${n} {\n${k.keyframes.map((f) => `  ${f.keyText.text} {\n${f.style.cssProperties.filter(written).map((p) => `  ${declText(p)}`).join('\n')}\n  }`).join('\n')}\n}`)
    }
  return out
}

/** The values a property has when nothing sets it (a computed style without them is what makes the element look so). */
const INITIAL: Record<string, string[]> = {
  display: ['inline'],
  position: ['static'],
  float: ['none'],
  clear: ['none'],
  opacity: ['1'],
  visibility: ['visible'],
  'z-index': ['auto'],
  transform: ['none'],
  filter: ['none'],
  'box-shadow': ['none'],
  'text-shadow': ['none'],
  'background-image': ['none'],
  'background-color': ['rgba(0, 0, 0, 0)'],
  'border-top-style': ['none'],
  'border-right-style': ['none'],
  'border-bottom-style': ['none'],
  'border-left-style': ['none'],
  'outline-style': ['none'],
  'text-decoration-line': ['none'],
  'flex-direction': ['row'],
  'flex-wrap': ['nowrap'],
  'flex-grow': ['0'],
  'flex-shrink': ['1'],
  'flex-basis': ['auto'],
  order: ['0'],
  'align-self': ['auto'],
  'justify-self': ['auto'],
  overflow: ['visible'],
  'overflow-x': ['visible'],
  'overflow-y': ['visible'],
  'max-width': ['none'],
  'max-height': ['none'],
  'min-width': ['auto', '0px'],
  'min-height': ['auto', '0px'],
  'margin-top': ['0px'],
  'margin-right': ['0px'],
  'margin-bottom': ['0px'],
  'margin-left': ['0px'],
  'padding-top': ['0px'],
  'padding-right': ['0px'],
  'padding-bottom': ['0px'],
  'padding-left': ['0px'],
  'border-top-left-radius': ['0px'],
  'border-top-right-radius': ['0px'],
  'border-bottom-left-radius': ['0px'],
  'border-bottom-right-radius': ['0px'],
  transition: ['all 0s ease 0s', 'all'],
  animation: ['none', 'none 0s ease 0s 1 normal none running'],
  content: ['normal'],
  'pointer-events': ['auto'],
  'user-select': ['auto'],
  'mix-blend-mode': ['normal'],
  isolation: ['auto'],
  'object-fit': ['fill'],
  'clip-path': ['none'],
  mask: ['none'],
}
/** The properties a computed style keeps: the look (layout, box, text, colour) — not every one of Chromium's 400. */
const COMPUTED_OF_USE = /^(display|position|top|right|bottom|left|inset|z-index|float|clear|box-sizing|width|height|min-|max-|margin-|padding-|border-|outline|overflow|flex|order|align-|justify-|place-|gap|row-gap|column-gap|grid|color|background|font|line-height|letter-spacing|word-spacing|text-|white-space|vertical-align|opacity|visibility|transform|transition|animation|filter|box-shadow|cursor|pointer-events|user-select|content|list-style|object-|clip-path|mix-blend-mode|isolation|aspect-ratio)/

/** An element's computed style as CSS: the properties of use, those not at their initial value. */
export function computedCss(props: Array<{ name: string; value: string }>, sel: string): string {
  const keep = props.filter((p) => !p.name.startsWith('--') && !p.name.startsWith('-webkit-') && COMPUTED_OF_USE.test(p.name) && !(INITIAL[p.name] ?? []).includes(p.value))
  return `${sel} {\n${keep.map((p) => `  ${p.name}: ${p.value};`).join('\n')}\n}`
}

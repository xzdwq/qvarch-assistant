import { EDITABLE, pathIn, sigOf, typable } from './cssPath'
import { HIDDEN, q, reSrc, textOf, visible } from './domText'

/** Locators by what the app's authors gave an element to be found by (its test id), and by the record it is in. */

export const TEST_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa']
/** Controls a test id's holder may hold besides the element (more than one — the id is a block's, not the element's). */
const CONTROLS = 'input:not([type="hidden"]), textarea, select, button, a[href], [role="button"], [role="combobox"]'
/**
 * A test id: its stem and whether it is numbered — «uom-3» (a list's v-for gives each its index: «uom», numbered),
 * «uom» (plain). The number is never kept: more records before it, and «uom-3» is another one's.
 */
export function testIdOf(v: string): { stem: string; numbered: boolean } {
  const m = /^(.*[^\d_-])[-_]\d+$/.exec(v)
  return m ? { stem: m[1], numbered: true } : { stem: v, numbered: false }
}
/** The test id for the element: on itself, or on its field / button (the holder holding no other control). */
export function testIdHolder(el: Element): { holder: Element; attr: string; value: string } | undefined {
  for (let e: Element | null = el, d = 0; e && e !== document.body && d < 6; e = e.parentElement, d++)
    for (const attr of TEST_ATTRS) {
      const value = e.getAttribute(attr)
      if (!value) continue
      if (e !== el && e.querySelectorAll(CONTROLS).length > 1) return undefined
      return { holder: e, attr, value }
    }
  return undefined
}
/** A text of a container's own (a leaf's: a record's code, its name) — the words that tell it from its likes. */
function textsIn(c: Element, not: Element): string[] {
  const out: string[] = []
  for (const e of c.querySelectorAll('*')) {
    if (out.length >= 12 || e.children.length || e.matches(HIDDEN) || not.contains(e) || !visible(e)) continue
    const t = textOf(e, 60)
    if (t.length >= 2 && !/^\d{1,3}$/.test(t) && !out.includes(t)) out.push(t)
  }
  return out
}
/**
 * An element with nothing of its own to be found by (no label, no words — a field of a record, an icon) found by its
 * record: the nearest container repeated on the page (records, rows, cards alike) told from its likes by its own words
 * (a saved record's code / name), or by being the one that is edited (fields one can type into, the others read-only);
 * then the element by its place inside that record. Never «the Nth on the page»: more records, and the Nth is another.
 */
export function anchoredLocator(el: Element, within?: (c: Element) => string | undefined): string | undefined {
  let depth = 0
  for (let c = el.parentElement; c && c !== document.body && depth < 10; c = c.parentElement, depth++) {
    const sig = sigOf(c)
    const peers = [...document.querySelectorAll(sig)].filter(visible)
    if (peers.length < 2 || !peers.includes(c)) continue
    // the element inside the record: as one asked (its test id), else by its place there
    let tail = within?.(c)
    if (!within) {
      const rel = pathIn(el, c)
      if (rel && c.querySelectorAll(rel).length === 1) tail = `.locator(${q(rel)})`
    }
    if (!tail) continue
    const inner = (anchor: string) => `${anchor}${tail}`
    // its own words
    for (const t of textsIn(c, el)) {
      const holders = peers.filter((p) => [...p.querySelectorAll('*')].some((e) => !e.children.length && textOf(e, 60) === t))
      if (holders.length === 1 && holders[0] === c) return inner(`page.locator(${q(sig)}).filter({ has: page.getByText(${q(t)}, { exact: true }) })`)
    }
    // the one edited: fields one types into at the same place, the likes having none
    const ed = [...c.querySelectorAll('input, textarea')].find(typable)
    // (that field by its test id when it has one)
    const et = ed && testIdHolder(ed)
    if (et && et.attr === 'data-testid') {
      const { stem, numbered } = testIdOf(et.value)
      const kin = (p: Element) => [...p.querySelectorAll(`[data-testid^="${CSS.escape(stem)}"]`)].filter((e) => (numbered ? testIdOf(e.getAttribute('data-testid')!).stem === stem : e.getAttribute('data-testid') === et.value))
      const holders = peers.filter((p) => kin(p).some((h) => [...h.querySelectorAll('input, textarea'), h].some(typable)))
      const code = `page.getByTestId(${numbered ? `/^${reSrc(stem)}[-_]\\d+$/` : q(et.value)}).locator(${q(`input${EDITABLE}, textarea${EDITABLE}`)})`
      if (holders.length === 1 && holders[0] === c) return inner(`page.locator(${q(sig)}).filter({ has: ${code} })`)
    }
    const edRel = ed && pathIn(ed, c)
    if (edRel) {
      const sel = `${edRel}${EDITABLE}`
      const holders = peers.filter((p) => p.querySelector(sel))
      if (holders.length === 1 && holders[0] === c) return inner(`page.locator(${q(sig)}).filter({ has: page.locator(${q(sel)}) })`)
    }
  }
  return undefined
}
/**
 * The element by its test id — first of all: an id is what the app's authors gave it to be found by. A numbered one
 * (a v-for's «uom-1») — every «uom-N», then the record it is in (anchoredLocator: its own words, the one edited);
 * a plain one met more than once — the same. A typing's input inside its field: the field's input.
 */
export function testIdLocator(el: Element): { loc: string; holder: Element } | undefined {
  const t = testIdHolder(el)
  if (!t) return undefined
  const { holder, attr, value } = t
  const { stem, numbered } = testIdOf(value)
  const kinOf = (v: string | null) => !!v && (numbered ? testIdOf(v).numbered && testIdOf(v).stem === stem : v === value)
  const kinSel = numbered ? `[${attr}^="${CSS.escape(stem)}"]` : `[${attr}="${CSS.escape(value)}"]`
  const kinIn = (root: ParentNode) => [...root.querySelectorAll(kinSel)].filter((e) => kinOf(e.getAttribute(attr)))
  // the kin as code: data-testid by Playwright's own getByTestId (a pattern for a numbered one), others by CSS
  const pattern = `/^${reSrc(stem)}[-_]\\d+$/`
  const kinCode = (on: string) => (attr === 'data-testid' ? `${on}getByTestId(${numbered ? pattern : q(value)})` : `${on}locator(${q(kinSel)})`)
  // (another attribute numbered — a CSS prefix: only when all it catches are kin)
  if (numbered && attr !== 'data-testid' && document.querySelectorAll(kinSel).length !== kinIn(document).length) return undefined
  const all = kinIn(document).filter(visible)
  let loc: string | undefined
  if (all.length <= 1) loc = kinCode('page.')
  else {
    loc = anchoredLocator(holder, (c) => (kinIn(c).length === 1 ? kinCode('.') : undefined))
    // no record tells it: the id as it is, when it alone has it
    if (!loc && document.querySelectorAll(`[${attr}="${CSS.escape(value)}"]`).length === 1) loc = attr === 'data-testid' ? `page.getByTestId(${q(value)})` : `page.locator(${q(`[${attr}="${value}"]`)})`
  }
  if (!loc) return undefined
  if (holder !== el && (el.matches('input, textarea') || el.matches('[contenteditable="true"]'))) loc += `.locator(${q('input:not([type="hidden"]), textarea, [contenteditable="true"]')})`
  return { loc, holder }
}

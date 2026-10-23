// Which class names the app's sources can set — to tell a CSS rule or a utility's condition that can never meet one.
// A name counts when it stands as a word in any string (class attributes, :class objects, strings in code), or when
// a class binding builds it from a prefix (`:class="\`g${n}\`"`, `class: \`k-${kind}\``) or a transition gives it
// (`<Transition name="pop">` — `pop-enter-active`, `pop-move`).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const walk = (p) => (statSync(p).isFile() ? [p] : readdirSync(p).flatMap((n) => walk(join(p, n))))

/** The sources' texts (.vue / .ts under `root`). */
export function sourceTexts(root = 'src') {
  return new Map(
    walk(root)
      .filter((f) => /\.(vue|ts)$/.test(f))
      .map((f) => [f, readFileSync(f, 'utf8')]),
  )
}

/** A test: may a source set this class? */
export function classNamesOf(sources) {
  // (read more than once — an iterator would be spent by the first pass)
  const texts = [...sources]
  const named = new Set()
  // (each kind of quote on its own: `:class="{ 'a-b': x }"` holds one inside the other)
  for (const text of texts)
    for (const re of [/"([^"\n]*)"/g, /'([^'\n]*)'/g, /`([^`]*)`/g])
      for (const m of text.matchAll(re)) for (const w of m[1].split(/[\s{}:,?'"[\]()]+/)) if (/^-?[_a-zA-Z][\w-]*$/.test(w)) named.add(w)
  const prefixes = new Set()
  const BINDINGS = [/:class="([^"]*)"/g, /\bclass:\s*(`[^`]*`)/g, /\bclassName\s*=\s*(`[^`]*`)/g, /\bclassList\.\w+\(([^)]*)\)/g]
  for (const text of texts) {
    for (const re of BINDINGS) for (const m of text.matchAll(re)) for (const p of m[1].matchAll(/(?<![\w-])([_a-zA-Z][\w-]*)\$\{/g)) prefixes.add(p[1])
    // a dashed prefix anywhere (`drop-${side}` returned by a function): a class name is made
    for (const p of text.matchAll(/(?<![\w-])([_a-zA-Z][\w-]*-)\$\{/g)) prefixes.add(p[1])
    for (const m of text.matchAll(/<Transition(?:Group)?\b[^>]*\bname="([\w-]+)"/g)) prefixes.add(`${m[1]}-`)
  }
  return (c) => named.has(c) || [...prefixes].some((p) => c.startsWith(p))
}

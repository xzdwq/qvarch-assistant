// Utilities whose condition names a class no source ever sets (`tw:[.lstyles_&]:…`, `tw:[&.gone]:…`) can never apply;
// a negation of such a class (`tw:not-[.order_&]:…`) always holds. Counts them; --fix drops the first and the negation
// out of the second.
// Usage: node scripts/tailwind/deadVariants.mjs [--fix]
import { writeFileSync } from 'node:fs'
import { classNamesOf, sourceTexts } from './classNames.mjs'

const texts = sourceTexts()
const isNamed = classNamesOf(texts.values())

/** A utility's variants and its base, split at the top-level colons. */
function partsOf(u) {
  const out = ['']
  let depth = 0
  for (const ch of u) {
    if (ch === '[' || ch === '(') depth++
    else if (ch === ']' || ch === ')') depth--
    if (ch === ':' && depth === 0) out.push('')
    else out[out.length - 1] += ch
  }
  return out
}
/** The classes an arbitrary variant's selector names (not inside its own utility class). */
// (in a variant `_` stands for a space: it ends a class name)
const classesOf = (v) => [...v.matchAll(/\.(-?[a-zA-Z][a-zA-Z0-9-]*)/g)].map((m) => m[1])
const deadIn = (v) => /^(?:not-)?(?:group-|peer-)?\[/.test(v) && classesOf(v).some((c) => !isNamed(c))

const fix = process.argv.includes('--fix')
let dropped = 0
let simplified = 0
for (const [f, text] of texts) {
  if (!f.endsWith('.vue')) continue
  const out = text.replace(/(\sclass=")([^"]*)(")/g, (_, a, v, b) => {
    const tokens = v.split(/\s+/).filter(Boolean)
    const next = []
    for (const t of tokens) {
      if (!t.startsWith('tw:')) {
        next.push(t)
        continue
      }
      const parts = partsOf(t.slice(3))
      const variants = parts.slice(0, -1)
      // a condition that never holds: the utility goes
      if (variants.some((x) => !x.startsWith('not-') && deadIn(x))) {
        dropped++
        continue
      }
      // a negation that always holds: the negation goes
      const kept = variants.filter((x) => !(x.startsWith('not-') && deadIn(x)))
      if (kept.length !== variants.length) simplified++
      next.push(`tw:${[...kept, parts.at(-1)].join(':')}`)
    }
    return a + [...new Set(next)].join(' ') + b
  })
  if (fix && out !== text) writeFileSync(f, out)
}
console.log(`${dropped} utilities that never apply, ${simplified} with a negation that always holds`)
if (process.argv.includes('--classes')) {
  const count = new Map()
  for (const text of texts.values())
    for (const m of text.matchAll(/tw:[^\s"]+/g))
      for (const v of partsOf(m[0].slice(3)).slice(0, -1)) if (deadIn(v)) for (const c of classesOf(v)) if (!isNamed(c)) count.set(c, (count.get(c) ?? 0) + 1)
  console.log([...count].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join('\n'))
}
